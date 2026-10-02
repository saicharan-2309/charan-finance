-- =============================================================================
-- Integrity triggers, balance maintenance, new-user bootstrap
-- =============================================================================
-- Error messages use stable machine codes ("CFxxx: ...") so the app can map
-- them to friendly text without leaking raw database errors to users.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.user_timezone()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select p.timezone from public.profiles p where p.id = auth.uid()),
    'Asia/Kolkata'
  );
$$;

create or replace function public.user_default_currency()
returns public.currency_code
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select p.default_currency from public.profiles p where p.id = auth.uid()),
    'INR'
  )::public.currency_code;
$$;

-- The user's "today" in their own timezone.
create or replace function public.user_today()
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select (now() at time zone public.user_timezone())::date;
$$;

-- Start of a local calendar day as an absolute timestamp.
create or replace function public.local_day_start(p_day date, p_tz text)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (p_day::timestamp at time zone p_tz);
$$;

-- ---------------------------------------------------------------------------
-- Accounts: current_balance bookkeeping
-- ---------------------------------------------------------------------------
create or replace function public.tg_accounts_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Ignore any client-supplied balance: a new account starts at its opening balance.
    new.current_balance := new.opening_balance;
    return new;
  end if;

  if new.opening_balance is distinct from old.opening_balance then
    new.current_balance := new.current_balance + (new.opening_balance - old.opening_balance);
  end if;

  if new.currency is distinct from old.currency and exists (
    select 1 from public.transactions t
    where t.account_id = old.id or t.to_account_id = old.id
  ) then
    raise exception 'CF101: Account currency cannot change once it has transactions';
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'CF100: Ownership cannot be changed';
  end if;

  return new;
end;
$$;

create trigger accounts_before_write
  before insert or update on public.accounts
  for each row execute function public.tg_accounts_before_write();

