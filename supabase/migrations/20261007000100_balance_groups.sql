-- =============================================================================
-- Balance groups
--
-- A user decides which payment methods add up together ("Total cash": Axis +
-- HDFC; "Credit": the two cards). Nothing is combined automatically any more.
--
--   balance_groups           one row per group (name, order)
--   balance_group_accounts   which payment methods are in which group
--
-- A group's figures are worked out from its accounts' trigger-maintained
-- balances: cash-type methods add their balance; credit cards contribute what
-- is owed and the credit still available — a card limit is never cash.
--
-- Every existing user gets "Cash" (bank, savings, cash, UPI, debit) and
-- "Credit cards" (cards) to start from; both are ordinary, editable groups.
-- New payment methods join the matching starter group if it still exists.
-- Additive and idempotent.
-- =============================================================================

create table if not exists public.balance_groups (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  -- 'cash' / 'credit' mark the two starter groups (new methods join them); 'custom' otherwise.
  kind        text not null default 'custom' check (kind in ('cash', 'credit', 'custom')),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id)
);
create unique index if not exists balance_groups_user_name_uq
  on public.balance_groups (user_id, lower(btrim(name)));
create index if not exists balance_groups_user_idx on public.balance_groups (user_id, sort_order);

drop trigger if exists balance_groups_updated_at on public.balance_groups;
create trigger balance_groups_updated_at before update on public.balance_groups
  for each row execute function public.tg_set_updated_at();

create table if not exists public.balance_group_accounts (
  group_id    uuid not null,
  account_id  uuid not null,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (group_id, account_id),
  -- Both sides must belong to the same user.
  foreign key (group_id, user_id) references public.balance_groups (id, user_id) on delete cascade,
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade
);
create index if not exists balance_group_accounts_account_idx on public.balance_group_accounts (account_id);

alter table public.balance_groups enable row level security;
alter table public.balance_group_accounts enable row level security;

drop policy if exists balance_groups_select on public.balance_groups;
drop policy if exists balance_groups_insert on public.balance_groups;
drop policy if exists balance_groups_update on public.balance_groups;
drop policy if exists balance_groups_delete on public.balance_groups;
create policy balance_groups_select on public.balance_groups
  for select to authenticated using (user_id = (select auth.uid()));
create policy balance_groups_insert on public.balance_groups
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy balance_groups_update on public.balance_groups
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy balance_groups_delete on public.balance_groups
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists balance_group_accounts_select on public.balance_group_accounts;
drop policy if exists balance_group_accounts_insert on public.balance_group_accounts;
drop policy if exists balance_group_accounts_delete on public.balance_group_accounts;
create policy balance_group_accounts_select on public.balance_group_accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy balance_group_accounts_insert on public.balance_group_accounts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy balance_group_accounts_delete on public.balance_group_accounts
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.balance_groups, public.balance_group_accounts from anon, authenticated;
grant select, delete on public.balance_groups to authenticated;
grant insert (id, user_id, name, kind, sort_order) on public.balance_groups to authenticated;
grant update (name, sort_order) on public.balance_groups to authenticated;
grant select, insert, delete on public.balance_group_accounts to authenticated;

-- ---------------------------------------------------------------------------
-- Starter groups
-- ---------------------------------------------------------------------------
create or replace function public.is_cash_type(t public.account_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select t in ('bank', 'savings', 'cash', 'wallet', 'debit_card');
$$;

/** Creates "Cash" and "Credit cards" for a user who has no groups yet, filled from their accounts. */
create or replace function public.seed_balance_groups(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cash_id   uuid;
  credit_id uuid;
begin
  if exists (select 1 from public.balance_groups g where g.user_id = p_user_id) then
    return;
  end if;
  insert into public.balance_groups (user_id, name, kind, sort_order)
  values (p_user_id, 'Cash', 'cash', 0) returning id into cash_id;
  insert into public.balance_groups (user_id, name, kind, sort_order)
  values (p_user_id, 'Credit cards', 'credit', 1) returning id into credit_id;

  insert into public.balance_group_accounts (group_id, account_id, user_id)
  select case when a.type = 'credit_card' then credit_id else cash_id end, a.id, p_user_id
  from public.accounts a
  where a.user_id = p_user_id
    and a.is_active
    and (public.is_cash_type(a.type) or a.type = 'credit_card')
  on conflict do nothing;
end;
$$;
revoke all on function public.seed_balance_groups(uuid) from public, anon, authenticated;

/** Called by the app on sign-in; harmless when the user already has groups. */
create or replace function public.ensure_balance_groups()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'CF001: Not authenticated';
  end if;
  perform public.seed_balance_groups(auth.uid());
end;
$$;
revoke all on function public.ensure_balance_groups() from public, anon;
grant execute on function public.ensure_balance_groups() to authenticated;

-- New payment methods join the matching starter group (if the user kept it).
create or replace function public.tg_accounts_join_starter_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.balance_group_accounts (group_id, account_id, user_id)
  select g.id, new.id, new.user_id
  from public.balance_groups g
  where g.user_id = new.user_id
    and ((g.kind = 'cash' and public.is_cash_type(new.type))
      or (g.kind = 'credit' and new.type = 'credit_card'))
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists accounts_join_starter_group on public.accounts;
create trigger accounts_join_starter_group after insert on public.accounts
  for each row execute function public.tg_accounts_join_starter_group();

/** Replaces a group's members in one call (the group editor's Save). */
create or replace function public.set_balance_group_accounts(p_group_id uuid, p_account_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.balance_groups g where g.id = p_group_id and g.user_id = auth.uid()) then
    raise exception 'CF404: Group not found';
  end if;
  delete from public.balance_group_accounts
  where group_id = p_group_id and not (account_id = any (coalesce(p_account_ids, '{}')));
  insert into public.balance_group_accounts (group_id, account_id, user_id)
  select p_group_id, a.id, auth.uid()
  from public.accounts a
  where a.user_id = auth.uid() and a.id = any (coalesce(p_account_ids, '{}'))
  on conflict do nothing;
end;
$$;
revoke all on function public.set_balance_group_accounts(uuid, uuid[]) from public, anon;
grant execute on function public.set_balance_group_accounts(uuid, uuid[]) to authenticated;

-- Existing users
do $$
declare
  u record;
begin
  for u in select id from auth.users loop
    perform public.seed_balance_groups(u.id);
  end loop;
end;
$$;
