-- =============================================================================
-- Friends: connections, messaging, groups, shared expenses and settlements
--
-- Money model (double-entry, on the existing ledger)
-- ---------------------------------------------------------------------------
-- Every user has one system payment method, "Friends" (type other_asset,
-- system_kind 'friends'). Its balance is what friends owe you minus what you
-- owe them, across everyone. It is booked like this:
--
--   You paid ₹2,400, split three ways (₹800 each):
--     expense  ₹800   from your bank      (your own spending)
--     transfer ₹1,600 bank → Friends      (money owed to you — not spending)
--   A friend's share of a bill someone else paid:
--     expense  ₹800   from their Friends  (their spending; no bank movement yet)
--   Settling up (they pay you ₹800):
--     theirs:  transfer ₹800 their bank → their Friends
--     yours:   transfer ₹800 your Friends → your bank
--
-- So account balances are always the real money, personal spending is only
-- your share, and the Friends balance returns to 0 when everything is settled.
-- Reports, budgets and net worth need no special cases: transfers are never
-- spending or income.
--
-- Each user books only their own side. A participant's share is booked for
-- them automatically (it needs no bank account); the payer's side and the
-- receiving side of a settlement are booked by that person, choosing their
-- own account (or linking an existing transaction, e.g. one from an SMS).
--
-- Privacy
-- ---------------------------------------------------------------------------
-- No policy lets one user read another's accounts, transactions or profile
-- row. Other people are only ever seen through these tables (participants
-- only) and through SECURITY DEFINER functions that return a public card:
-- name, username, status. All writes go through validating functions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Profile fields for being found by friends
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists username     text,
  add column if not exists status       text,
  add column if not exists discoverable boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_username_check') then
    alter table public.profiles add constraint profiles_username_check
      check (username is null or username ~ '^[a-z0-9_.]{3,20}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_status_check') then
    alter table public.profiles add constraint profiles_status_check
      check (status is null or char_length(status) <= 80);
  end if;
end;
$$;
create unique index if not exists profiles_username_uq on public.profiles (username) where username is not null;

grant update (display_name, default_currency, timezone, status, discoverable) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Ledger hooks: the system "Friends" account and links on transactions
-- ---------------------------------------------------------------------------
alter table public.accounts add column if not exists system_kind text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_system_kind_check') then
    alter table public.accounts add constraint accounts_system_kind_check
      check (system_kind is null or system_kind = 'friends');
  end if;
end;
$$;
create unique index if not exists accounts_system_kind_uq
  on public.accounts (user_id, system_kind) where system_kind is not null;

alter table public.transactions
  add column if not exists shared_expense_id uuid,
  add column if not exists settlement_id     uuid;

alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check
  check (source in ('manual', 'sms', 'import', 'recurring', 'receipt', 'shared', 'settlement'));

create index if not exists transactions_shared_expense_idx
  on public.transactions (shared_expense_id) where shared_expense_id is not null;
create index if not exists transactions_settlement_idx
  on public.transactions (settlement_id) where settlement_id is not null;

-- True while the user still exists — false during the cascade of an account deletion.
create or replace function public.user_exists(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users u where u.id = p_user_id);
$$;
revoke all on function public.user_exists(uuid) from public, anon;
grant execute on function public.user_exists(uuid) to authenticated;

-- Rows booked by the Friends functions can't be edited or deleted directly —
-- only by those functions, which set cf.friends_booking for the transaction.
create or replace function public.tg_protect_friends_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('cf.friends_booking', true), '') = 'on'
     or not public.user_exists(old.user_id) then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.source in ('shared', 'settlement') then
      raise exception 'CF701: This was booked by a shared expense — change it from the shared expense';
    end if;
    return old;
  end if;
  if old.source in ('shared', 'settlement')
     and (new.amount, new.type, new.account_id, new.to_account_id, new.shared_expense_id, new.settlement_id)
         is distinct from
         (old.amount, old.type, old.account_id, old.to_account_id, old.shared_expense_id, old.settlement_id) then
    raise exception 'CF701: This was booked by a shared expense — change it from the shared expense';
  end if;
  if old.shared_expense_id is not null and new.amount is distinct from old.amount then
    raise exception 'CF701: This payment is linked to a shared expense — change it from the shared expense';
  end if;
  return new;
end;
$$;
drop trigger if exists transactions_protect_friends_ledger on public.transactions;
create trigger transactions_protect_friends_ledger
  before update or delete on public.transactions
  for each row execute function public.tg_protect_friends_ledger();

-- The Friends account can't be deleted or retyped by hand.
create or replace function public.tg_protect_system_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('cf.friends_booking', true), '') = 'on'
     or not public.user_exists(old.user_id) then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' and old.system_kind is not null then
    raise exception 'CF702: The Friends balance is managed by BUD and can''t be deleted';
  end if;
  if tg_op = 'UPDATE' and old.system_kind is not null
     and (new.type is distinct from old.type or new.is_active is distinct from old.is_active) then
    raise exception 'CF702: The Friends balance is managed by BUD';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists accounts_protect_system on public.accounts;
create trigger accounts_protect_system
  before update or delete on public.accounts
  for each row execute function public.tg_protect_system_account();

