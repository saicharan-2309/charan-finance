-- =============================================================================
-- Read models: views and reporting functions
-- =============================================================================
-- Views use security_invoker so the caller's RLS applies.
-- Date range parameters are LOCAL calendar dates (user's timezone, inclusive)
-- and are converted to timestamptz bounds so the occurred_at index is used.
-- Transfers and adjustments never count as income or expense.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- transactions_view — denormalised list rows for the Transactions screen
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
  )) as search_text
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
-- Period summary
-- ---------------------------------------------------------------------------
create or replace function public.report_summary(
  p_start date,
  p_end date,
  p_currency text default null
)
returns table (
  income numeric,
  expense numeric,
  net numeric,
  transaction_count bigint,
  expense_count bigint,
  recurring_expense numeric,
  subscription_expense numeric,
  essential_expense numeric,
  discretionary_expense numeric,
  day_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select public.local_day_start(p_start, public.user_timezone()) as lo,
           public.local_day_start(p_end + 1, public.user_timezone()) as hi,
           coalesce(p_currency, public.user_default_currency()::text) as cur
  ),
  tx as (
    select t.*, c.classification, r.kind as recurring_kind
    from public.transactions t
    cross join params
    left join public.transaction_categories c on c.id = t.category_id
    left join public.recurring_transactions r on r.id = t.recurring_id
    where t.user_id = auth.uid()
      and t.occurred_at >= params.lo and t.occurred_at < params.hi
      and t.currency = params.cur
      and t.type in ('income', 'expense')
  )
  select
    coalesce(sum(amount) filter (where type = 'income'), 0),
    coalesce(sum(amount) filter (where type = 'expense'), 0),
    coalesce(sum(amount) filter (where type = 'income'), 0) - coalesce(sum(amount) filter (where type = 'expense'), 0),
    count(*),
    count(*) filter (where type = 'expense'),
    coalesce(sum(amount) filter (where type = 'expense' and recurring_id is not null), 0),
    coalesce(sum(amount) filter (where type = 'expense' and recurring_kind = 'subscription'), 0),
    coalesce(sum(amount) filter (where type = 'expense' and classification = 'essential'), 0),
    coalesce(sum(amount) filter (where type = 'expense' and classification = 'discretionary'), 0),
    (p_end - p_start + 1)
  from tx;
$$;

-- ---------------------------------------------------------------------------
-- Category breakdown (top level, or subcategories of p_parent_id)
-- ---------------------------------------------------------------------------
create or replace function public.report_by_category(
  p_start date,
  p_end date,
  p_kind public.category_kind default 'expense',
  p_parent_id uuid default null,
  p_merchant_id uuid default null,
  p_account_id uuid default null
)
returns table (
  category_id uuid,
  name text,
  icon text,
  color text,
  classification public.spend_class,
  total numeric,
  tx_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select public.local_day_start(p_start, public.user_timezone()) as lo,
           public.local_day_start(p_end + 1, public.user_timezone()) as hi,
           public.user_default_currency()::text as cur
  ),
  tx as (
    select t.*
    from public.transactions t, params
    where t.user_id = auth.uid()
      and t.type::text = p_kind::text
      and t.currency = params.cur
      and t.occurred_at >= params.lo and t.occurred_at < params.hi
      and (p_parent_id is null or t.category_id = p_parent_id)
      and (p_merchant_id is null or t.merchant_id = p_merchant_id)
      and (p_account_id is null or t.account_id = p_account_id)
  )
  select
    c.id, coalesce(c.name, 'No subcategory'), c.icon, c.color, c.classification,
    sum(tx.amount), count(*)
  from tx
  left join public.transaction_categories c
    on c.id = case when p_parent_id is null then tx.category_id else tx.subcategory_id end
  group by c.id, c.name, c.icon, c.color, c.classification
  order by sum(tx.amount) desc;
$$;

-- ---------------------------------------------------------------------------
-- Merchant breakdown
-- ---------------------------------------------------------------------------
create or replace function public.report_by_merchant(
  p_start date,
  p_end date,
  p_limit integer default 50,
  p_category_id uuid default null
)
returns table (
  merchant_id uuid,
  name text,
  total numeric,
  tx_count bigint,
  average numeric,
  largest numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select public.local_day_start(p_start, public.user_timezone()) as lo,
           public.local_day_start(p_end + 1, public.user_timezone()) as hi,
           public.user_default_currency()::text as cur
  )
  select m.id, m.name, sum(t.amount), count(*), round(avg(t.amount), 2), max(t.amount)
  from public.transactions t
  cross join params
  join public.merchants m on m.id = t.merchant_id
  where t.user_id = auth.uid()
    and t.type = 'expense'
    and t.currency = params.cur
    and t.occurred_at >= params.lo and t.occurred_at < params.hi
    and (p_category_id is null or t.category_id = p_category_id)
  group by m.id, m.name
  order by sum(t.amount) desc
  limit least(greatest(p_limit, 1), 500);
$$;

