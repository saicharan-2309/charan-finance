-- =============================================================================
-- BUD AI: exact totals for any time window
-- =============================================================================
-- "How much did I spend in the last hour?" needs a window measured in
-- minutes, not days; "…on my credit cards?" needs several accounts at once.
-- ai_totals() answers both, with exactly the same rules as report_summary:
-- the user's own income and expense transactions in their default currency
-- (transfers between their own accounts and card-bill payments are never
-- spending). Either a day range (in the user's time zone) or two instants.
--
-- Read-only, security invoker (row-level security applies). Additive.
-- =============================================================================

create or replace function public.ai_totals(
  p_start        date default null,
  p_end          date default null,
  p_from         timestamptz default null,
  p_to           timestamptz default null,
  p_account_ids  uuid[] default null,
  p_category_id  uuid default null
)
returns table (income numeric, expense numeric, tx_count bigint, expense_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      coalesce(p_from, public.local_day_start(p_start, public.user_timezone())) as lo,
      coalesce(p_to, public.local_day_start(p_end + 1, public.user_timezone())) as hi,
      public.user_default_currency()::text as cur
  )
  select
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0),
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0),
    count(*),
    count(*) filter (where t.type = 'expense')
  from public.transactions t, params
  where t.user_id = auth.uid()
    and t.occurred_at >= params.lo and t.occurred_at < params.hi
    and t.currency = params.cur
    and t.type in ('income', 'expense')
    and (p_account_ids is null or t.account_id = any (p_account_ids))
    and (p_category_id is null or t.category_id = p_category_id or t.subcategory_id = p_category_id);
$$;
revoke all on function public.ai_totals(date, date, timestamptz, timestamptz, uuid[], uuid) from public, anon;
grant execute on function public.ai_totals(date, date, timestamptz, timestamptz, uuid[], uuid) to authenticated;