create or replace function public.friends_account(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc uuid;
  cur public.currency_code;
begin
  select a.id into acc from public.accounts a where a.user_id = p_user_id and a.system_kind = 'friends';
  if acc is not null then
    return acc;
  end if;
  select coalesce(p.default_currency, 'INR') into cur from public.profiles p where p.id = p_user_id;
  insert into public.accounts (user_id, name, type, currency, icon, system_kind, include_in_net_worth, sort_order)
  values (p_user_id, 'Friends', 'other_asset', coalesce(cur, 'INR'), 'people-outline', 'friends', true, 9999)
  on conflict do nothing
  returning id into acc;
  if acc is null then
    -- A user-made account is already called "Friends".
    insert into public.accounts (user_id, name, type, currency, icon, system_kind, include_in_net_worth, sort_order)
    values (p_user_id, 'Friends (BUD)', 'other_asset', coalesce(cur, 'INR'), 'people-outline', 'friends', true, 9999)
    returning id into acc;
  end if;
  return acc;
end;
$$;
revoke all on function public.friends_account(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Notification preferences
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists notify_friend_requests  boolean not null default true,
  add column if not exists notify_messages         boolean not null default true,
  add column if not exists notify_shared_expenses  boolean not null default true,
  add column if not exists notify_settlements      boolean not null default true,
  add column if not exists notify_reminders        boolean not null default true;

grant update (notify_friend_requests, notify_messages, notify_shared_expenses, notify_settlements,
              notify_reminders)
  on public.app_settings to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  user_low      uuid not null references auth.users (id) on delete cascade,
  user_high     uuid not null references auth.users (id) on delete cascade,
  requested_by  uuid not null references auth.users (id) on delete cascade,
  status        text not null check (status in ('pending', 'accepted', 'declined', 'blocked')),
  blocked_by    uuid references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  responded_at  timestamptz,
  check (user_low < user_high),
  check (requested_by in (user_low, user_high)),
  check ((status = 'blocked') = (blocked_by is not null)),
  unique (user_low, user_high)
);
create index if not exists friendships_high_idx on public.friendships (user_high, status);
create index if not exists friendships_low_idx on public.friendships (user_low, status);

create table if not exists public.split_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  created_by  uuid not null references auth.users (id) on delete cascade,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.split_group_members (
  group_id   uuid not null references public.split_groups (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  added_by   uuid references auth.users (id) on delete set null,
  joined_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists split_group_members_user_idx on public.split_group_members (user_id);

create table if not exists public.conversations (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('direct', 'group')),
  direct_key       text unique,
  group_id         uuid unique references public.split_groups (id) on delete cascade,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz,
  check ((kind = 'direct') = (direct_key is not null)),
  check ((kind = 'group') = (group_id is not null))
);

create table if not exists public.conversation_members (
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  joined_at        timestamptz not null default now(),
  last_read_at     timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id);

create table if not exists public.shared_expenses (
  id                     uuid primary key default gen_random_uuid(),
  group_id               uuid references public.split_groups (id) on delete set null,
  created_by             uuid not null references auth.users (id) on delete cascade,
  paid_by                uuid not null references auth.users (id) on delete cascade,
  title                  text not null check (char_length(btrim(title)) between 1 and 80),
  category_name          text check (char_length(category_name) <= 40),
  icon                   text check (char_length(icon) <= 40),
  total                  public.money_amount not null check (total > 0),
  currency               public.currency_code not null default 'INR',
  occurred_on            date not null,
  notes                  text check (char_length(notes) <= 500),
  split_method           text not null check (split_method in ('equal', 'amount', 'percent', 'shares', 'items')),
  status                 text not null default 'active' check (status in ('active', 'cancelled')),
  -- Payer's side: booked when the payer chooses an account or links a payment.
  payer_booked           boolean not null default false,
  linked_transaction_id  uuid,
  linked_original        jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists shared_expenses_paid_by_idx on public.shared_expenses (paid_by, occurred_on desc);
create index if not exists shared_expenses_group_idx on public.shared_expenses (group_id, occurred_on desc);

create table if not exists public.shared_expense_shares (
  shared_expense_id  uuid not null references public.shared_expenses (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  amount             public.money_amount not null check (amount >= 0),
  -- What was typed for this person: amount, percent or number of shares.
  input_value        numeric(18, 4),
  booked             boolean not null default false,
  primary key (shared_expense_id, user_id)
);
create index if not exists shared_expense_shares_user_idx on public.shared_expense_shares (user_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_shared_expense_fk') then
    alter table public.transactions add constraint transactions_shared_expense_fk
      foreign key (shared_expense_id) references public.shared_expenses (id) on delete set null;
  end if;
end;
$$;

create table if not exists public.settlements (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid references public.split_groups (id) on delete set null,
  from_user   uuid not null references auth.users (id) on delete cascade,
  to_user     uuid not null references auth.users (id) on delete cascade,
  amount      public.money_amount not null check (amount > 0),
  currency    public.currency_code not null default 'INR',
  settled_on  date not null default current_date,
  note        text check (char_length(note) <= 200),
  created_by  uuid not null references auth.users (id) on delete cascade,
  from_booked boolean not null default false,
  to_booked   boolean not null default false,
  created_at  timestamptz not null default now(),
  check (from_user <> to_user),
  check (created_by in (from_user, to_user))
);
create index if not exists settlements_from_idx on public.settlements (from_user, created_at desc);
create index if not exists settlements_to_idx on public.settlements (to_user, created_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_settlement_fk') then
    alter table public.transactions add constraint transactions_settlement_fk
      foreign key (settlement_id) references public.settlements (id) on delete set null;
  end if;
end;
$$;

create table if not exists public.settlement_allocations (
  settlement_id      uuid not null references public.settlements (id) on delete cascade,
  shared_expense_id  uuid not null references public.shared_expenses (id) on delete cascade,
  amount             public.money_amount not null check (amount > 0),
  primary key (settlement_id, shared_expense_id)
);
create index if not exists settlement_allocations_expense_idx on public.settlement_allocations (shared_expense_id);

create table if not exists public.messages (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references public.conversations (id) on delete cascade,
  sender_id          uuid not null references auth.users (id) on delete cascade,
  kind               text not null default 'text'
                     check (kind in ('text', 'expense', 'reminder', 'settlement', 'system')),
  body               text not null check (char_length(body) between 1 and 2000),
  shared_expense_id  uuid references public.shared_expenses (id) on delete set null,
  settlement_id      uuid references public.settlements (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at desc);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,
  kind        text not null check (kind in (
                'friend_request', 'friend_accepted', 'message', 'expense_added', 'expense_updated',
                'expense_cancelled', 'settlement_marked', 'settlement_completed', 'reminder')),
  title       text not null check (char_length(title) <= 120),
  body        text check (char_length(body) <= 300),
  data        jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create table if not exists public.push_tokens (
  user_id     uuid not null references auth.users (id) on delete cascade,
  token       text not null check (char_length(token) between 10 and 300),
  platform    text check (platform in ('ios', 'android', 'web')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, token)
);

-- ---------------------------------------------------------------------------
-- 5. Membership helpers (SECURITY DEFINER so policies don't recurse)
-- ---------------------------------------------------------------------------
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.user_low = least(a, b) and f.user_high = greatest(a, b) and f.status = 'accepted');
$$;

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.user_low = least(a, b) and f.user_high = greatest(a, b) and f.status = 'blocked');
$$;

create or replace function public.is_group_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.split_group_members m where m.group_id = p_group_id and m.user_id = p_user_id);
$$;

create or replace function public.is_conversation_member(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = p_conversation_id and m.user_id = p_user_id);
$$;

create or replace function public.is_expense_participant(p_expense_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shared_expenses e
    where e.id = p_expense_id
      and (e.paid_by = p_user_id or e.created_by = p_user_id
           or exists (select 1 from public.shared_expense_shares s
                      where s.shared_expense_id = e.id and s.user_id = p_user_id)));
$$;

-- ---------------------------------------------------------------------------
-- 6. Row level security — read access only; writes go through functions
-- ---------------------------------------------------------------------------
alter table public.friendships            enable row level security;
alter table public.split_groups           enable row level security;
alter table public.split_group_members    enable row level security;
alter table public.conversations          enable row level security;
alter table public.conversation_members   enable row level security;
alter table public.shared_expenses        enable row level security;
alter table public.shared_expense_shares  enable row level security;
alter table public.settlements            enable row level security;
alter table public.settlement_allocations enable row level security;
alter table public.messages               enable row level security;
alter table public.notifications          enable row level security;
alter table public.push_tokens            enable row level security;

do $$
declare
  p record;
begin
  for p in
    select policyname, tablename from pg_policies
    where schemaname = 'public' and tablename in (
      'friendships', 'split_groups', 'split_group_members', 'conversations', 'conversation_members',
      'shared_expenses', 'shared_expense_shares', 'settlements', 'settlement_allocations', 'messages',
      'notifications', 'push_tokens')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end;
$$;

create policy friendships_select on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_low, user_high)
         -- A blocked person can't see that they were blocked.
         and not (status = 'blocked' and blocked_by <> (select auth.uid())));

create policy split_groups_select on public.split_groups for select to authenticated
  using (public.is_group_member(id, (select auth.uid())));
create policy split_group_members_select on public.split_group_members for select to authenticated
  using (public.is_group_member(group_id, (select auth.uid())));

create policy conversations_select on public.conversations for select to authenticated
  using (public.is_conversation_member(id, (select auth.uid())));
create policy conversation_members_select on public.conversation_members for select to authenticated
  using (public.is_conversation_member(conversation_id, (select auth.uid())));

create policy shared_expenses_select on public.shared_expenses for select to authenticated
  using (public.is_expense_participant(id, (select auth.uid())));
create policy shared_expense_shares_select on public.shared_expense_shares for select to authenticated
  using (public.is_expense_participant(shared_expense_id, (select auth.uid())));

create policy settlements_select on public.settlements for select to authenticated
  using ((select auth.uid()) in (from_user, to_user)
         or (group_id is not null and public.is_group_member(group_id, (select auth.uid()))));
create policy settlement_allocations_select on public.settlement_allocations for select to authenticated
  using (exists (select 1 from public.settlements s where s.id = settlement_id
                 and ((select auth.uid()) in (s.from_user, s.to_user)
                      or (s.group_id is not null and public.is_group_member(s.group_id, (select auth.uid()))))));

create policy messages_select on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id, (select auth.uid())));

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy push_tokens_select on public.push_tokens for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_tokens_delete on public.push_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.friendships, public.split_groups, public.split_group_members, public.conversations,
  public.conversation_members, public.shared_expenses, public.shared_expense_shares, public.settlements,
  public.settlement_allocations, public.messages, public.notifications, public.push_tokens
  from anon, authenticated;
grant select on public.friendships, public.split_groups, public.split_group_members, public.conversations,
  public.conversation_members, public.shared_expenses, public.shared_expense_shares, public.settlements,
  public.settlement_allocations, public.messages, public.notifications, public.push_tokens
  to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.push_tokens to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Public profile card and notifications
-- ---------------------------------------------------------------------------
create or replace function public.profile_card(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', coalesce(p.display_name, p.username, 'BUD user'),
    'username', p.username,
    'status', p.status)
  from public.profiles p where p.id = p_user_id;
$$;

create or replace function public.notify(
  p_user_id uuid, p_actor uuid, p_kind text, p_title text, p_body text, p_data jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.app_settings;
  wanted boolean := true;
begin
  if p_user_id is null or p_user_id = p_actor then
    return;
  end if;
  select * into s from public.app_settings where user_id = p_user_id;
  if found then
    wanted := case
      when p_kind in ('friend_request', 'friend_accepted') then s.notify_friend_requests
      when p_kind = 'message' then s.notify_messages
      when p_kind in ('expense_added', 'expense_updated', 'expense_cancelled') then s.notify_shared_expenses
      when p_kind in ('settlement_marked', 'settlement_completed') then s.notify_settlements
      when p_kind = 'reminder' then s.notify_reminders
      else true end;
  end if;
  if not wanted then
    return;
  end if;
  insert into public.notifications (user_id, actor_id, kind, title, body, data)
  values (p_user_id, p_actor, p_kind, left(p_title, 120), left(p_body, 300), coalesce(p_data, '{}'::jsonb));
end;
$$;
revoke all on function public.notify(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Push delivery through Expo, when pg_net is available (it is on Supabase).
create or replace function public.tg_notifications_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return new;
  end if;
  select jsonb_agg(jsonb_build_object(
           'to', t.token, 'title', new.title, 'body', coalesce(new.body, ''), 'sound', 'default',
           'data', new.data || jsonb_build_object('kind', new.kind, 'notification_id', new.id)))
    into payload
  from public.push_tokens t where t.user_id = new.user_id;
  if payload is not null then
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      using 'https://exp.host/--/api/v2/push/send', payload,
            '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb;
  end if;
  return new;
exception when others then
  -- Push is best effort; the in-app notification is already saved.
  return new;
end;
$$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function public.tg_notifications_push();

create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.push_tokens (user_id, token, platform)
  values (auth.uid(), p_token, p_platform)
  on conflict (user_id, token) do update set updated_at = now(), platform = excluded.platform;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.notifications set read_at = now()
    where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids))
    returning 1)
  select count(*)::integer from u;
