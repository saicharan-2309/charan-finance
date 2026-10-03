-- ---------------------------------------------------------------------------
-- Payment methods, credit-card billing cycles and loans/EMIs.
--
-- Additive only. Every statement is guarded so the migration is safe to run
-- on a database that already holds real data:
--   * no column is dropped or retyped
--   * no row is deleted
--   * existing accounts keep their type, balance and history
--   * category colours are refreshed only where they still hold the exact
--     factory default, so user-chosen colours are never overwritten
--
-- Why no new account_type enum value: UPI apps (Google Pay, PhonePe, Paytm,
-- Amazon Pay) are wallets that already fit `wallet`, and giving them a
-- `provider` key keeps existing wallet rows valid while adding brand identity.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Account columns: provider identity + credit-card billing cycle
-- ---------------------------------------------------------------------------
alter table public.accounts
  add column if not exists provider      text,
  add column if not exists statement_day smallint,
  add column if not exists due_day       smallint,
  add column if not exists minimum_due   public.money_amount;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_provider_check') then
    alter table public.accounts
      add constraint accounts_provider_check
      check (provider is null or char_length(btrim(provider)) between 1 and 40);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accounts_statement_day_check') then
    alter table public.accounts
      add constraint accounts_statement_day_check
      check (statement_day is null or statement_day between 1 and 31);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accounts_due_day_check') then
    alter table public.accounts
      add constraint accounts_due_day_check
      check (due_day is null or due_day between 1 and 31);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'accounts_minimum_due_check') then
    alter table public.accounts
      add constraint accounts_minimum_due_check
      check (minimum_due is null or minimum_due >= 0);
  end if;
end;
$$;

comment on column public.accounts.provider is
  'Payment provider key (gpay, phonepe, hdfc, …). Display identity only; never credentials.';
comment on column public.accounts.statement_day is
  'Day of month the credit-card statement is generated (clamped to month length).';
comment on column public.accounts.due_day is 'Day of month the card payment is due.';