-- ---------------------------------------------------------------------------
-- Account / payment-method breakdown
-- ---------------------------------------------------------------------------
create or replace function public.report_by_account(p_start date, p_end date)
returns table (
  account_id uuid,
  name text,
  type public.account_type,
  expense numeric,
  income numeric,
  tx_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select public.local_day_start(p_start, public.user_timezone()) as lo,
           public.local_day_start(p_end + 1, public.user_timezone()) as hi
  )
  select a.id, a.name, a.type,
         coalesce(sum(t.amount) filter (where t.type = 'expense'), 0),
         coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
         count(t.id)
  from public.transactions t
  cross join params
  join public.accounts a on a.id = t.account_id
  where t.user_id = auth.uid()
    and t.type in ('income', 'expense')
    and t.occurred_at >= params.lo and t.occurred_at < params.hi
  group by a.id, a.name, a.type
  order by 4 desc;
$$;

-- ---------------------------------------------------------------------------
-- Time series with zero-filled buckets
-- ---------------------------------------------------------------------------
create or replace function public.report_time_series(
  p_start date,
  p_end date,
  p_bucket text default 'month',
  p_category_id uuid default null,
  p_merchant_id uuid default null,
  p_account_id uuid default null
)
returns table (bucket date, income numeric, expense numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  tz text := public.user_timezone();
  cur text := public.user_default_currency()::text;
  step interval;
begin
  if p_bucket not in ('day', 'week', 'month') then
    raise exception 'CF701: Invalid bucket';
  end if;
  if p_end - p_start > 3700 then
    raise exception 'CF702: Date range too large';
  end if;
  step := ('1 ' || p_bucket)::interval;

  return query
  with buckets as (
    select gs::date as b
    from generate_series(
      date_trunc(p_bucket, p_start::timestamp),
      date_trunc(p_bucket, p_end::timestamp),
      step
    ) gs
  ),
  agg as (
    select date_trunc(p_bucket, (t.occurred_at at time zone tz))::date as b,
           sum(t.amount) filter (where t.type = 'income') as inc,
           sum(t.amount) filter (where t.type = 'expense') as exp
    from public.transactions t
    where t.user_id = auth.uid()
      and t.type in ('income', 'expense')
      and t.currency = cur
      and t.occurred_at >= public.local_day_start(p_start, tz)
      and t.occurred_at <  public.local_day_start(p_end + 1, tz)
      and (p_category_id is null or t.category_id = p_category_id)
      and (p_merchant_id is null or t.merchant_id = p_merchant_id)
      and (p_account_id is null or t.account_id = p_account_id)
    group by 1
  )
  select buckets.b, coalesce(agg.inc, 0), coalesce(agg.exp, 0)
  from buckets left join agg on agg.b = buckets.b
  order by buckets.b;
end;
$$;

-- ---------------------------------------------------------------------------
-- Merchant lifetime statistics
-- ---------------------------------------------------------------------------
create or replace function public.merchant_stats(p_merchant_id uuid)
returns table (
  total numeric,
  tx_count bigint,
  average numeric,
  largest numeric,
  first_at timestamptz,
  last_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(t.amount), 0), count(*), coalesce(round(avg(t.amount), 2), 0),
         coalesce(max(t.amount), 0), min(t.occurred_at), max(t.occurred_at)
  from public.transactions t
  where t.user_id = auth.uid() and t.merchant_id = p_merchant_id and t.type = 'expense'
    and t.currency = public.user_default_currency()::text;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard — one round trip for the Home screen
-- ---------------------------------------------------------------------------
create or replace function public.get_dashboard(p_month_start date, p_month_end date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  prev_start date := (p_month_start - interval '1 month')::date;
  prev_end date := p_month_start - 1;
  trend_start date := (date_trunc('month', p_month_start) - interval '5 months')::date;
  cur text := public.user_default_currency()::text;
begin
  return jsonb_build_object(
    'currency', cur,
    'current', (select to_jsonb(s) from public.report_summary(p_month_start, p_month_end) s),
    'previous', (select to_jsonb(s) from public.report_summary(prev_start, prev_end) s),
    'categories', coalesce((
      select jsonb_agg(to_jsonb(c)) from public.report_by_category(p_month_start, p_month_end) c
    ), '[]'::jsonb),
    'previous_categories', coalesce((
      select jsonb_agg(to_jsonb(c)) from public.report_by_category(prev_start, prev_end) c
    ), '[]'::jsonb),
    'merchants', coalesce((
      select jsonb_agg(to_jsonb(m)) from public.report_by_merchant(p_month_start, p_month_end, 5) m
    ), '[]'::jsonb),
    'trend', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.bucket)
      from public.report_time_series(trend_start, p_month_end, 'month') t
    ), '[]'::jsonb),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'type', a.type, 'currency', a.currency,
        'current_balance', a.current_balance, 'credit_limit', a.credit_limit,
        'include_in_net_worth', a.include_in_net_worth, 'color', a.color, 'icon', a.icon
      ) order by a.sort_order, a.name)
      from public.accounts a
      where a.user_id = auth.uid() and a.is_active
    ), '[]'::jsonb)
  );
end;
$$;
