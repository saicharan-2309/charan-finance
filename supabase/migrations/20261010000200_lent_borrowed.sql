-- =============================================================================
-- Lent & borrowed — money between you and anyone (not only BUD friends)
-- =============================================================================
-- "I gave Ravi ₹5,000 in August" must be trackable without taking ₹5,000 off
-- today's bank balance (it left long ago), and "I lend Ravi ₹2,000 now from
-- my HDFC account" must take it off HDFC — but neither is ever spending, and
-- getting it back is never income.
--
-- Model (the same double-entry idea as the Friends account):
--   * One system account per user, "Lent & borrowed" (system_kind 'lending',
--     other_asset). Its balance is always: owed to you − you owe.
--   * Lent, before BUD   → an adjustment +amount on that account (no bank change)
--     Lent, from account → a transfer account → Lent & borrowed
--     Borrowed           → the mirror image (−amount / transfer the other way)
--   * A repayment moves it back: into an account (transfer), or "outside BUD"
--     (an adjustment that only reduces what's owed).
--   * Transfers and adjustments are never income or spending in any report.
--
-- Every write goes through the functions below; ledger rows they create
-- (source 'lending') can only be changed from Lent & borrowed. Additive.
-- =============================================================================

-- 1. System account kind, transaction source and links ------------------------
alter table public.accounts drop constraint if exists accounts_system_kind_check;
alter table public.accounts add constraint accounts_system_kind_check
  check (system_kind is null or system_kind in ('friends', 'lending'));

alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source in ('manual', 'sms', 'import', 'recurring', 'receipt', 'shared', 'settlement', 'lending'));