$$;

-- ---------------------------------------------------------------------------
-- 8. Username and finding people
-- ---------------------------------------------------------------------------
create or replace function public.set_username(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  u text := lower(btrim(p_username));
begin
  if auth.uid() is null then raise exception 'CF001: Not authenticated'; end if;
  if u !~ '^[a-z0-9_.]{3,20}$' then
    raise exception 'CF610: Use 3–20 letters, numbers, dots or underscores';
  end if;
  if exists (select 1 from public.profiles p where p.username = u and p.id <> auth.uid()) then
    raise exception 'CF611: That username is taken';
  end if;
  update public.profiles set username = u where id = auth.uid();
  return u;
end;
$$;

/** People matching a username prefix (2+ characters) or an exact email; never blocked ones. */
create or replace function public.search_people(p_query text)
returns table (id uuid, name text, username text, status text, relation text)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (select lower(btrim(coalesce(p_query, ''))) as s, auth.uid() as me)
  select p.id,
         coalesce(p.display_name, p.username, 'BUD user'),
         p.username,
         p.status,
         case
           when f.status = 'accepted' then 'friend'
           when f.status = 'pending' and f.requested_by = q.me then 'requested'
           when f.status = 'pending' then 'incoming'
           else 'none' end
  from public.profiles p
  cross join q
  left join public.friendships f
    on f.user_low = least(p.id, q.me) and f.user_high = greatest(p.id, q.me)
  where q.me is not null
    and p.id <> q.me
    and p.discoverable
    and coalesce(f.status, '') <> 'blocked'
    and char_length(q.s) >= 2
    and (p.username like replace(replace(ltrim(q.s, '@'), '_', '\_'), '%', '\%') || '%'
         or exists (select 1 from auth.users au where au.id = p.id and lower(au.email) = q.s))
  order by p.username nulls last
  limit 20;
$$;

-- ---------------------------------------------------------------------------
-- 9. Friend requests
-- ---------------------------------------------------------------------------
create or replace function public.send_friend_request(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  f  public.friendships;
begin
  if me is null then raise exception 'CF001: Not authenticated'; end if;
  if p_user_id is null or p_user_id = me then raise exception 'CF600: You can''t add yourself'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'CF604: That person isn''t on BUD';
  end if;

  select * into f from public.friendships
  where user_low = least(me, p_user_id) and user_high = greatest(me, p_user_id)
  for update;

  if found then
    if f.status = 'blocked' then
      -- Same message either way, so a block is never revealed.
      raise exception 'CF603: You can''t send a request to this person';
    elsif f.status = 'accepted' then
      raise exception 'CF601: You''re already friends';
    elsif f.status = 'pending' and f.requested_by = me then
      raise exception 'CF602: Request already sent';
    elsif f.status = 'pending' then
      -- They had already asked: this accepts it.
      update public.friendships set status = 'accepted', responded_at = now(), updated_at = now()
      where id = f.id;
      perform public.notify(p_user_id, me, 'friend_accepted', 'Friend request accepted',
        coalesce((select display_name from public.profiles where id = me), 'Someone') || ' accepted your request',
        jsonb_build_object('user_id', me));
      return 'accepted';
    else
      -- Declined before: asking again is allowed.
      update public.friendships
      set status = 'pending', requested_by = me, responded_at = null, updated_at = now()
      where id = f.id;
    end if;
  else
    insert into public.friendships (user_low, user_high, requested_by, status)
    values (least(me, p_user_id), greatest(me, p_user_id), me, 'pending');
  end if;

  perform public.notify(p_user_id, me, 'friend_request', 'New friend request',
    coalesce((select display_name from public.profiles where id = me), 'Someone') || ' wants to connect on BUD',
    jsonb_build_object('user_id', me));
  return 'requested';
end;
$$;

create or replace function public.respond_friend_request(p_user_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  f  public.friendships;
begin
  select * into f from public.friendships
  where user_low = least(me, p_user_id) and user_high = greatest(me, p_user_id) for update;
  if not found or f.status <> 'pending' or f.requested_by = me then
    raise exception 'CF605: There''s no request to answer';
  end if;
  update public.friendships
  set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now(), updated_at = now()
  where id = f.id;
  if p_accept then
    perform public.notify(p_user_id, me, 'friend_accepted', 'Friend request accepted',
      coalesce((select display_name from public.profiles where id = me), 'Someone') || ' accepted your request',
      jsonb_build_object('user_id', me));
  end if;
  return case when p_accept then 'accepted' else 'declined' end;
end;
$$;

/** Removes a friend or withdraws/ignores a request. Shared expenses and debts stay. */
create or replace function public.remove_friend(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.friendships
  where user_low = least(auth.uid(), p_user_id) and user_high = greatest(auth.uid(), p_user_id)
    and status <> 'blocked';
$$;

create or replace function public.block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null or p_user_id is null or p_user_id = me then raise exception 'CF600: Invalid user'; end if;
  insert into public.friendships (user_low, user_high, requested_by, status, blocked_by)
  values (least(me, p_user_id), greatest(me, p_user_id), me, 'blocked', me)
  on conflict (user_low, user_high) do update
    set status = 'blocked', blocked_by = me, updated_at = now()
    where public.friendships.status <> 'blocked';
end;
$$;

create or replace function public.unblock_user(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.friendships
  where user_low = least(auth.uid(), p_user_id) and user_high = greatest(auth.uid(), p_user_id)
    and status = 'blocked' and blocked_by = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 10. Balances
-- ---------------------------------------------------------------------------
/**
 * Net position, person to person, for everything shared outside groups.
 * Positive: they owe you. Every active non-group shared expense and every
 * non-group settlement counts once, whether or not either side has booked
 * it in their own accounts yet. Group debts live in group_balances(), where
 * the fewest-payments plan may route money between any two members.
 */
create or replace function public.friend_balances()
returns table (user_id uuid, name text, username text, net numeric, currency text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as id),
  lines as (
    -- I paid: each other participant owes me their share.
    select s.user_id as other, s.amount as amt, e.currency
    from public.shared_expenses e join public.shared_expense_shares s on s.shared_expense_id = e.id, me
    where e.status = 'active' and e.group_id is null and e.paid_by = me.id and s.user_id <> me.id
    union all
    -- They paid: I owe them my share.
    select e.paid_by, -s.amount, e.currency
    from public.shared_expenses e join public.shared_expense_shares s on s.shared_expense_id = e.id, me
    where e.status = 'active' and e.group_id is null and s.user_id = me.id and e.paid_by <> me.id
    union all
    -- They paid me back.
    select st.from_user, -st.amount, st.currency from public.settlements st, me
    where st.to_user = me.id and st.group_id is null
    union all
    -- I paid them back.
    select st.to_user, st.amount, st.currency from public.settlements st, me
    where st.from_user = me.id and st.group_id is null
  )
  select l.other, coalesce(p.display_name, p.username, 'BUD user'), p.username, sum(l.amt), l.currency::text
  from lines l join public.profiles p on p.id = l.other
  group by l.other, p.display_name, p.username, l.currency
  having sum(l.amt) <> 0;
$$;

/** Each member's net position inside a group (paid minus share, plus settlements within the group). */
create or replace function public.group_balances(p_group_id uuid)
returns table (user_id uuid, name text, net numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_group_member(p_group_id, auth.uid()) then
    raise exception 'CF404: Group not found';
  end if;
  return query
  with lines as (
    select e.paid_by as uid, e.total as amt from public.shared_expenses e
    where e.group_id = p_group_id and e.status = 'active'
    union all
    select s.user_id, -s.amount from public.shared_expenses e
    join public.shared_expense_shares s on s.shared_expense_id = e.id
    where e.group_id = p_group_id and e.status = 'active'
    union all
    select st.from_user, st.amount from public.settlements st where st.group_id = p_group_id
    union all
    select st.to_user, -st.amount from public.settlements st where st.group_id = p_group_id
  )
  select m.user_id, coalesce(p.display_name, p.username, 'BUD user'), coalesce(sum(l.amt), 0)
  from public.split_group_members m
  join public.profiles p on p.id = m.user_id
  left join lines l on l.uid = m.user_id
  where m.group_id = p_group_id
  group by m.user_id, p.display_name, p.username;
end;
$$;

/** Your net position in each group you're in (positive: the group owes you). */
create or replace function public.my_group_positions()
returns table (group_id uuid, name text, net numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.name, coalesce((select b.net from public.group_balances(g.id) b where b.user_id = auth.uid()), 0)
  from public.split_groups g
  where public.is_group_member(g.id, auth.uid()) and not g.is_archived;
$$;

-- ---------------------------------------------------------------------------
-- 11. Conversations and messages
-- ---------------------------------------------------------------------------
create or replace function public.direct_conversation(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me  uuid := auth.uid();
  k   text;
  cid uuid;
begin
  if me is null then raise exception 'CF001: Not authenticated'; end if;
  if not public.are_friends(me, p_user_id) then
    raise exception 'CF620: You can only message friends';
  end if;
  k := least(me, p_user_id)::text || ':' || greatest(me, p_user_id)::text;
  select id into cid from public.conversations where direct_key = k;
  if cid is null then
    insert into public.conversations (kind, direct_key) values ('direct', k)
    on conflict (direct_key) do nothing returning id into cid;
    if cid is null then
      select id into cid from public.conversations where direct_key = k;
    end if;
    insert into public.conversation_members (conversation_id, user_id)
    values (cid, me), (cid, p_user_id) on conflict do nothing;
  end if;
  return cid;
end;
$$;

create or replace function public.post_message(
  p_conversation_id uuid, p_sender uuid, p_kind text, p_body text,
  p_shared_expense_id uuid default null, p_settlement_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  mid uuid;
  sender_name text;
  m record;
begin
  insert into public.messages (conversation_id, sender_id, kind, body, shared_expense_id, settlement_id)
  values (p_conversation_id, p_sender, p_kind, left(btrim(p_body), 2000), p_shared_expense_id, p_settlement_id)
  returning id into mid;
  update public.conversations set last_message_at = now() where id = p_conversation_id;
  update public.conversation_members set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = p_sender;
  if p_kind in ('text', 'reminder') then
    select coalesce(display_name, username, 'Someone') into sender_name from public.profiles where id = p_sender;
    for m in select user_id from public.conversation_members
             where conversation_id = p_conversation_id and user_id <> p_sender loop
      perform public.notify(m.user_id, p_sender, case when p_kind = 'reminder' then 'reminder' else 'message' end,
        sender_name, left(p_body, 140), jsonb_build_object('conversation_id', p_conversation_id));
    end loop;
  end if;
  return mid;
end;
$$;
revoke all on function public.post_message(uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.send_message(p_conversation_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  other uuid;
begin
  if not public.is_conversation_member(p_conversation_id, me) then
    raise exception 'CF404: Conversation not found';
  end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then
    raise exception 'CF621: Message is empty';
  end if;
  -- In a direct chat, a block (either way) stops new messages.
  select m.user_id into other from public.conversation_members m
  join public.conversations c on c.id = m.conversation_id and c.kind = 'direct'
  where m.conversation_id = p_conversation_id and m.user_id <> me;
  if other is not null and public.is_blocked_between(me, other) then
    raise exception 'CF603: You can''t message this person';
  end if;
  return public.post_message(p_conversation_id, me, 'text', p_body);
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversation_members set last_read_at = now()
  where conversation_id = p_conversation_id and user_id = auth.uid();
$$;

create or replace function public.list_conversations()
returns table (
  id uuid, kind text, title text, other_user_id uuid, group_id uuid,
  last_body text, last_kind text, last_at timestamptz, unread integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.kind,
    coalesce(g.name, coalesce(op.display_name, op.username, 'BUD user')),
    ou.user_id, c.group_id,
    lm.body, lm.kind, lm.created_at,
    (select count(*)::integer from public.messages x
       where x.conversation_id = c.id and x.sender_id <> auth.uid() and x.created_at > me.last_read_at)
  from public.conversation_members me
  join public.conversations c on c.id = me.conversation_id
  left join public.split_groups g on g.id = c.group_id
  left join lateral (
    select m2.user_id from public.conversation_members m2
    where m2.conversation_id = c.id and m2.user_id <> auth.uid() and c.kind = 'direct' limit 1) ou on true
  left join public.profiles op on op.id = ou.user_id
  left join lateral (
    select m.body, m.kind, m.created_at from public.messages m
    where m.conversation_id = c.id order by m.created_at desc limit 1) lm on true
  where me.user_id = auth.uid()
  order by coalesce(lm.created_at, c.created_at) desc;
$$;

-- ---------------------------------------------------------------------------
-- 12. Groups
-- ---------------------------------------------------------------------------
create or replace function public.create_split_group(p_name text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me  uuid := auth.uid();
  gid uuid;
  cid uuid;
  m   uuid;
begin
  if me is null then raise exception 'CF001: Not authenticated'; end if;
  foreach m in array coalesce(p_member_ids, '{}') loop
    if m <> me and not public.are_friends(me, m) then
      raise exception 'CF630: Everyone in a group must be your friend';
    end if;
  end loop;
  insert into public.split_groups (name, created_by) values (btrim(p_name), me) returning id into gid;
  insert into public.split_group_members (group_id, user_id, added_by)
  select gid, u, me from (select distinct unnest(array_append(coalesce(p_member_ids, '{}'), me)) as u) x;
  insert into public.conversations (kind, group_id) values ('group', gid) returning id into cid;
  insert into public.conversation_members (conversation_id, user_id)
  select cid, user_id from public.split_group_members where group_id = gid;
  perform public.post_message(cid, me, 'system',
    coalesce((select display_name from public.profiles where id = me), 'Someone') || ' created ' || btrim(p_name));
  return gid;
end;
$$;

create or replace function public.add_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if not public.is_group_member(p_group_id, me) then raise exception 'CF404: Group not found'; end if;
  if not public.are_friends(me, p_user_id) then
    raise exception 'CF630: You can only add your friends';
  end if;
  insert into public.split_group_members (group_id, user_id, added_by) values (p_group_id, p_user_id, me)
  on conflict do nothing;
  insert into public.conversation_members (conversation_id, user_id)
  select c.id, p_user_id from public.conversations c where c.group_id = p_group_id
  on conflict do nothing;
end;
$$;

create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  owing numeric;
begin
  select coalesce(sum(b.net), 0) into owing from public.group_balances(p_group_id) b where b.user_id = me;
  if owing <> 0 then
    raise exception 'CF631: Settle up in this group before leaving';
  end if;
  delete from public.split_group_members where group_id = p_group_id and user_id = me;
  delete from public.conversation_members cm using public.conversations c
  where c.id = cm.conversation_id and c.group_id = p_group_id and cm.user_id = me;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Shared expenses: booking each person's own side
-- ---------------------------------------------------------------------------
/** The participant's expense category for a shared bill: same name if they have it, else "Other". */
create or replace function public.share_category(p_user_id uuid, p_name text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.category_by_name(p_user_id, 'expense', coalesce(p_name, '')),
    public.category_by_name(p_user_id, 'expense', 'Other'),
    (select c.id from public.transaction_categories c
     where c.user_id = p_user_id and c.kind = 'expense' and c.parent_id is null and not c.is_archived
     order by c.sort_order desc limit 1));
$$;

/** Books a non-payer's share: an expense from their Friends balance. */
create or replace function public.book_share(p_expense_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.shared_expenses;
  s public.shared_expense_shares;
  cat uuid;
begin
  select * into e from public.shared_expenses where id = p_expense_id;
  select * into s from public.shared_expense_shares where shared_expense_id = p_expense_id and user_id = p_user_id;
  if s.booked or s.amount = 0 or e.paid_by = p_user_id or e.status <> 'active' then
    return;
  end if;
  cat := public.share_category(p_user_id, e.category_name);
  if cat is null then
    return; -- no expense categories at all: it shows in Friends, booked later
  end if;
  perform set_config('cf.friends_booking', 'on', true);
  insert into public.transactions (user_id, type, amount, currency, account_id, category_id, occurred_at, notes,
                                   source, shared_expense_id)
  values (p_user_id, 'expense', s.amount, e.currency, public.friends_account(p_user_id), cat,
          e.occurred_on::timestamptz + interval '12 hours',
          left('Your share · ' || e.title, 2000), 'shared', e.id);
  update public.shared_expense_shares set booked = true
  where shared_expense_id = p_expense_id and user_id = p_user_id;
  perform set_config('cf.friends_booking', 'off', true);
end;
$$;
revoke all on function public.book_share(uuid, uuid) from public, anon, authenticated;

/**
 * The payer's side, done by the payer: either an account the bill was paid
 * from, or an existing expense transaction (e.g. one read from an SMS) for
 * the same total, which is reused rather than duplicated.
 */
create or replace function public.book_payer_side(
  p_expense_id uuid, p_account_id uuid, p_transaction_id uuid, p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me     uuid := auth.uid();
  e      public.shared_expenses;
  t      public.transactions;
  mine   numeric;
  others numeric;
  cat    uuid;
  acct   uuid;
  friends uuid;
begin
  select * into e from public.shared_expenses where id = p_expense_id for update;
  if not found or e.paid_by <> me then raise exception 'CF404: Shared expense not found'; end if;
  if e.status <> 'active' then raise exception 'CF640: This shared expense was cancelled'; end if;
  if e.payer_booked then raise exception 'CF641: Already recorded in your accounts'; end if;

  select coalesce(s.amount, 0) into mine from public.shared_expense_shares s
  where s.shared_expense_id = e.id and s.user_id = me;
  mine := coalesce(mine, 0);
  others := e.total - mine;
  friends := public.friends_account(me);
  perform set_config('cf.friends_booking', 'on', true);

  if p_transaction_id is not null then
    select * into t from public.transactions where id = p_transaction_id and user_id = me for update;
    if not found or t.type <> 'expense' then raise exception 'CF642: Pick one of your expenses'; end if;
    if t.amount <> e.total then raise exception 'CF643: That payment is a different amount from the bill'; end if;
    if t.shared_expense_id is not null then raise exception 'CF644: That payment is already split'; end if;
    acct := t.account_id;
    update public.shared_expenses
    set linked_transaction_id = t.id,
        linked_original = jsonb_build_object('amount', t.amount, 'category_id', t.category_id,
                                             'subcategory_id', t.subcategory_id, 'type', t.type)
    where id = e.id;
    if mine > 0 then
      update public.transactions
      set amount = mine, shared_expense_id = e.id,
          category_id = coalesce(p_category_id, t.category_id),
          subcategory_id = case when p_category_id is null then t.subcategory_id else null end
      where id = t.id;
    else
      -- The payer isn't sharing the cost: the whole payment is money owed back.
      update public.transactions
      set type = 'transfer', to_account_id = friends, category_id = null, subcategory_id = null,
          merchant_id = null, shared_expense_id = e.id
      where id = t.id;
    end if;
    if mine > 0 and others > 0 then
      insert into public.transactions (user_id, type, amount, currency, account_id, to_account_id, occurred_at,
                                       notes, source, shared_expense_id)
      values (me, 'transfer', others, e.currency, acct, friends, t.occurred_at,
              left('Owed to you · ' || e.title, 2000), 'shared', e.id);
    end if;
  else
    if p_account_id is null then raise exception 'CF645: Choose the account you paid from'; end if;
    select id into acct from public.accounts where id = p_account_id and user_id = me and system_kind is null;
    if acct is null then raise exception 'CF201: Account not found'; end if;
    cat := coalesce(p_category_id, public.share_category(me, e.category_name));
    if mine > 0 then
      insert into public.transactions (user_id, type, amount, currency, account_id, category_id, occurred_at,
                                       notes, source, shared_expense_id)
      values (me, 'expense', mine, e.currency, acct, cat, e.occurred_on::timestamptz + interval '12 hours',
              left(e.title, 2000), 'shared', e.id);
    end if;
    if others > 0 then
      insert into public.transactions (user_id, type, amount, currency, account_id, to_account_id, occurred_at,
                                       notes, source, shared_expense_id)
      values (me, 'transfer', others, e.currency, acct, friends, e.occurred_on::timestamptz + interval '12 hours',
              left('Owed to you · ' || e.title, 2000), 'shared', e.id);
    end if;
  end if;

  update public.shared_expenses set payer_booked = true where id = e.id;
  update public.shared_expense_shares set booked = true where shared_expense_id = e.id and user_id = me;
  perform set_config('cf.friends_booking', 'off', true);
end;
$$;

/** Removes every ledger row a shared expense booked, for everyone, restoring a linked payment. */
create or replace function public.unbook_shared_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.shared_expenses;
begin
  select * into e from public.shared_expenses where id = p_expense_id for update;
  perform set_config('cf.friends_booking', 'on', true);
  delete from public.transactions
  where shared_expense_id = p_expense_id and source = 'shared'
    and (e.linked_transaction_id is null or id <> e.linked_transaction_id);
  if e.linked_transaction_id is not null and e.linked_original is not null then
    update public.transactions
    set type = (e.linked_original ->> 'type')::public.txn_type,
        amount = (e.linked_original ->> 'amount')::numeric,
        to_account_id = null,
        category_id = (e.linked_original ->> 'category_id')::uuid,
        subcategory_id = (e.linked_original ->> 'subcategory_id')::uuid,
        shared_expense_id = null
    where id = e.linked_transaction_id;
  end if;
  update public.shared_expenses
  set payer_booked = false, linked_transaction_id = null, linked_original = null
  where id = p_expense_id;
  update public.shared_expense_shares set booked = false where shared_expense_id = p_expense_id;
  perform set_config('cf.friends_booking', 'off', true);
end;
$$;
revoke all on function public.unbook_shared_expense(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14. Shared expenses: create, update, cancel
-- ---------------------------------------------------------------------------
/** Validates participants and shares; raises when the split doesn't add up exactly. */
create or replace function public.validate_shares(
  p_me uuid, p_group_id uuid, p_paid_by uuid, p_total numeric, p_shares jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s jsonb;
  uid uuid;
  amt numeric;
  sum_amt numeric := 0;
  people int := 0;
begin
  if p_total is null or p_total <= 0 or p_total <> round(p_total, 2) then
    raise exception 'CF650: Enter the bill total';
  end if;
  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) < 2 then
    raise exception 'CF651: A split needs at least two people';
  end if;
  for s in select * from jsonb_array_elements(p_shares) loop
    uid := (s ->> 'user_id')::uuid;
    amt := (s ->> 'amount')::numeric;
    if amt is null or amt < 0 or amt <> round(amt, 2) then
      raise exception 'CF652: Each share must be a positive amount';
    end if;
    if uid <> p_me then
      if p_group_id is not null then
        if not public.is_group_member(p_group_id, uid) then
          raise exception 'CF653: Everyone in the split must be in the group';
        end if;
      elsif not public.are_friends(p_me, uid) then
        raise exception 'CF653: Everyone in the split must be your friend';
      end if;
    end if;
    sum_amt := sum_amt + amt;
    people := people + 1;
  end loop;
  if (select count(distinct (x ->> 'user_id')) from jsonb_array_elements(p_shares) x) <> people then
    raise exception 'CF654: Someone appears twice in the split';
  end if;
  if sum_amt <> p_total then
    raise exception 'CF655: The shares add up to %, not the bill total of %', sum_amt, p_total;
  end if;
  if p_paid_by <> p_me and not exists (
      select 1 from jsonb_array_elements(p_shares) x where (x ->> 'user_id')::uuid = p_paid_by) then
    raise exception 'CF656: The person who paid must be part of the split';
  end if;
  if p_group_id is not null and not public.is_group_member(p_group_id, p_me) then
    raise exception 'CF404: Group not found';
  end if;
end;
$$;
revoke all on function public.validate_shares(uuid, uuid, uuid, numeric, jsonb) from public, anon, authenticated;

/**
 * p: { group_id?, paid_by, title, category_name?, icon?, total, currency?, occurred_on, notes?,
 *      split_method, shares: [{user_id, amount, input?}],
 *      payer_account_id?, payer_transaction_id?, payer_category_id? }
 * When you are the payer, give the account you paid from, or the existing
 * transaction to link. Returns the shared expense id.
 */
create or replace function public.create_shared_expense(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  paid_by uuid := coalesce((p ->> 'paid_by')::uuid, auth.uid());
  gid     uuid := (p ->> 'group_id')::uuid;
  total   numeric := (p ->> 'total')::numeric;
  eid     uuid;
  s       jsonb;
  cid     uuid;
  me_name text;
  other   uuid;
begin
  if me is null then raise exception 'CF001: Not authenticated'; end if;
  perform public.validate_shares(me, gid, paid_by, total, p -> 'shares');
  if not exists (select 1 from jsonb_array_elements(p -> 'shares') x where (x ->> 'user_id')::uuid = me)
     and paid_by <> me then
    raise exception 'CF657: You must be part of a split you create';
  end if;

  insert into public.shared_expenses (group_id, created_by, paid_by, title, category_name, icon, total, currency,
                                      occurred_on, notes, split_method)
  values (gid, me, paid_by, btrim(p ->> 'title'), nullif(p ->> 'category_name', ''), nullif(p ->> 'icon', ''),
          total, coalesce(nullif(p ->> 'currency', ''), 'INR'),
          coalesce((p ->> 'occurred_on')::date, current_date), nullif(p ->> 'notes', ''),
          coalesce(p ->> 'split_method', 'equal'))
  returning id into eid;

  for s in select * from jsonb_array_elements(p -> 'shares') loop
    insert into public.shared_expense_shares (shared_expense_id, user_id, amount, input_value)
    values (eid, (s ->> 'user_id')::uuid, (s ->> 'amount')::numeric, (s ->> 'input')::numeric);
  end loop;

  -- Everyone's own side: shares are booked for them now; the payer's when they choose an account.
  for s in select * from jsonb_array_elements(p -> 'shares') loop
    perform public.book_share(eid, (s ->> 'user_id')::uuid);
  end loop;
  if paid_by = me and (p ->> 'payer_account_id' is not null or p ->> 'payer_transaction_id' is not null) then
    perform public.book_payer_side(eid, (p ->> 'payer_account_id')::uuid, (p ->> 'payer_transaction_id')::uuid,
                                   (p ->> 'payer_category_id')::uuid);
  end if;

  select coalesce(display_name, username, 'Someone') into me_name from public.profiles where id = me;
  for s in select * from jsonb_array_elements(p -> 'shares') loop
    other := (s ->> 'user_id')::uuid;
    perform public.notify(other, me, 'expense_added', btrim(p ->> 'title'),
      me_name || ' added you to a shared expense — your share is ' || (s ->> 'amount'),
      jsonb_build_object('shared_expense_id', eid));
  end loop;
  if paid_by <> me then
    perform public.notify(paid_by, me, 'expense_added', btrim(p ->> 'title'),
      me_name || ' recorded that you paid ' || total::text || ' — add it to your accounts',
      jsonb_build_object('shared_expense_id', eid));
  end if;

  -- A card in the conversation it belongs to.
  if gid is not null then
    select id into cid from public.conversations where group_id = gid;
  elsif (select count(*) from jsonb_array_elements(p -> 'shares')) = 2 then
    select (x ->> 'user_id')::uuid into other from jsonb_array_elements(p -> 'shares') x
    where (x ->> 'user_id')::uuid <> me limit 1;
    if other is not null and public.are_friends(me, other) then
      cid := public.direct_conversation(other);
    end if;
  end if;
  if cid is not null then
    perform public.post_message(cid, me, 'expense',
      btrim(p ->> 'title') || ' · ' || total::text, eid, null);
  end if;
  return eid;
end;
$$;

/** Changes a shared expense: everyone's booked rows are reversed and re-booked from the new split. */
create or replace function public.update_shared_expense(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me  uuid := auth.uid();
  e   public.shared_expenses;
  s   jsonb;
  link uuid;
  link_cat uuid;
  me_name text;
begin
  select * into e from public.shared_expenses where id = p_id for update;
  if not found or me not in (e.created_by, e.paid_by) then raise exception 'CF404: Shared expense not found'; end if;
  if e.status <> 'active' then raise exception 'CF640: This shared expense was cancelled'; end if;
  if exists (select 1 from public.settlement_allocations a where a.shared_expense_id = p_id) then
    raise exception 'CF658: Part of this was already settled — cancel the settlement first';
  end if;
  perform public.validate_shares(me, e.group_id, e.paid_by, (p ->> 'total')::numeric, p -> 'shares');

  link := e.linked_transaction_id;
  link_cat := (e.linked_original ->> 'category_id')::uuid;
  perform public.unbook_shared_expense(p_id);

  update public.shared_expenses
  set title = btrim(coalesce(p ->> 'title', title)),
      category_name = coalesce(nullif(p ->> 'category_name', ''), category_name),
      total = (p ->> 'total')::numeric,
      occurred_on = coalesce((p ->> 'occurred_on')::date, occurred_on),
      notes = nullif(p ->> 'notes', ''),
      split_method = coalesce(p ->> 'split_method', split_method),
      updated_at = now()
  where id = p_id;
  delete from public.shared_expense_shares where shared_expense_id = p_id;
  for s in select * from jsonb_array_elements(p -> 'shares') loop
    insert into public.shared_expense_shares (shared_expense_id, user_id, amount, input_value)
    values (p_id, (s ->> 'user_id')::uuid, (s ->> 'amount')::numeric, (s ->> 'input')::numeric);
  end loop;
  for s in select * from jsonb_array_elements(p -> 'shares') loop
    perform public.book_share(p_id, (s ->> 'user_id')::uuid);
  end loop;
  -- The payer re-links their payment when they edit it themselves and the total still matches.
  if e.paid_by = me and link is not null
     and (select amount from public.transactions where id = link) = (p ->> 'total')::numeric then
    perform public.book_payer_side(p_id, null, link, link_cat);
  elsif e.paid_by = me and p ->> 'payer_account_id' is not null then
    perform public.book_payer_side(p_id, (p ->> 'payer_account_id')::uuid, null, null);
  end if;

  select coalesce(display_name, username, 'Someone') into me_name from public.profiles where id = me;
  for s in select * from jsonb_array_elements(p -> 'shares') loop
    perform public.notify((s ->> 'user_id')::uuid, me, 'expense_updated', btrim(coalesce(p ->> 'title', e.title)),
      me_name || ' changed this shared expense — your share is ' || (s ->> 'amount'),
      jsonb_build_object('shared_expense_id', p_id));
  end loop;
end;
$$;

create or replace function public.cancel_shared_expense(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  e  public.shared_expenses;
  s  record;
begin
  select * into e from public.shared_expenses where id = p_id for update;
  if not found or me not in (e.created_by, e.paid_by) then raise exception 'CF404: Shared expense not found'; end if;
  if e.status = 'cancelled' then return; end if;
  if exists (select 1 from public.settlement_allocations a where a.shared_expense_id = p_id) then
    raise exception 'CF658: Part of this was already settled — cancel the settlement first';
  end if;
  perform public.unbook_shared_expense(p_id);
  update public.shared_expenses set status = 'cancelled', updated_at = now() where id = p_id;
  for s in select user_id from public.shared_expense_shares where shared_expense_id = p_id loop
    perform public.notify(s.user_id, me, 'expense_cancelled', e.title, 'This shared expense was cancelled',
      jsonb_build_object('shared_expense_id', p_id));
  end loop;
end;
$$;

/** Books my share of an expense if it wasn't (e.g. I had no categories when it was added). */
create or replace function public.book_my_share(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_expense_participant(p_expense_id, auth.uid()) then
    raise exception 'CF404: Shared expense not found';
  end if;
  perform public.book_share(p_expense_id, auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- 15. Settlements
-- ---------------------------------------------------------------------------
/** Books one side of a settlement in the caller's own accounts. */
create or replace function public.book_settlement_side(p_settlement_id uuid, p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me  uuid := auth.uid();
  st  public.settlements;
  acct uuid;
  friends uuid;
  other_name text;
begin
  select * into st from public.settlements where id = p_settlement_id for update;
  if not found or me not in (st.from_user, st.to_user) then raise exception 'CF404: Settlement not found'; end if;
  if (me = st.from_user and st.from_booked) or (me = st.to_user and st.to_booked) then
    raise exception 'CF660: Already recorded in your accounts';
  end if;
  select id into acct from public.accounts where id = p_account_id and user_id = me and system_kind is null;
  if acct is null then raise exception 'CF201: Account not found'; end if;
  friends := public.friends_account(me);
  select coalesce(display_name, username, 'a friend') into other_name from public.profiles
  where id = case when me = st.from_user then st.to_user else st.from_user end;

  perform set_config('cf.friends_booking', 'on', true);
  if me = st.from_user then
    insert into public.transactions (user_id, type, amount, currency, account_id, to_account_id, occurred_at,
                                     notes, source, settlement_id)
    values (me, 'transfer', st.amount, st.currency, acct, friends, st.settled_on::timestamptz + interval '12 hours',
            left('Paid back ' || other_name, 2000), 'settlement', st.id);
    update public.settlements set from_booked = true where id = st.id;
  else
    insert into public.transactions (user_id, type, amount, currency, account_id, to_account_id, occurred_at,
                                     notes, source, settlement_id)
    values (me, 'transfer', st.amount, st.currency, friends, acct, st.settled_on::timestamptz + interval '12 hours',
            left('Paid back by ' || other_name, 2000), 'settlement', st.id);
    update public.settlements set to_booked = true where id = st.id;
  end if;
  perform set_config('cf.friends_booking', 'off', true);

  if (select from_booked and to_booked from public.settlements where id = st.id) then
    perform public.notify(case when me = st.from_user then st.to_user else st.from_user end, me,
      'settlement_completed', 'Settlement recorded', 'Both of you have recorded ' || st.amount::text,
      jsonb_build_object('settlement_id', st.id));
  end if;
end;
$$;

/**
 * Records money changing hands between you and a friend (either direction)
 * and books your own side from p_account_id. The amount is allocated to the
 * oldest outstanding shared expenses between you; it can't exceed what is
 * owed in that direction.
 */
create or replace function public.record_settlement(
  p_other uuid, p_direction text, p_amount numeric, p_account_id uuid,
  p_group_id uuid default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      uuid := auth.uid();
  debtor  uuid;
  creditor uuid;
  owed    numeric;
  sid     uuid;
  remaining numeric;
  e       record;
  take    numeric;
  me_name text;
  cid     uuid;
begin
  if me is null then raise exception 'CF001: Not authenticated'; end if;
  if p_direction not in ('i_paid', 'they_paid') then raise exception 'CF661: Invalid direction'; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'CF662: Enter an amount';
  end if;
  debtor := case when p_direction = 'i_paid' then me else p_other end;
  creditor := case when p_direction = 'i_paid' then p_other else me end;

  if p_group_id is null then
    -- Person to person: what the debtor owes the creditor outside groups.
    select coalesce(sum(b.net), 0) into owed from public.friend_balances() b where b.user_id = p_other;
    owed := case when p_direction = 'i_paid' then -owed else owed end;
  else
    -- In a group: the debtor must owe the group and the creditor be owed by it.
    if not public.is_group_member(p_group_id, debtor) or not public.is_group_member(p_group_id, creditor) then
      raise exception 'CF404: Group not found';
    end if;
    select least(
             greatest(-coalesce((select b.net from public.group_balances(p_group_id) b where b.user_id = debtor), 0), 0),
             greatest(coalesce((select b.net from public.group_balances(p_group_id) b where b.user_id = creditor), 0), 0))
      into owed;
  end if;
  if owed <= 0 then raise exception 'CF663: Nothing is owed in that direction'; end if;
  if p_amount > owed then raise exception 'CF664: That''s more than the % owed', owed; end if;

  insert into public.settlements (group_id, from_user, to_user, amount, currency, note, created_by)
  values (p_group_id, debtor, creditor, p_amount,
          coalesce((select default_currency from public.profiles where id = me), 'INR'), nullif(btrim(p_note), ''), me)
  returning id into sid;

  -- Allocate oldest first to bills the creditor paid that the debtor still owes on.
  remaining := p_amount;
  for e in
    select x.id, s.amount - coalesce((select sum(a.amount) from public.settlement_allocations a
                                      join public.settlements st2 on st2.id = a.settlement_id
                                      where a.shared_expense_id = x.id and st2.from_user = debtor), 0) as open
    from public.shared_expenses x
    join public.shared_expense_shares s on s.shared_expense_id = x.id and s.user_id = debtor
    where x.status = 'active' and x.paid_by = creditor
      and x.group_id is not distinct from p_group_id
    order by x.occurred_on, x.created_at
  loop
    exit when remaining <= 0;
    if e.open > 0 then
      take := least(e.open, remaining);
      insert into public.settlement_allocations (settlement_id, shared_expense_id, amount) values (sid, e.id, take);
      remaining := remaining - take;
    end if;
  end loop;

  if p_account_id is not null then
    perform public.book_settlement_side(sid, p_account_id);
  end if;

  select coalesce(display_name, username, 'Someone') into me_name from public.profiles where id = me;
  perform public.notify(p_other, me, 'settlement_marked',
    case when p_direction = 'i_paid' then me_name || ' paid you back' else me_name || ' recorded your payment' end,
    p_amount::text || case when p_direction = 'i_paid' then ' — add it to your accounts' else ' marked as received' end,
    jsonb_build_object('settlement_id', sid));
  if public.are_friends(me, p_other) then
    cid := public.direct_conversation(p_other);
    perform public.post_message(cid, me, 'settlement',
      case when p_direction = 'i_paid' then 'Paid back ' else 'Received ' end || p_amount::text, null, sid);
  end if;
  return sid;
end;
$$;

/** Undo a settlement you recorded: removes both sides' booked rows and its allocations. */
create or replace function public.delete_settlement(p_settlement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  st public.settlements;
begin
  select * into st from public.settlements where id = p_settlement_id for update;
  if not found or st.created_by <> auth.uid() then raise exception 'CF404: Settlement not found'; end if;
  perform set_config('cf.friends_booking', 'on', true);
  delete from public.transactions where settlement_id = st.id and source = 'settlement';
  perform set_config('cf.friends_booking', 'off', true);
  delete from public.settlements where id = st.id;
end;
$$;

/** A gentle nudge in chat: "Rahul, you owe ₹800 for Dinner". At most one a day per person. */
create or replace function public.remind_friend(p_user_id uuid, p_shared_expense_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me   uuid := auth.uid();
  cid  uuid;
  owed numeric;
  what text;
begin
  select coalesce(sum(b.net), 0) into owed from public.friend_balances() b where b.user_id = p_user_id;
  if owed <= 0 then raise exception 'CF670: They don''t owe you anything right now'; end if;
  cid := public.direct_conversation(p_user_id);
  if exists (select 1 from public.messages m
             where m.conversation_id = cid and m.sender_id = me and m.kind = 'reminder'
               and m.created_at > now() - interval '24 hours') then
    raise exception 'CF671: You already sent a reminder today';
  end if;
  select ' for ' || e.title into what from public.shared_expenses e where e.id = p_shared_expense_id;
  perform public.post_message(cid, me, 'reminder',
    'Friendly reminder: you owe me ' || owed::text || coalesce(what, '') || '.', p_shared_expense_id, null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. Grants
-- ---------------------------------------------------------------------------
revoke all on function
  public.are_friends(uuid, uuid), public.is_blocked_between(uuid, uuid), public.is_group_member(uuid, uuid),
  public.is_conversation_member(uuid, uuid), public.is_expense_participant(uuid, uuid),
  public.share_category(uuid, text), public.profile_card(uuid)
from public, anon;
grant execute on function
  public.are_friends(uuid, uuid), public.is_blocked_between(uuid, uuid), public.is_group_member(uuid, uuid),
  public.is_conversation_member(uuid, uuid), public.is_expense_participant(uuid, uuid),
  public.profile_card(uuid)
to authenticated;

revoke all on function
  public.register_push_token(text, text), public.mark_notifications_read(uuid[]), public.set_username(text),
  public.search_people(text), public.send_friend_request(uuid), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.block_user(uuid), public.unblock_user(uuid), public.friend_balances(),
  public.group_balances(uuid), public.direct_conversation(uuid), public.send_message(uuid, text),
  public.mark_conversation_read(uuid), public.list_conversations(), public.create_split_group(text, uuid[]),
  public.add_group_member(uuid, uuid), public.leave_group(uuid), public.my_group_positions(),
  public.book_payer_side(uuid, uuid, uuid, uuid), public.create_shared_expense(jsonb),
  public.update_shared_expense(uuid, jsonb), public.cancel_shared_expense(uuid), public.book_my_share(uuid),
  public.book_settlement_side(uuid, uuid), public.record_settlement(uuid, text, numeric, uuid, uuid, text),
  public.delete_settlement(uuid), public.remind_friend(uuid, uuid)
from public, anon;
grant execute on function
  public.register_push_token(text, text), public.mark_notifications_read(uuid[]), public.set_username(text),
  public.search_people(text), public.send_friend_request(uuid), public.respond_friend_request(uuid, boolean),
  public.remove_friend(uuid), public.block_user(uuid), public.unblock_user(uuid), public.friend_balances(),
  public.group_balances(uuid), public.direct_conversation(uuid), public.send_message(uuid, text),
  public.mark_conversation_read(uuid), public.list_conversations(), public.create_split_group(text, uuid[]),
  public.add_group_member(uuid, uuid), public.leave_group(uuid), public.my_group_positions(),
  public.book_payer_side(uuid, uuid, uuid, uuid), public.create_shared_expense(jsonb),
  public.update_shared_expense(uuid, jsonb), public.cancel_shared_expense(uuid), public.book_my_share(uuid),
  public.book_settlement_side(uuid, uuid), public.record_settlement(uuid, text, numeric, uuid, uuid, text),
  public.delete_settlement(uuid), public.remind_friend(uuid, uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- 17. Realtime (Supabase only): new messages and notifications arrive live.
--     Realtime applies the SELECT policies above, so people only receive rows
--     they could read anyway.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'messages') then
      execute 'alter publication supabase_realtime add table public.messages';
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'notifications') then
      execute 'alter publication supabase_realtime add table public.notifications';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 18. Transactions view: expose the shared-expense and settlement links
--     (appended at the end, so existing columns keep their positions).
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
  a.provider as account_provider,
  t.source,
  t.needs_review,
  t.external_ref,
  t.split_group_id,
  t.shared_expense_id,
  t.settlement_id
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
grant select on public.transactions_view to authenticated;