-- Signed effect of one transaction on balances.
create or replace function public.apply_transaction_effect(t public.transactions, direction integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  amt numeric(18, 2) := t.amount * direction;
begin
  if t.type = 'expense' then
    update public.accounts set current_balance = current_balance - amt where id = t.account_id;
  elsif t.type = 'income' then
    update public.accounts set current_balance = current_balance + amt where id = t.account_id;
  elsif t.type = 'transfer' then
    update public.accounts set current_balance = current_balance - amt where id = t.account_id;
    update public.accounts set current_balance = current_balance + amt where id = t.to_account_id;
  elsif t.type = 'adjustment' then
    update public.accounts set current_balance = current_balance + amt where id = t.account_id;
  end if;
end;
$$;
revoke all on function public.apply_transaction_effect(public.transactions, integer) from public;

create or replace function public.tg_transactions_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.type = new.type
     and old.amount = new.amount
     and old.account_id = new.account_id
     and old.to_account_id is not distinct from new.to_account_id then
    return null; -- nothing financial changed
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    perform public.apply_transaction_effect(old, -1);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.apply_transaction_effect(new, 1);
  end if;
  return null;
end;
$$;

create trigger transactions_balance
  after insert or update or delete on public.transactions
  for each row execute function public.tg_transactions_balance();

-- Recomputes balances from scratch. Used by tests and the in-app integrity check.
create or replace function public.verify_account_balances()
returns table (account_id uuid, stored_balance numeric, computed_balance numeric, is_consistent boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with effects as (
    select t.account_id as acc,
           case t.type
             when 'expense' then -t.amount
             when 'income' then t.amount
             when 'transfer' then -t.amount
             when 'adjustment' then t.amount
           end as delta
    from public.transactions t
    where t.user_id = auth.uid()
    union all
    select t.to_account_id, t.amount
    from public.transactions t
    where t.user_id = auth.uid() and t.type = 'transfer'
  )
  select a.id,
         a.current_balance,
         a.opening_balance + coalesce(sum(e.delta), 0),
         a.current_balance = a.opening_balance + coalesce(sum(e.delta), 0)
  from public.accounts a
  left join effects e on e.acc = a.id
  where a.user_id = auth.uid()
  group by a.id;
$$;

-- ---------------------------------------------------------------------------
-- Transactions: validation
-- ---------------------------------------------------------------------------
create or replace function public.tg_transactions_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  acc   record;
  dest  record;
  cat   record;
  sub   record;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'CF100: Ownership cannot be changed';
  end if;

  select a.currency, a.is_active into acc
  from public.accounts a where a.id = new.account_id and a.user_id = new.user_id;
  if not found then
    raise exception 'CF201: Account not found';
  end if;

  if new.currency is null then
    new.currency := acc.currency;
  elsif new.currency <> acc.currency then
    raise exception 'CF202: Transaction currency must match the account currency';
  end if;

  if tg_op = 'INSERT' and not acc.is_active then
    raise exception 'CF203: Account is archived';
  end if;

  if new.type = 'transfer' then
    select a.currency, a.is_active into dest
    from public.accounts a where a.id = new.to_account_id and a.user_id = new.user_id;
    if not found then
      raise exception 'CF201: Destination account not found';
    end if;
    if dest.currency <> acc.currency then
      raise exception 'CF204: Transfers between different currencies are not supported yet';
    end if;
    if tg_op = 'INSERT' and not dest.is_active then
      raise exception 'CF203: Destination account is archived';
    end if;
  end if;

  if new.category_id is not null then
    select c.kind, c.parent_id into cat
    from public.transaction_categories c
    where c.id = new.category_id and c.user_id = new.user_id;
    if not found then
      raise exception 'CF301: Category not found';
    end if;
    if cat.parent_id is not null then
      raise exception 'CF302: Use the parent category with a subcategory';
    end if;
    if cat.kind::text <> new.type::text then
      raise exception 'CF303: Category type does not match transaction type';
    end if;
  end if;

  if new.subcategory_id is not null then
    select c.parent_id into sub
    from public.transaction_categories c
    where c.id = new.subcategory_id and c.user_id = new.user_id;
    if not found or sub.parent_id is distinct from new.category_id then
      raise exception 'CF304: Subcategory does not belong to the category';
    end if;
  end if;

  return new;
end;
$$;

create trigger transactions_validate
  before insert or update on public.transactions
  for each row execute function public.tg_transactions_validate();

-- ---------------------------------------------------------------------------
-- Recurring templates: validation (same rules as transactions)
-- ---------------------------------------------------------------------------
create or replace function public.tg_recurring_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  acc  record;
  dest record;
  cat  record;
  sub  record;
begin
  select a.currency into acc from public.accounts a
  where a.id = new.account_id and a.user_id = new.user_id;
  if not found then
    raise exception 'CF201: Account not found';
  end if;
  new.currency := acc.currency;

  if new.type = 'transfer' then
    select a.currency into dest from public.accounts a
    where a.id = new.to_account_id and a.user_id = new.user_id;
    if not found then
      raise exception 'CF201: Destination account not found';
    end if;
    if dest.currency <> acc.currency then
      raise exception 'CF204: Transfers between different currencies are not supported yet';
    end if;
  end if;

  if new.category_id is not null then
    select c.kind, c.parent_id into cat from public.transaction_categories c
    where c.id = new.category_id and c.user_id = new.user_id;
    if not found then
      raise exception 'CF301: Category not found';
    end if;
    if cat.parent_id is not null then
      raise exception 'CF302: Use the parent category with a subcategory';
    end if;
    if cat.kind::text <> new.type::text then
      raise exception 'CF303: Category type does not match transaction type';
    end if;
  end if;

  if new.subcategory_id is not null then
    select c.parent_id into sub from public.transaction_categories c
    where c.id = new.subcategory_id and c.user_id = new.user_id;
    if not found or sub.parent_id is distinct from new.category_id then
      raise exception 'CF304: Subcategory does not belong to the category';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'CF100: Ownership cannot be changed';
  end if;

  return new;
end;
$$;

create trigger recurring_validate
  before insert or update on public.recurring_transactions
  for each row execute function public.tg_recurring_validate();

-- ---------------------------------------------------------------------------
-- Categories: two-level hierarchy, consistent kind
-- ---------------------------------------------------------------------------
create or replace function public.tg_categories_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent record;
begin
  if new.parent_id is not null then
    select c.parent_id, c.kind into parent from public.transaction_categories c
    where c.id = new.parent_id and c.user_id = new.user_id;
    if not found then
      raise exception 'CF301: Parent category not found';
    end if;
    if parent.parent_id is not null then
      raise exception 'CF305: Subcategories cannot have their own subcategories';
    end if;
    new.kind := parent.kind;
  end if;

  if tg_op = 'UPDATE' then
    if new.kind is distinct from old.kind and (
      exists (select 1 from public.transactions t where t.category_id = old.id or t.subcategory_id = old.id)
      or exists (select 1 from public.transaction_categories c where c.parent_id = old.id)
    ) then
      raise exception 'CF306: Category type cannot change once it is in use';
    end if;
    if new.parent_id is distinct from old.parent_id and (
      exists (select 1 from public.transactions t where t.category_id = old.id or t.subcategory_id = old.id)
      or exists (select 1 from public.transaction_categories c where c.parent_id = old.id)
    ) then
      raise exception 'CF307: A category that is in use cannot be moved';
    end if;
    if new.user_id is distinct from old.user_id then
      raise exception 'CF100: Ownership cannot be changed';
    end if;
    -- Archiving a parent archives its subcategories too.
    if new.is_archived and not old.is_archived and new.parent_id is null then
      update public.transaction_categories set is_archived = true
      where parent_id = new.id and not is_archived;
    end if;
  end if;

  return new;
end;
$$;

create trigger categories_validate
  before insert or update on public.transaction_categories
  for each row execute function public.tg_categories_validate();

-- ---------------------------------------------------------------------------
-- Savings goals: current_amount = initial_amount + sum(contributions)
-- ---------------------------------------------------------------------------
create or replace function public.tg_goals_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'CF100: Ownership cannot be changed';
  end if;
  new.current_amount := new.initial_amount + coalesce((
    select sum(gc.amount) from public.goal_contributions gc where gc.goal_id = new.id
  ), 0);
  return new;
end;
$$;

create trigger goals_before_write
  before insert or update on public.savings_goals
  for each row execute function public.tg_goals_before_write();

create or replace function public.tg_goal_contributions_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid := coalesce(new.goal_id, old.goal_id);
begin
  -- Touch the goal so its BEFORE trigger recomputes current_amount.
  update public.savings_goals set updated_at = now() where id = gid;
  if tg_op = 'UPDATE' and old.goal_id <> new.goal_id then
    update public.savings_goals set updated_at = now() where id = old.goal_id;
  end if;
  return null;
end;
$$;

create trigger goal_contributions_after
  after insert or update or delete on public.goal_contributions
  for each row execute function public.tg_goal_contributions_after();

-- Prevent a goal from going below zero via withdrawals.
create or replace function public.tg_goal_contributions_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cur numeric(18, 2);
begin
  if new.amount < 0 then
    select g.current_amount into cur from public.savings_goals g where g.id = new.goal_id;
    if cur + new.amount - (case when tg_op = 'UPDATE' then old.amount else 0 end) < 0 then
      raise exception 'CF401: Withdrawal exceeds the amount saved for this goal';
    end if;
  end if;
  return new;
end;
$$;

create trigger goal_contributions_validate
  before insert or update on public.goal_contributions
  for each row execute function public.tg_goal_contributions_validate();

-- ---------------------------------------------------------------------------
-- Default categories (real, user-editable reference data — not demo data)
-- ---------------------------------------------------------------------------
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
      ('Food',           'expense', 'discretionary', 'fast-food-outline',     '#EA580C', array['Snacks & Coffee', 'Food Delivery']),
      ('Groceries',      'expense', 'essential',     'basket-outline',        '#16A34A', array[]::text[]),
      ('Restaurants',    'expense', 'discretionary', 'restaurant-outline',    '#EF4444', array[]::text[]),
      ('Shopping',       'expense', 'discretionary', 'bag-handle-outline',    '#EC4899', array['Clothing', 'Electronics', 'Home']),
      ('Transport',      'expense', 'essential',     'car-outline',           '#3B82F6', array['Cab & Auto', 'Public Transport', 'Parking & Tolls']),
      ('Fuel',           'expense', 'essential',     'speedometer-outline',   '#0284C7', array[]::text[]),
      ('Travel',         'expense', 'discretionary', 'airplane-outline',      '#0891B2', array['Flights', 'Hotels']),
      ('Entertainment',  'expense', 'discretionary', 'film-outline',          '#A855F7', array[]::text[]),
      ('Bills',          'expense', 'essential',     'receipt-outline',       '#64748B', array[]::text[]),
      ('Utilities',      'expense', 'essential',     'flash-outline',         '#CA8A04', array['Electricity', 'Water', 'Gas', 'Mobile & Internet']),
      ('Rent',           'expense', 'essential',     'home-outline',          '#8B5CF6', array[]::text[]),
      ('Healthcare',     'expense', 'essential',     'medkit-outline',        '#F43F5E', array['Medicines', 'Doctor']),
      ('Fitness',        'expense', 'discretionary', 'barbell-outline',       '#059669', array[]::text[]),
      ('Education',      'expense', 'essential',     'school-outline',        '#6366F1', array[]::text[]),
      ('Subscriptions',  'expense', 'discretionary', 'repeat-outline',        '#D946EF', array[]::text[]),
      ('Insurance',      'expense', 'essential',     'shield-checkmark-outline', '#0D9488', array[]::text[]),
      ('Personal Care',  'expense', 'discretionary', 'sparkles-outline',      '#FB7185', array[]::text[]),
      ('Gifts',          'expense', 'discretionary', 'gift-outline',          '#D97706', array[]::text[]),
      ('Investments',    'expense', null,            'trending-up-outline',   '#16A34A', array[]::text[]),
      ('Other',          'expense', null,            'ellipsis-horizontal-circle-outline', '#64748B', array[]::text[]),
      ('Salary',         'income',  null,            'briefcase-outline',     '#16A34A', array[]::text[]),
      ('Bonus',          'income',  null,            'trophy-outline',        '#16A34A', array[]::text[]),
      ('Freelance',      'income',  null,            'laptop-outline',        '#0284C7', array[]::text[]),
      ('Interest',       'income',  null,            'cash-outline',          '#0D9488', array[]::text[]),
      ('Dividends',      'income',  null,            'pie-chart-outline',     '#6366F1', array[]::text[]),
      ('Refunds',        'income',  null,            'return-down-back-outline', '#D97706', array[]::text[]),
      ('Gifts Received', 'income',  null,            'gift-outline',          '#EC4899', array[]::text[]),
      ('Other Income',   'income',  null,            'add-circle-outline',    '#64748B', array[]::text[])
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

-- ---------------------------------------------------------------------------
-- New user bootstrap (fires on Supabase Auth sign-up)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80), ''))
  on conflict (id) do nothing;

  insert into public.app_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  perform public.create_default_categories(new.id);
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
