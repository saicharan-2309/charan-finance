-- =============================================================================
-- RPC functions (called by the app through supabase.rpc)
-- =============================================================================
-- All functions are SECURITY INVOKER unless stated otherwise, so Row Level
-- Security applies to everything they read or write.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Merchant resolution: find-or-create by case-insensitive name
-- ---------------------------------------------------------------------------
create or replace function public.resolve_merchant(p_name text, p_category_id uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  clean text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  mid uuid;
begin
  if clean is null then
    return null;
  end if;

  select m.id into mid from public.merchants m
  where m.user_id = auth.uid() and m.normalized_name = lower(clean);

  if mid is null then
    insert into public.merchants (user_id, name, default_category_id)
    values (auth.uid(), left(clean, 80), p_category_id)
    on conflict (user_id, normalized_name) do update set is_archived = false
    returning id into mid;
  else
    update public.merchants
    set is_archived = false,
        default_category_id = coalesce(default_category_id, p_category_id)
    where id = mid and (is_archived or default_category_id is null);
  end if;

  return mid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tag synchronisation
-- ---------------------------------------------------------------------------
create or replace function public.sync_transaction_tags(p_transaction_id uuid, p_tags text[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  clean_tags text[];
begin
  select coalesce(array_agg(distinct t), '{}')
  into clean_tags
  from (
    select left(btrim(x), 30) as t
    from unnest(coalesce(p_tags, '{}')) as x
    where btrim(x) <> ''
  ) s;

  insert into public.tags (user_id, name)
  select auth.uid(), t from unnest(clean_tags) t
  on conflict (user_id, lower(btrim(name))) do nothing;

  delete from public.transaction_tags tt
  using public.tags tg
  where tt.transaction_id = p_transaction_id
    and tg.id = tt.tag_id
    and not (lower(tg.name) = any (select lower(t) from unnest(clean_tags) t));

  insert into public.transaction_tags (transaction_id, tag_id, user_id)
  select p_transaction_id, tg.id, auth.uid()
  from public.tags tg
  where tg.user_id = auth.uid()
    and lower(btrim(tg.name)) in (select lower(t) from unnest(clean_tags) t)
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_transaction — atomic create/update of a transaction with merchant & tags
-- ---------------------------------------------------------------------------
-- p_mode = 'create': idempotent on p_id (safe to replay from the offline queue).
-- p_mode = 'update': optimistic concurrency via p_expected_updated_at.
create or replace function public.save_transaction(
  p_mode                 text,
  p_id                   uuid,
  p_type                 public.txn_type,
  p_amount               numeric,
  p_account_id           uuid,
  p_occurred_at          timestamptz,
  p_to_account_id        uuid default null,
  p_category_id          uuid default null,
  p_subcategory_id       uuid default null,
  p_merchant_id          uuid default null,
  p_merchant_name        text default null,
  p_notes                text default null,
  p_tags                 text[] default null,
  p_expected_updated_at  timestamptz default null
)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing public.transactions;
  result   public.transactions;
  mid      uuid := p_merchant_id;
begin
  if auth.uid() is null then
    raise exception 'CF001: Not authenticated';
  end if;
  if p_mode not in ('create', 'update') then
    raise exception 'CF002: Invalid mode';
  end if;
  if p_amount is null or p_amount <> round(p_amount, 2) then
    raise exception 'CF205: Amount may have at most two decimal places';
  end if;
  if p_type = 'adjustment' then
    raise exception 'CF206: Use set_account_balance for balance adjustments';
  end if;

  if mid is null and p_type <> 'transfer' then
    mid := public.resolve_merchant(p_merchant_name, p_category_id);
  end if;

  select * into existing from public.transactions where id = p_id for update;

  if p_mode = 'create' then
    if found then
      -- Replay of an already-applied create: return the stored row unchanged.
      return existing;
    end if;
    insert into public.transactions (
      id, user_id, type, amount, account_id, to_account_id, category_id,
      subcategory_id, merchant_id, occurred_at, notes
    ) values (
      p_id, auth.uid(), p_type, p_amount, p_account_id, p_to_account_id,
      case when p_type = 'transfer' then null else p_category_id end,
      case when p_type = 'transfer' then null else p_subcategory_id end,
      case when p_type = 'transfer' then null else mid end,
      p_occurred_at, nullif(btrim(coalesce(p_notes, '')), '')
    )
    returning * into result;
  else
    if not found then
      raise exception 'CF207: Transaction not found';
    end if;
    if existing.type = 'adjustment' then
      raise exception 'CF206: Balance adjustments cannot be edited; delete and re-create instead';
    end if;
    if p_expected_updated_at is not null
       and date_trunc('milliseconds', existing.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
      raise exception 'CF409: This transaction was changed elsewhere. Refresh and try again.';
    end if;
    update public.transactions set
      type           = p_type,
      amount         = p_amount,
      currency       = null,  -- re-derived from the (possibly new) account by the validation trigger
      account_id     = p_account_id,
      to_account_id  = p_to_account_id,
      category_id    = case when p_type = 'transfer' then null else p_category_id end,
      subcategory_id = case when p_type = 'transfer' then null else p_subcategory_id end,
      merchant_id    = case when p_type = 'transfer' then null else mid end,
      occurred_at    = p_occurred_at,
      notes          = nullif(btrim(coalesce(p_notes, '')), '')
    where id = p_id
    returning * into result;
  end if;

  if p_tags is not null then
    perform public.sync_transaction_tags(result.id, p_tags);
  end if;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_transaction — returns storage paths of receipts so the client can
-- remove the files (storage objects cannot be deleted from SQL on Supabase).
-- ---------------------------------------------------------------------------
create or replace function public.delete_transaction(p_id uuid)
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  paths text[];
begin
  select coalesce(array_agg(a.storage_path), '{}') into paths
  from public.attachments a where a.transaction_id = p_id;

  delete from public.transactions where id = p_id;
  -- Deleting an id that does not exist (e.g. replayed offline delete) is a no-op.
  return paths;
end;
$$;

-- ---------------------------------------------------------------------------
-- set_account_balance — reconcile an account to a real-world balance by
-- recording a signed adjustment (keeps history auditable).
-- ---------------------------------------------------------------------------
create or replace function public.set_account_balance(
  p_account_id uuid,
  p_new_balance numeric,
  p_note text default null
)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cur numeric(18, 2);
  result public.transactions;
begin
  if p_new_balance <> round(p_new_balance, 2) then
    raise exception 'CF205: Amount may have at most two decimal places';
  end if;

  select a.current_balance into cur from public.accounts a
  where a.id = p_account_id for update;
  if not found then
    raise exception 'CF201: Account not found';
  end if;

  if cur = p_new_balance then
    return null;
  end if;

  insert into public.transactions (user_id, type, amount, account_id, occurred_at, notes)
  values (auth.uid(), 'adjustment', p_new_balance - cur, p_account_id, now(),
          coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Balance adjustment'))
  returning * into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- merge_merchants — move all history from source to target, delete source
-- ---------------------------------------------------------------------------
create or replace function public.merge_merchants(p_source_id uuid, p_target_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  moved integer;
begin
  if p_source_id = p_target_id then
    raise exception 'CF501: Choose two different merchants';
  end if;
  if not exists (select 1 from public.merchants where id = p_source_id)
     or not exists (select 1 from public.merchants where id = p_target_id) then
    raise exception 'CF502: Merchant not found';
  end if;

  update public.transactions set merchant_id = p_target_id where merchant_id = p_source_id;
  get diagnostics moved = row_count;
  update public.recurring_transactions set merchant_id = p_target_id where merchant_id = p_source_id;
  delete from public.merchants where id = p_source_id;
  return moved;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recurrence engine
-- ---------------------------------------------------------------------------
-- Occurrence k is always computed from the anchor (start_date + k * step) so
-- month-end anchors clamp correctly (Jan 31 -> Feb 28 -> Mar 31) without drift.
create or replace function public.recurrence_occurrences(
  p_start date,
  p_frequency public.recurrence_frequency,
  p_interval integer,
  p_end date,
  p_from date,
  p_to date
)
returns setof date
language plpgsql
immutable
set search_path = ''
as $$
declare
  months_step integer;
  days_step integer;
  lo integer;
  hi integer;
  upper_bound date := least(p_to, coalesce(p_end, p_to));
  from_date date := greatest(p_from, p_start);
  months_from integer;
  months_to integer;
begin
  if upper_bound < from_date then
    return;
  end if;

  if p_frequency in ('daily', 'weekly') then
    days_step := p_interval * (case when p_frequency = 'daily' then 1 else 7 end);
    lo := ceil((from_date - p_start)::numeric / days_step)::integer;
    hi := floor((upper_bound - p_start)::numeric / days_step)::integer;
    return query
      select (p_start + k * days_step)::date
      from generate_series(greatest(lo, 0), hi) k;
  else
    months_step := p_interval * (case p_frequency when 'monthly' then 1 when 'quarterly' then 3 else 12 end);
    months_from := (extract(year from from_date)::integer - extract(year from p_start)::integer) * 12
                 + extract(month from from_date)::integer - extract(month from p_start)::integer;
    months_to   := (extract(year from upper_bound)::integer - extract(year from p_start)::integer) * 12
                 + extract(month from upper_bound)::integer - extract(month from p_start)::integer;
    lo := greatest(floor(months_from::numeric / months_step)::integer - 1, 0);
    hi := floor(months_to::numeric / months_step)::integer + 1;
    return query
      select d from (
        select (p_start + make_interval(months => k * months_step))::date as d
        from generate_series(lo, hi) k
      ) s
      where d between from_date and upper_bound
      order by d;
  end if;
end;
$$;

-- Next unhandled occurrence for a template (PostgREST computed field: next_due_date).
create or replace function public.next_due_date(r public.recurring_transactions)
returns date
language sql
stable
set search_path = ''
as $$
  select o
  from public.recurrence_occurrences(
    r.start_date, r.frequency, r.interval_count, r.end_date,
    coalesce(r.last_occurrence_date + 1, r.start_date),
    -- Horizon always spans at least one full period, even for "every N years".
    coalesce(r.last_occurrence_date, r.start_date) + 31 + r.interval_count * 370
  ) o
  order by o
  limit 1;
$$;

create or replace function public.post_recurring_occurrence(
  p_recurring_id uuid,
  p_occurrence date,
  p_amount numeric default null,
  p_transaction_id uuid default null
)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.recurring_transactions;
  due date;
  result public.transactions;
  tz text := public.user_timezone();
begin
  select * into r from public.recurring_transactions where id = p_recurring_id for update;
  if not found then
    raise exception 'CF601: Recurring item not found';
  end if;

  -- Idempotency: already posted?
  select * into result from public.transactions
  where recurring_id = p_recurring_id and recurring_occurrence = p_occurrence;
  if found then
    return result;
  end if;

  if not r.is_active then
    raise exception 'CF602: Recurring item is paused';
  end if;

  due := public.next_due_date(r);
  if due is null or due <> p_occurrence then
    raise exception 'CF603: Only the next due occurrence (%) can be posted', due;
  end if;

  if p_amount is not null and (p_amount <= 0 or p_amount <> round(p_amount, 2)) then
    raise exception 'CF205: Invalid amount';
  end if;

  insert into public.transactions (
    id, user_id, type, amount, account_id, to_account_id, category_id, subcategory_id,
    merchant_id, occurred_at, notes, recurring_id, recurring_occurrence
  ) values (
    coalesce(p_transaction_id, gen_random_uuid()), auth.uid(), r.type, coalesce(p_amount, r.amount),
    r.account_id, r.to_account_id, r.category_id, r.subcategory_id, r.merchant_id,
    ((p_occurrence + time '09:00')::timestamp at time zone tz),
    coalesce(r.notes, r.name), r.id, p_occurrence
  )
  returning * into result;

  update public.recurring_transactions
  set last_occurrence_date = p_occurrence
  where id = r.id;

  return result;
end;
$$;

create or replace function public.skip_recurring_occurrence(p_recurring_id uuid, p_occurrence date)
returns date
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.recurring_transactions;
  due date;
begin
  select * into r from public.recurring_transactions where id = p_recurring_id for update;
  if not found then
    raise exception 'CF601: Recurring item not found';
  end if;
  due := public.next_due_date(r);
  if due is null or due <> p_occurrence then
    raise exception 'CF603: Only the next due occurrence (%) can be skipped', due;
  end if;
  update public.recurring_transactions set last_occurrence_date = p_occurrence where id = r.id;
  select public.next_due_date(x) into due from public.recurring_transactions x where x.id = r.id;
  return due;
end;
$$;

-- Posts every due occurrence of auto-post templates up to today. Idempotent.
create or replace function public.post_due_recurring()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.recurring_transactions;
  due date;
  today date := public.user_today();
  posted integer := 0;
  guard integer;
begin
  for r in
    select * from public.recurring_transactions
    where user_id = auth.uid() and is_active and auto_post
  loop
    guard := 0;
    loop
      select public.next_due_date(x) into due from public.recurring_transactions x where x.id = r.id;
      exit when due is null or due > today or guard >= 400;
      perform public.post_recurring_occurrence(r.id, due);
      posted := posted + 1;
      guard := guard + 1;
    end loop;
  end loop;
  return posted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Net worth snapshots
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so snapshots are always computed from real balances (clients
-- have no insert/update privilege on the table). Scoped explicitly to auth.uid().
create or replace function public.capture_net_worth_snapshot()
returns public.net_worth_snapshots
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cur public.currency_code;
  tz text;
  snap_date date;
  v_assets numeric(18, 2);
  v_liabilities numeric(18, 2);
  v_breakdown jsonb;
  result public.net_worth_snapshots;
begin
  if uid is null then
    raise exception 'CF001: Not authenticated';
  end if;
  select p.default_currency, p.timezone into cur, tz from public.profiles p where p.id = uid;
  cur := coalesce(cur, 'INR');
  snap_date := (now() at time zone coalesce(tz, 'Asia/Kolkata'))::date;

  select
    coalesce(sum(greatest(a.current_balance, 0)), 0),
    coalesce(sum(greatest(-a.current_balance, 0)), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'account_id', a.id, 'name', a.name, 'type', a.type, 'balance', a.current_balance
    ) order by a.sort_order, a.name), '[]'::jsonb)
  into v_assets, v_liabilities, v_breakdown
  from public.accounts a
  where a.user_id = uid and a.is_active and a.include_in_net_worth and a.currency = cur;

  insert into public.net_worth_snapshots (user_id, snapshot_date, currency, assets, liabilities, breakdown)
  values (uid, snap_date, cur, v_assets, v_liabilities, v_breakdown)
  on conflict (user_id, snapshot_date, currency) do update
    set assets = excluded.assets,
        liabilities = excluded.liabilities,
        breakdown = excluded.breakdown
  returning * into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Budgets
-- ---------------------------------------------------------------------------
create or replace function public.budget_period_bounds(
  p_period public.budget_period,
  p_start date,
  p_end date,
  p_ref date
)
returns table (period_start date, period_end date)
language plpgsql
immutable
set search_path = ''
as $$
declare
  k integer;
  step integer;
  s date;
begin
  if p_period = 'custom' then
    return query select p_start, p_end;
    return;
  end if;

  if p_period = 'weekly' then
    k := greatest(floor((p_ref - p_start)::numeric / 7)::integer, 0);
    return query select p_start + k * 7, p_start + k * 7 + 6;
    return;
  end if;

  step := case when p_period = 'monthly' then 1 else 12 end;
  k := greatest(((extract(year from p_ref)::integer - extract(year from p_start)::integer) * 12
        + extract(month from p_ref)::integer - extract(month from p_start)::integer) / step, 0);
  s := (p_start + make_interval(months => k * step))::date;
  if s > p_ref and k > 0 then
    k := k - 1;
    s := (p_start + make_interval(months => k * step))::date;
  end if;
  return query select s, ((p_start + make_interval(months => (k + 1) * step))::date - 1);
end;
$$;

create or replace function public.get_budget_status(
  p_budget_id uuid default null,
  p_ref_date date default null
)
returns table (
  budget_id uuid,
  budget_name text,
  period public.budget_period,
  period_start date,
  period_end date,
  item_id uuid,
  category_id uuid,
  category_name text,
  category_color text,
  category_icon text,
  amount numeric,
  spent numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ref as (
    select coalesce(p_ref_date, public.user_today()) as d, public.user_timezone() as tz
  ),
  b as (
    select bu.*, bounds.period_start as ps, bounds.period_end as pe
    from public.budgets bu
    cross join ref
    cross join lateral public.budget_period_bounds(bu.period, bu.start_date, bu.end_date, ref.d) bounds
    where bu.user_id = auth.uid()
      and (p_budget_id is null or bu.id = p_budget_id)
      and (p_budget_id is not null or bu.is_active)
  )
  select
    b.id, b.name, b.period, b.ps, b.pe,
    bi.id, bi.category_id, c.name, c.color, c.icon,
    bi.amount,
    coalesce((
      select sum(t.amount)
      from public.transactions t, ref
      where t.user_id = auth.uid()
        and t.type = 'expense'
        and t.currency = b.currency
        and t.occurred_at >= public.local_day_start(b.ps, ref.tz)
        and t.occurred_at <  public.local_day_start(b.pe + 1, ref.tz)
        and (bi.category_id is null or t.category_id = bi.category_id)
    ), 0)
  from b
  join public.budget_items bi on bi.budget_id = b.id
  left join public.transaction_categories c on c.id = bi.category_id
  order by b.name, bi.category_id nulls first, c.name;
$$;