-- ---------------------------------------------------------------------------
-- 2. Date helper: a day-of-month clamped to the length of its month
-- ---------------------------------------------------------------------------
create or replace function public.day_in_month(p_ref date, p_day integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select make_date(
    extract(year from p_ref)::int,
    extract(month from p_ref)::int,
    least(
      greatest(p_day, 1),
      extract(day from (date_trunc('month', p_ref::timestamp) + interval '1 month - 1 day'))::int
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Credit-card billing cycle
--
-- Returns the open cycle (spending not yet billed), the statement and due
-- dates around it, and what has been spent and repaid inside it. With no
-- statement day configured the cycle is the current calendar month, so the
-- numbers are still real rather than absent.
-- ---------------------------------------------------------------------------
create or replace function public.credit_card_cycle(p_account_id uuid)
returns table (
  cycle_start    date,
  cycle_end      date,
  statement_date date,
  due_date       date,
  spend          numeric,
  payments       numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  a            public.accounts;
  today        date := public.user_today();
  tz           text := public.user_timezone();
  last_stmt    date;
  next_stmt    date;
  due          date;
  c_start      date;
  c_end        date;
begin
  select * into a from public.accounts where id = p_account_id and user_id = auth.uid();
  if not found then
    raise exception 'CF102: Account not found';
  end if;

  if a.statement_day is null then
    c_start   := date_trunc('month', today)::date;
    c_end     := (date_trunc('month', today) + interval '1 month - 1 day')::date;
    next_stmt := c_end;
    last_stmt := c_start - 1;
  else
    last_stmt := public.day_in_month(today, a.statement_day);
    if last_stmt > today then
      last_stmt := public.day_in_month((date_trunc('month', today) - interval '1 month')::date,
                                       a.statement_day);
    end if;
    next_stmt := public.day_in_month((date_trunc('month', last_stmt) + interval '1 month')::date,
                                     a.statement_day);
    c_start   := last_stmt + 1;
    c_end     := next_stmt;
  end if;

  if a.due_day is null then
    due := null;
  else
    -- The payment for the latest statement: the first due day strictly after it.
    due := public.day_in_month(last_stmt, a.due_day);
    if due <= last_stmt then
      due := public.day_in_month((date_trunc('month', last_stmt) + interval '1 month')::date, a.due_day);
    end if;
  end if;

  return query
  with bounds as (
    select public.local_day_start(c_start, tz) as lo,
           public.local_day_start(c_end + 1, tz) as hi
  )
  select c_start,
         c_end,
         next_stmt,
         due,
         coalesce(sum(t.amount) filter (where t.type = 'expense' and t.account_id = p_account_id), 0),
         coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.to_account_id = p_account_id), 0)
         + coalesce(sum(t.amount) filter (where t.type = 'income' and t.account_id = p_account_id), 0)
  from bounds
  left join public.transactions t
    on t.user_id = auth.uid()
   and (t.account_id = p_account_id or t.to_account_id = p_account_id)
   and t.occurred_at >= bounds.lo
   and t.occurred_at <  bounds.hi;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Loans / EMIs
--
-- A loan owns the agreement (principal, rate, tenure) and points at the
-- recurring transaction that actually posts each instalment, so EMIs reuse the
-- existing schedule, reminder, calendar and posting engine instead of a second
-- one. The payment method is whatever account the recurring row charges — bank,
-- card, UPI or cash — never a hardcoded card.
-- ---------------------------------------------------------------------------
create table if not exists public.loans (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name              text not null check (char_length(btrim(name)) between 1 and 80),
  lender            text check (char_length(lender) <= 80),
  principal_amount  public.money_amount not null check (principal_amount > 0),
  emi_amount        public.money_amount not null check (emi_amount > 0),
  interest_rate     numeric(5, 2) check (interest_rate is null or interest_rate between 0 and 100),
  tenure_months     smallint check (tenure_months is null or tenure_months between 1 and 600),
  currency          public.currency_code not null default 'INR',
  start_date        date not null,
  account_id        uuid not null,
  category_id       uuid,
  recurring_id      uuid,
  notes             text check (char_length(notes) <= 1000),
  color             text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon              text check (char_length(icon) <= 40),
  is_closed         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, user_id),
  unique (recurring_id),
  foreign key (account_id, user_id)
    references public.accounts (id, user_id) on delete restrict,
  foreign key (category_id, user_id)
    references public.transaction_categories (id, user_id) on delete restrict,
  foreign key (recurring_id, user_id)
    references public.recurring_transactions (id, user_id) on delete set null (recurring_id)
);

create index if not exists loans_user_idx on public.loans (user_id, is_closed, start_date desc);

drop trigger if exists loans_set_updated_at on public.loans;
create trigger loans_set_updated_at
  before update on public.loans
  for each row execute function public.tg_set_updated_at();

-- Loan progress, derived from instalments actually recorded — never estimated.
-- `scheduled_total` is exact arithmetic (emi × tenure) and is null when the
-- tenure is unknown rather than guessed.
create or replace view public.loan_status
with (security_invoker = true)
as
select
  l.id,
  l.user_id,
  l.name,
  l.lender,
  l.principal_amount,
  l.emi_amount,
  l.interest_rate,
  l.tenure_months,
  l.currency,
  l.start_date,
  l.account_id,
  a.name  as account_name,
  a.type  as account_type,
  l.category_id,
  c.name  as category_name,
  c.icon  as category_icon,
  c.color as category_color,
  l.recurring_id,
  r.frequency,
  r.interval_count,
  r.end_date,
  r.last_occurrence_date,
  r.auto_post,
  r.is_active     as schedule_active,
  case when l.recurring_id is null then null else public.next_due_date(r) end as next_payment_date,
  l.notes,
  l.color,
  l.icon,
  l.is_closed,
  l.created_at,
  l.updated_at,
  coalesce(p.paid_amount, 0)                        as paid_amount,
  coalesce(p.paid_count, 0)                         as paid_count,
  case when l.tenure_months is null then null
       else l.emi_amount * l.tenure_months end      as scheduled_total,
  case when l.tenure_months is null then null
       else greatest(l.tenure_months - coalesce(p.paid_count, 0), 0) end as payments_remaining,
  case when l.tenure_months is null then null
       else greatest(l.emi_amount * l.tenure_months - coalesce(p.paid_amount, 0), 0) end
                                                    as amount_remaining
from public.loans l
join public.accounts a on a.id = l.account_id
left join public.transaction_categories c on c.id = l.category_id
left join public.recurring_transactions r on r.id = l.recurring_id
left join lateral (
  select sum(t.amount) as paid_amount, count(*) as paid_count
  from public.transactions t
  where t.recurring_id = l.recurring_id
    and t.user_id = l.user_id
) p on l.recurring_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Transactions view: expose the destination account type so a transfer into
--    a credit card can be shown as a card payment. Appended at the end —
--    `create or replace view` keeps existing column order intact.
-- ---------------------------------------------------------------------------
create or replace view public.transactions_view
with (security_invoker = true)
as
select
  t.id,
  t.user_id,
  t.type,
  t.amount,
  t.currency,
  t.account_id,
  a.name  as account_name,
  a.type  as account_type,
  t.to_account_id,
  ta.name as to_account_name,
  t.category_id,
  c.name  as category_name,
  c.icon  as category_icon,
  c.color as category_color,
  t.subcategory_id,
  sc.name as subcategory_name,
  t.merchant_id,
  m.name  as merchant_name,
  t.occurred_at,
  t.notes,
  t.recurring_id,
  t.recurring_occurrence,
  t.created_at,
  t.updated_at,
  coalesce(tg.tag_names, '{}') as tag_names,
  exists (select 1 from public.attachments at where at.transaction_id = t.id) as has_receipt,
  lower(concat_ws(' ',
    m.name, t.notes, c.name, sc.name, a.name, ta.name,
    array_to_string(tg.tag_names, ' '),
    t.amount::text, to_char(t.amount, 'FM999999999999990.00')
  )) as search_text,
  ta.type as to_account_type,
  a.provider as account_provider
from public.transactions t
join public.accounts a on a.id = t.account_id
left join public.accounts ta on ta.id = t.to_account_id
left join public.transaction_categories c on c.id = t.category_id
left join public.transaction_categories sc on sc.id = t.subcategory_id
left join public.merchants m on m.id = t.merchant_id
left join lateral (
  select array_agg(g.name order by g.name) as tag_names
  from public.transaction_tags tt
  join public.tags g on g.id = tt.tag_id
  where tt.transaction_id = t.id
) tg on true;

-- ---------------------------------------------------------------------------
-- 6. Row level security and privileges for the new objects
-- ---------------------------------------------------------------------------
alter table public.loans enable row level security;

drop policy if exists loans_owner_select on public.loans;
drop policy if exists loans_owner_insert on public.loans;
drop policy if exists loans_owner_update on public.loans;
drop policy if exists loans_owner_delete on public.loans;

create policy loans_owner_select on public.loans
  for select to authenticated using (user_id = auth.uid());
create policy loans_owner_insert on public.loans
  for insert to authenticated with check (user_id = auth.uid());
create policy loans_owner_update on public.loans
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy loans_owner_delete on public.loans
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.loans from anon;
revoke all on public.loan_status from anon;
grant select, insert, delete on public.loans to authenticated;
grant update (name, lender, principal_amount, emi_amount, interest_rate, tenure_months,
              currency, start_date, account_id, category_id, recurring_id, notes,
              color, icon, is_closed)
  on public.loans to authenticated;
grant select on public.loan_status to authenticated;

-- New account columns follow the same rule as the rest: current_balance stays
-- server-owned, everything descriptive is writable by the owner.
grant insert (provider, statement_day, due_day, minimum_due) on public.accounts to authenticated;
grant update (provider, statement_day, due_day, minimum_due) on public.accounts to authenticated;

grant execute on function
  public.day_in_month(date, integer),
  public.credit_card_cycle(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Reference data
--    a) new "Loans & EMI" expense category for existing users
--    b) refresh factory-default category colours to the softer palette,
--       leaving any colour the user has changed untouched
-- ---------------------------------------------------------------------------
insert into public.transaction_categories (user_id, name, kind, classification, icon, color, sort_order)
select p.id, 'Loans & EMI', 'expense', 'essential', 'calendar-number-outline', '#7C77C6', 21
from public.profiles p
where not exists (
  select 1 from public.transaction_categories c
  where c.user_id = p.id and lower(c.name) in ('loans & emi', 'emi', 'loan', 'loans')
);