-- 2. Tables ------------------------------------------------------------------
create table if not exists public.ious (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  direction    text not null check (direction in ('lent', 'borrowed')),
  person       text not null check (char_length(btrim(person)) between 1 and 80),
  amount       public.money_amount not null check (amount > 0),
  currency     public.currency_code not null default 'INR',
  occurred_on  date not null,
  due_on       date,
  note         text check (char_length(note) <= 500),
  -- Where the money came from / went to; null = it happened before BUD.
  account_id   uuid references public.accounts (id) on delete set null,
  closed_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists ious_user_idx on public.ious (user_id, occurred_on desc);

create table if not exists public.iou_repayments (
  id           uuid primary key default gen_random_uuid(),
  iou_id       uuid not null references public.ious (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount       public.money_amount not null check (amount > 0),
  occurred_on  date not null,
  -- The account it went into / came out of; null = outside BUD (e.g. cash you don't track).
  account_id   uuid references public.accounts (id) on delete set null,
  note         text check (char_length(note) <= 500),
  created_at   timestamptz not null default now()
);
create index if not exists iou_repayments_iou_idx on public.iou_repayments (iou_id);

alter table public.transactions
  add column if not exists iou_id uuid references public.ious (id) on delete set null,
  add column if not exists iou_repayment_id uuid references public.iou_repayments (id) on delete set null;
create index if not exists transactions_iou_idx on public.transactions (iou_id) where iou_id is not null;

alter table public.ious enable row level security;
alter table public.iou_repayments enable row level security;
drop policy if exists ious_select on public.ious;
create policy ious_select on public.ious for select to authenticated using (user_id = auth.uid());
drop policy if exists iou_repayments_select on public.iou_repayments;
create policy iou_repayments_select on public.iou_repayments for select to authenticated using (user_id = auth.uid());
revoke all on public.ious, public.iou_repayments from anon;
revoke insert, update, delete on public.ious, public.iou_repayments from authenticated;
grant select on public.ious, public.iou_repayments to authenticated;

-- 3. Ledger guard: lending rows change only through Lent & borrowed -----------
create or replace function public.tg_protect_lending_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('cf.friends_booking', true), '') = 'on'
     or not public.user_exists(old.user_id) then
    return coalesce(new, old);
  end if;
  if old.source = 'lending' then
    raise exception 'CF711: This was recorded in Lent & borrowed — change it there';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists transactions_protect_lending on public.transactions;
create trigger transactions_protect_lending
  before update or delete on public.transactions
  for each row execute function public.tg_protect_lending_ledger();

-- 4. The system account ---------------------------------------------------------
create or replace function public.lending_account(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc uuid;
  cur public.currency_code;
begin
  select a.id into acc from public.accounts a where a.user_id = p_user_id and a.system_kind = 'lending';
  if acc is not null then
    return acc;
  end if;
  select coalesce(p.default_currency, 'INR') into cur from public.profiles p where p.id = p_user_id;
  insert into public.accounts (user_id, name, type, currency, icon, system_kind, include_in_net_worth, sort_order)
  values (p_user_id, 'Lent & borrowed', 'other_asset', coalesce(cur, 'INR'), 'swap-horizontal-outline', 'lending', true, 9998)
  on conflict do nothing
  returning id into acc;
  if acc is null then
    insert into public.accounts (user_id, name, type, currency, icon, system_kind, include_in_net_worth, sort_order)
    values (p_user_id, 'Lent & borrowed (BUD)', 'other_asset', coalesce(cur, 'INR'), 'swap-horizontal-outline', 'lending', true, 9998)
    returning id into acc;
  end if;
  return acc;
end;
$$;
revoke all on function public.lending_account(uuid) from public, anon, authenticated;

-- Books one movement on the ledger. p_signed > 0 means money owed to you goes up.
create or replace function public.book_lending(
  p_user uuid, p_iou uuid, p_repayment uuid, p_signed numeric, p_account uuid, p_on date, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  lend uuid := public.lending_account(p_user);
  cur  public.currency_code;
  at   timestamptz := p_on::timestamptz + interval '12 hours';
begin
  select currency into cur from public.accounts where id = lend;
  perform set_config('cf.friends_booking', 'on', true);
  if p_account is null then
    -- Happened outside your tracked accounts: only what's owed changes.
    insert into public.transactions (user_id, type, amount, currency, account_id, occurred_at, notes, source,
                                     iou_id, iou_repayment_id)
    values (p_user, 'adjustment', p_signed, cur, lend, at, left(p_note, 2000), 'lending', p_iou, p_repayment);
  elsif p_signed > 0 then
    -- Money left your account and is now owed to you (or you repaid what you owed).
    insert into public.transactions (user_id, type, amount, currency, account_id, to_account_id, occurred_at, notes,
                                     source, iou_id, iou_repayment_id)
    values (p_user, 'transfer', p_signed, cur, p_account, lend, at, left(p_note, 2000), 'lending', p_iou, p_repayment);
  else
    -- Money came into your account from what was owed (or you borrowed it).
    insert into public.transactions (user_id, type, amount, currency, account_id, to_account_id, occurred_at, notes,
                                     source, iou_id, iou_repayment_id)
    values (p_user, 'transfer', -p_signed, cur, lend, p_account, at, left(p_note, 2000), 'lending', p_iou, p_repayment);
  end if;
  perform set_config('cf.friends_booking', 'off', true);
end;
$$;
revoke all on function public.book_lending(uuid, uuid, uuid, numeric, uuid, date, text) from public, anon, authenticated;

-- 5. Writes -------------------------------------------------------------------
create or replace function public.create_iou(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  dir    text := p ->> 'direction';
  person text := btrim(coalesce(p ->> 'person', ''));
  amt    numeric := (p ->> 'amount')::numeric;
  day    date := coalesce((p ->> 'occurred_on')::date, current_date);
  acct   uuid := nullif(p ->> 'account_id', '')::uuid;
  new_id uuid;
begin
  if me is null then raise exception 'CF401: Sign in first'; end if;
  if dir not in ('lent', 'borrowed') then raise exception 'CF720: Choose lent or borrowed'; end if;
  if char_length(person) not between 1 and 80 then raise exception 'CF721: Who was it? Add a name'; end if;
  if amt is null or amt <= 0 or amt <> round(amt, 2) then raise exception 'CF722: Enter the amount'; end if;
  if day > current_date + 1 then raise exception 'CF723: That date is in the future'; end if;
  if acct is not null and not exists (
    select 1 from public.accounts where id = acct and user_id = me and system_kind is null and is_active) then
    raise exception 'CF201: Account not found';
  end if;

  insert into public.ious (user_id, direction, person, amount, currency, occurred_on, due_on, note, account_id)
  values (me, dir, person, amt,
          coalesce((select currency from public.accounts where id = acct),
                   (select default_currency from public.profiles where id = me), 'INR'),
          day, nullif(p ->> 'due_on', '')::date, nullif(left(p ->> 'note', 500), ''), acct)
  returning ious.id into new_id;

  perform public.book_lending(me, new_id, null, case when dir = 'lent' then amt else -amt end, acct, day,
    case when dir = 'lent' then 'Lent to ' else 'Borrowed from ' end || person
      || case when acct is null then ' (before BUD)' else '' end);
  return new_id;
end;
$$;

create or replace function public.iou_outstanding(p_iou uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select i.amount - coalesce((select sum(r.amount) from public.iou_repayments r where r.iou_id = i.id), 0)
  from public.ious i where i.id = p_iou and i.user_id = auth.uid();
$$;

create or replace function public.record_iou_repayment(
  p_iou uuid, p_amount numeric, p_on date default current_date, p_account_id uuid default null,
  p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me   uuid := auth.uid();
  i    public.ious;
  left_amt numeric;
  rid  uuid;
begin
  select * into i from public.ious where id = p_iou and user_id = me for update;
  if not found then raise exception 'CF404: Not found'; end if;
  left_amt := i.amount - coalesce((select sum(amount) from public.iou_repayments where iou_id = i.id), 0);
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'CF722: Enter the amount';
  end if;
  if p_amount > left_amt then
    raise exception 'CF724: That is more than the % still owed', left_amt;
  end if;
  if coalesce(p_on, current_date) > current_date + 1 then raise exception 'CF723: That date is in the future'; end if;
  if p_account_id is not null and not exists (
    select 1 from public.accounts where id = p_account_id and user_id = me and system_kind is null and is_active) then
    raise exception 'CF201: Account not found';
  end if;

  insert into public.iou_repayments (iou_id, user_id, amount, occurred_on, account_id, note)
  values (i.id, me, p_amount, coalesce(p_on, current_date), p_account_id, nullif(left(p_note, 500), ''))
  returning id into rid;

  -- Being paid back lowers what's owed to you; paying back lowers what you owe.
  perform public.book_lending(me, i.id, rid, case when i.direction = 'lent' then -p_amount else p_amount end,
    p_account_id, coalesce(p_on, current_date),
    case when i.direction = 'lent' then i.person || ' paid back' else 'Paid back ' || i.person end);

  update public.ious set closed_at = case when p_amount = left_amt then now() else null end where id = i.id;
  return rid;
end;
$$;

-- Undo a repayment, or a whole IOU with its repayments — balances return exactly.
create or replace function public.delete_iou_repayment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r  public.iou_repayments;
begin
  select * into r from public.iou_repayments where id = p_id and user_id = me;
  if not found then raise exception 'CF404: Not found'; end if;
  perform set_config('cf.friends_booking', 'on', true);
  delete from public.transactions where iou_repayment_id = r.id and user_id = me;
  perform set_config('cf.friends_booking', 'off', true);
  delete from public.iou_repayments where id = r.id;
  update public.ious set closed_at = null where id = r.iou_id;
end;
$$;

create or replace function public.delete_iou(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if not exists (select 1 from public.ious where id = p_id and user_id = me) then
    raise exception 'CF404: Not found';
  end if;
  perform set_config('cf.friends_booking', 'on', true);
  delete from public.transactions where iou_id = p_id and user_id = me;
  perform set_config('cf.friends_booking', 'off', true);
  delete from public.ious where id = p_id;
end;
$$;

revoke all on function public.create_iou(jsonb) from public, anon;
revoke all on function public.record_iou_repayment(uuid, numeric, date, uuid, text) from public, anon;
revoke all on function public.delete_iou_repayment(uuid) from public, anon;
revoke all on function public.delete_iou(uuid) from public, anon;
revoke all on function public.iou_outstanding(uuid) from public, anon;
grant execute on function public.create_iou(jsonb) to authenticated;
grant execute on function public.record_iou_repayment(uuid, numeric, date, uuid, text) to authenticated;
grant execute on function public.delete_iou_repayment(uuid) to authenticated;
grant execute on function public.delete_iou(uuid) to authenticated;
grant execute on function public.iou_outstanding(uuid) to authenticated;
