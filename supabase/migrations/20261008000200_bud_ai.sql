-- =============================================================================
-- BUD AI — the controlled functions the assistant may use
-- =============================================================================
-- BUD AI (Edge Function `bud-ai`) answers questions and proposes actions. It
-- never runs SQL of its own: it can only call the existing report functions
-- (report_summary, report_by_category, report_by_merchant, report_by_account,
-- friend_balances, my_group_positions) and the three below, always with the
-- signed-in user's own token — so row-level security applies to everything it
-- reads. Changes it proposes are made by the app, through the app's existing
-- functions, only after the user taps Confirm.
--
-- * ai_take_quota()          — counts requests; at most 150 a day per user,
--                              so a runaway client can't run up the AI bill.
-- * ai_search_transactions() — finds transactions by date, text, type,
--                              category, account and amount (read-only).
-- * ai_friends()             — accepted friends with what each owes or is owed.
--
-- Additive and idempotent.
-- =============================================================================

create table if not exists public.ai_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists ai_requests_user_idx on public.ai_requests (user_id, created_at desc);
alter table public.ai_requests enable row level security;
-- No policies: only ai_take_quota() (security definer) touches it.
revoke all on public.ai_requests from anon, authenticated;

create or replace function public.ai_take_quota()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  if auth.uid() is null then
    raise exception 'CF900: Sign in to use BUD AI';
  end if;
  -- Serialise per user so two parallel requests can't both squeeze in.
  perform pg_advisory_xact_lock(hashtextextended('ai_quota:' || auth.uid()::text, 0));
  select count(*) into used from public.ai_requests
  where user_id = auth.uid() and created_at > now() - interval '1 day';
  if used >= 150 then
    raise exception 'CF901: BUD AI has answered 150 questions in the last day — try again later';
  end if;
  insert into public.ai_requests (user_id) values (auth.uid());
  -- Keep the table small: a user's rows older than two days are no longer needed.
  delete from public.ai_requests where user_id = auth.uid() and created_at < now() - interval '2 days';
  return 150 - used - 1;
end;
$$;
revoke all on function public.ai_take_quota() from public, anon;
grant execute on function public.ai_take_quota() to authenticated;

create or replace function public.ai_search_transactions(
  p_start        date default null,
  p_end          date default null,
  p_text         text default null,
  p_type         text default null,
  p_category_id  uuid default null,
  p_account_id   uuid default null,
  p_min_amount   numeric default null,
  p_max_amount   numeric default null,
  p_limit        integer default 20,
  p_id           uuid default null
)
returns table (
  id                uuid,
  occurred_at       timestamptz,
  type              text,
  amount            numeric,
  currency          text,
  merchant_name     text,
  category_id       uuid,
  category_name     text,
  subcategory_name  text,
  account_name      text,
  to_account_name   text,
  notes             text,
  source            text,
  shared_expense_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select v.id, v.occurred_at, v.type::text, v.amount, v.currency::text, v.merchant_name,
         v.category_id, v.category_name, v.subcategory_name, v.account_name, v.to_account_name,
         v.notes, v.source::text, v.shared_expense_id
  from public.transactions_view v
  where (p_id is null or v.id = p_id)
    and (p_start is null or v.occurred_at >= public.local_day_start(p_start, public.user_timezone()))
    and (p_end is null or v.occurred_at < public.local_day_start(p_end + 1, public.user_timezone()))
    and (p_text is null or v.search_text ilike '%' || p_text || '%')
    and (p_type is null or v.type::text = p_type)
    and (p_category_id is null or v.category_id = p_category_id or v.subcategory_id = p_category_id)
    and (p_account_id is null or v.account_id = p_account_id or v.to_account_id = p_account_id)
    and (p_min_amount is null or v.amount >= p_min_amount)
    and (p_max_amount is null or v.amount <= p_max_amount)
  order by v.occurred_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
revoke all on function public.ai_search_transactions(date, date, text, text, uuid, uuid, numeric, numeric, integer, uuid)
  from public, anon;
grant execute on function public.ai_search_transactions(date, date, text, text, uuid, uuid, numeric, numeric, integer, uuid)
  to authenticated;

-- Accepted friends, with the non-group balance between us (positive = they owe me).
create or replace function public.ai_friends()
returns table (user_id uuid, name text, username text, net numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with mine as (
    select case when f.user_low = auth.uid() then f.user_high else f.user_low end as other
    from public.friendships f
    where f.status = 'accepted' and auth.uid() in (f.user_low, f.user_high)
  )
  select m.other,
         public.profile_card(m.other) ->> 'name',
         public.profile_card(m.other) ->> 'username',
         coalesce((select sum(b.net) from public.friend_balances() b where b.user_id = m.other), 0)
  from mine m
  order by 2;
$$;
revoke all on function public.ai_friends() from public, anon;
grant execute on function public.ai_friends() to authenticated;