update public.transaction_categories c
set color = v.new_color
from (values
  ('Food',           '#EA580C', '#D97757'),
  ('Groceries',      '#16A34A', '#4F9A6A'),
  ('Restaurants',    '#EF4444', '#D4746B'),
  ('Shopping',       '#EC4899', '#A97BB5'),
  ('Transport',      '#3B82F6', '#5B87C4'),
  ('Fuel',           '#0284C7', '#4A8DA8'),
  ('Travel',         '#0891B2', '#4F9AA0'),
  ('Entertainment',  '#A855F7', '#B07AC0'),
  ('Bills',          '#64748B', '#C09A5B'),
  ('Utilities',      '#CA8A04', '#B8923F'),
  ('Rent',           '#8B5CF6', '#7C8FC0'),
  ('Healthcare',     '#F43F5E', '#C97A86'),
  ('Fitness',        '#059669', '#52977F'),
  ('Education',      '#6366F1', '#7C83C6'),
  ('Subscriptions',  '#D946EF', '#A97BC9'),
  ('Insurance',      '#0D9488', '#4F9690'),
  ('Personal Care',  '#FB7185', '#CC8192'),
  ('Gifts',          '#D97706', '#C08A4F'),
  ('Investments',    '#16A34A', '#4F9A6A'),
  ('Other',          '#64748B', '#8C8782'),
  ('Salary',         '#16A34A', '#4F9A6A'),
  ('Bonus',          '#16A34A', '#4F9A6A'),
  ('Freelance',      '#0284C7', '#4A8DA8'),
  ('Interest',       '#0D9488', '#4F9690'),
  ('Dividends',      '#6366F1', '#7C83C6'),
  ('Refunds',        '#D97706', '#C08A4F'),
  ('Gifts Received', '#EC4899', '#A97BB5'),
  ('Other Income',   '#64748B', '#8C8782')
) as v(name, old_color, new_color)
where c.name = v.name
  and upper(c.color) = upper(v.old_color);

-- Subcategories inherited their parent's colour, so refresh them the same way.
update public.transaction_categories sc
set color = p.color
from public.transaction_categories p
where sc.parent_id = p.id
  and sc.user_id = p.user_id
  and sc.color is distinct from p.color
  and upper(sc.color) in (
    '#EA580C','#16A34A','#EF4444','#EC4899','#3B82F6','#0284C7','#0891B2','#A855F7','#64748B',
    '#CA8A04','#8B5CF6','#F43F5E','#059669','#6366F1','#D946EF','#0D9488','#FB7185','#D97706'
  );

-- c) new users get the softer palette and the Loans & EMI category from the start
create or replace function public.create_default_categories(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  parent_id uuid;
  sub text;
  i integer := 0;
begin
  if exists (select 1 from public.transaction_categories where user_id = p_user_id) then
    return;
  end if;

  for rec in
    select * from (values
      ('Food',           'expense', 'discretionary', 'fast-food-outline',     '#D97757', array['Snacks & Coffee', 'Food Delivery']),
      ('Groceries',      'expense', 'essential',     'basket-outline',        '#4F9A6A', array[]::text[]),
      ('Restaurants',    'expense', 'discretionary', 'restaurant-outline',    '#D4746B', array[]::text[]),
      ('Shopping',       'expense', 'discretionary', 'bag-handle-outline',    '#A97BB5', array['Clothing', 'Electronics', 'Home']),
      ('Transport',      'expense', 'essential',     'car-outline',           '#5B87C4', array['Cab & Auto', 'Public Transport', 'Parking & Tolls']),
      ('Fuel',           'expense', 'essential',     'speedometer-outline',   '#4A8DA8', array[]::text[]),
      ('Travel',         'expense', 'discretionary', 'airplane-outline',      '#4F9AA0', array['Flights', 'Hotels']),
      ('Entertainment',  'expense', 'discretionary', 'film-outline',          '#B07AC0', array[]::text[]),
      ('Bills',          'expense', 'essential',     'receipt-outline',       '#C09A5B', array[]::text[]),
      ('Utilities',      'expense', 'essential',     'flash-outline',         '#B8923F', array['Electricity', 'Water', 'Gas', 'Mobile & Internet']),
      ('Rent',           'expense', 'essential',     'home-outline',          '#7C8FC0', array[]::text[]),
      ('Healthcare',     'expense', 'essential',     'medkit-outline',        '#C97A86', array['Medicines', 'Doctor']),
      ('Fitness',        'expense', 'discretionary', 'barbell-outline',       '#52977F', array[]::text[]),
      ('Education',      'expense', 'essential',     'school-outline',        '#7C83C6', array[]::text[]),
      ('Subscriptions',  'expense', 'discretionary', 'repeat-outline',        '#A97BC9', array[]::text[]),
      ('Insurance',      'expense', 'essential',     'shield-checkmark-outline', '#4F9690', array[]::text[]),
      ('Loans & EMI',    'expense', 'essential',     'calendar-number-outline',  '#7C77C6', array[]::text[]),
      ('Personal Care',  'expense', 'discretionary', 'sparkles-outline',      '#CC8192', array[]::text[]),
      ('Gifts',          'expense', 'discretionary', 'gift-outline',          '#C08A4F', array[]::text[]),
      ('Investments',    'expense', null,            'trending-up-outline',   '#4F9A6A', array[]::text[]),
      ('Other',          'expense', null,            'ellipsis-horizontal-circle-outline', '#8C8782', array[]::text[]),
      ('Salary',         'income',  null,            'briefcase-outline',     '#4F9A6A', array[]::text[]),
      ('Bonus',          'income',  null,            'trophy-outline',        '#4F9A6A', array[]::text[]),
      ('Freelance',      'income',  null,            'laptop-outline',        '#4A8DA8', array[]::text[]),
      ('Interest',       'income',  null,            'cash-outline',          '#4F9690', array[]::text[]),
      ('Dividends',      'income',  null,            'pie-chart-outline',     '#7C83C6', array[]::text[]),
      ('Refunds',        'income',  null,            'return-down-back-outline', '#C08A4F', array[]::text[]),
      ('Gifts Received', 'income',  null,            'gift-outline',          '#A97BB5', array[]::text[]),
      ('Other Income',   'income',  null,            'add-circle-outline',    '#8C8782', array[]::text[])
    ) as v(name, kind, classification, icon, color, subs)
  loop
    i := i + 1;
    insert into public.transaction_categories (user_id, name, kind, classification, icon, color, sort_order)
    values (p_user_id, rec.name, rec.kind::public.category_kind, rec.classification::public.spend_class,
            rec.icon, rec.color, i)
    returning id into parent_id;

    foreach sub in array rec.subs loop
      insert into public.transaction_categories (user_id, parent_id, name, kind, classification, icon, color)
      values (p_user_id, parent_id, sub, rec.kind::public.category_kind,
              rec.classification::public.spend_class, rec.icon, rec.color);
    end loop;
  end loop;
end;
$$;
revoke all on function public.create_default_categories(uuid) from public;
