-- =============================================================================
-- Bank sync, part 2: accounts found in your messages, history import, and
-- protection against fake "bank" SMS.
-- =============================================================================
-- * discovered_accounts() groups every waiting message by the account it
--   names (bank + last digits), so the app can offer "HDFC account ending
--   7710 — 12 messages — add it" instead of asking about each message.
-- * account_from_messages() adds that account (or links the digits to one you
--   already have), files every waiting message into it in date order, and
--   sets the opening balance so the balance matches the bank's latest SMS.
-- * ingest_bank_sms() gains a backfill mode for importing past messages from
--   an iPhone backup: a higher rate limit, and history is not flagged for
--   review one by one.
-- * An SMS from one bank is never matched to an account set to another bank
--   just because the last digits line up.
-- * Messages from an ordinary phone number or email address are never treated
--   as bank alerts. Indian banks send transactional SMS only from registered
--   sender IDs (e.g. AX-HDFCBK), so a "Rs 5,000 debited…" text from
--   +91 98… is someone else's message — or a fake — and is discarded.
--
-- * History never moves today's balance: an older message filed into an
--   account added after it shows up in reports, and the account's opening
--   balance absorbs it (file_message_as_history).
--
-- * A profile's time zone is always one this database recognises (devices
--   that report "Asia/Calcutta" get "Asia/Kolkata").
--
-- Additive: replaces three functions, adds six and one trigger. The only data
-- change repairs unrecognised time-zone names.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Time zones: some devices report old names ("Asia/Calcutta"). Databases whose
-- time-zone data leaves out those aliases then reject every date calculation
-- for the user. Profiles always keep a name this database knows.
-- ---------------------------------------------------------------------------
create or replace function public.normalise_timezone(p_zone text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  candidate text;
begin
  if p_zone is null or btrim(p_zone) = '' then return 'Asia/Kolkata'; end if;
  if exists (select 1 from pg_catalog.pg_timezone_names where name = p_zone) then return p_zone; end if;
  candidate := case p_zone
    when 'Asia/Calcutta' then 'Asia/Kolkata'
    when 'Asia/Saigon' then 'Asia/Ho_Chi_Minh'
    when 'Asia/Katmandu' then 'Asia/Kathmandu'
    when 'Asia/Rangoon' then 'Asia/Yangon'
    when 'Asia/Dacca' then 'Asia/Dhaka'
    when 'Asia/Thimbu' then 'Asia/Thimphu'
    when 'Asia/Ujung_Pandang' then 'Asia/Makassar'
    when 'US/Eastern' then 'America/New_York'
    when 'US/Central' then 'America/Chicago'
    when 'US/Mountain' then 'America/Denver'
    when 'US/Pacific' then 'America/Los_Angeles'
    when 'GB' then 'Europe/London'
    else null end;
  if candidate is not null
     and exists (select 1 from pg_catalog.pg_timezone_names where name = candidate) then
    return candidate;
  end if;
  return 'Asia/Kolkata';
end;
$$;

create or replace function public.tg_profiles_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.timezone := public.normalise_timezone(new.timezone);
  return new;
end;
$$;

drop trigger if exists profiles_timezone on public.profiles;
create trigger profiles_timezone before insert or update of timezone on public.profiles
  for each row execute function public.tg_profiles_timezone();

-- Repair anyone already stuck with a name this database doesn't know.
update public.profiles p
set timezone = public.normalise_timezone(p.timezone)
where not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = p.timezone);

-- A sender a bank could have used: an alphanumeric sender ID or a short code.
-- Unknown (empty) senders are allowed — the Shortcut may not pass one.
create or replace function public.is_bank_sender(p_sender text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_sender is null or btrim(p_sender) = '' then true
    when position('@' in p_sender) > 0 then false
    when btrim(p_sender) ~ '^\+?[0-9][0-9 ()-]{6,}$' then false
    else true
  end;
$$;

-- Matching an SMS to an account: an account whose bank is set to a different
-- bank is never a match. ("ICICI Acct XX234" is not your HDFC account ending
-- 1234, even though the digits line up.)
create or replace function public.match_account(
  p_user_id uuid, p_last4 text, p_instrument text, p_bank text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  ids uuid[];
  types public.account_type[];
begin
  types := case p_instrument
    when 'credit_card' then array['credit_card']::public.account_type[]
    when 'debit_card'  then array['debit_card', 'bank', 'savings']::public.account_type[]
    when 'card'        then array['credit_card', 'debit_card', 'bank', 'savings']::public.account_type[]
    when 'account'     then array['bank', 'savings', 'debit_card', 'loan', 'other_asset']::public.account_type[]
    when 'wallet'      then array['wallet']::public.account_type[]
    else null
  end;

  if p_last4 is not null then
    -- Aliases are explicit user decisions, so they win outright.
    select array_agg(distinct al.account_id) into ids
    from public.account_aliases al
    join public.accounts a on a.id = al.account_id and a.is_active
    where al.user_id = p_user_id
      and (al.last4 = p_last4 or right(al.last4, char_length(p_last4)) = p_last4
           or right(p_last4, char_length(al.last4)) = al.last4)
      and (al.bank is null or p_bank is null or al.bank = p_bank);
    if cardinality(ids) = 1 then return ids[1]; end if;

    select array_agg(a.id) into ids
    from public.accounts a
    where a.user_id = p_user_id and a.is_active and a.last4 is not null
      and right(a.last4, char_length(p_last4)) = p_last4
      and (types is null or a.type = any (types))
      and (p_bank is null or a.provider is null or a.provider = p_bank);
    if cardinality(ids) = 1 then return ids[1]; end if;
    if cardinality(ids) > 1 and p_bank is not null then
      select array_agg(a.id) into ids
      from public.accounts a
      where a.id = any (ids) and a.provider = p_bank;
      if cardinality(ids) = 1 then return ids[1]; end if;
    end if;
    return null;
  end if;

  -- No digits (e.g. "payment credited to your SBI Credit Card"): accept only an
  -- unambiguous match on bank + type.
  if p_bank is not null and types is not null then
    select array_agg(a.id) into ids
    from public.accounts a
    where a.user_id = p_user_id and a.is_active and a.provider = p_bank and a.type = any (types);
    if cardinality(ids) = 1 then return ids[1]; end if;
  end if;
  return null;
end;
$$;

-- Files one message as history: an account's balance, as you entered it when
-- you added the account, already includes everything that happened before
-- that day. So when an older message lands on an account added after it, its
-- transaction appears in your history and reports, but the account's opening
-- balance absorbs it and today's balance doesn't move.
create or replace function public.file_message_as_history(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg    public.bank_messages;
  snap   jsonb;
  result jsonb;
begin
  select * into msg from public.bank_messages where id = p_message_id;
  if not found then raise exception 'CF801: Message not found'; end if;

  select coalesce(jsonb_object_agg(a.id::text, a.current_balance), '{}'::jsonb) into snap
  from public.accounts a
  where a.user_id = msg.user_id and a.created_at > msg.received_at;

  result := public.process_bank_message(p_message_id);

  -- Accounts that existed after the message — including one created just now
  -- for it (Cash, for an old ATM withdrawal) — keep the balance they had.
  update public.accounts a
  set opening_balance = a.opening_balance
                        + (coalesce((snap ->> a.id::text)::numeric, a.opening_balance) - a.current_balance)
  where a.user_id = msg.user_id
    and a.created_at > msg.received_at
    and a.current_balance <> coalesce((snap ->> a.id::text)::numeric, a.opening_balance);

  return result;
end;
$$;

drop function if exists public.ingest_bank_sms(text, text, text, timestamptz, jsonb);

create or replace function public.ingest_bank_sms(
  p_key_hash    text,
  p_sender      text,
  p_body        text,
  p_received_at timestamptz,
  p_parsed      jsonb,
  p_backfill    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k        public.ingest_keys;
  hash     text;
  mid      uuid;
  recent   integer;
  result   jsonb;
  received timestamptz := least(coalesce(p_received_at, now()), now() + interval '5 minutes');
  tz       text;
begin
  select * into k from public.ingest_keys
  where key_hash = lower(p_key_hash) and revoked_at is null;
  if not found then
    raise exception 'CF810: Unknown or revoked sync key';
  end if;

  update public.ingest_keys set last_used_at = now() where id = k.id;

  -- Live: 300 an hour is far beyond anyone's real payments. Importing history
  -- is bursty, so it gets a daily budget instead.
  if p_backfill then
    select count(*) into recent from public.bank_messages
    where user_id = k.user_id and created_at > now() - interval '1 day';
    if recent >= 20000 then
      raise exception 'CF811: Too many messages today';
    end if;
  else
    select count(*) into recent from public.bank_messages
    where user_id = k.user_id and created_at > now() - interval '1 hour';
    if recent >= 300 then
      raise exception 'CF811: Too many messages in the last hour';
    end if;
  end if;

  -- Not a bank transaction (OTP, promotion, chat) → discarded, never stored.
  if coalesce(p_parsed ->> 'kind', '') not in ('transaction', 'balance') then
    return jsonb_build_object('status', 'ignored', 'summary',
      'Not a bank transaction (' || coalesce(replace(p_parsed ->> 'reason', '_', ' '), 'unrecognised') || ')');
  end if;

  -- From a phone number or email → not a bank, whatever the text says.
  if not public.is_bank_sender(p_sender) then
    return jsonb_build_object('status', 'ignored', 'summary', 'Not from a bank sender ID');
  end if;

  tz := coalesce((select pr.timezone from public.profiles pr where pr.id = k.user_id), 'Asia/Kolkata');
  -- The same text on the same day is the same message, however it arrived
  -- (live from the Shortcut, or later from a backup) — so the sender, whose
  -- spelling can differ between the two, is not part of the fingerprint.
  hash := md5(btrim(p_body) || '|' || ((received at time zone tz)::date)::text);
  if exists (select 1 from public.bank_messages b
             where b.user_id = k.user_id
               and b.body_hash = md5(coalesce(p_sender, '') || '|' || btrim(p_body) || '|'
                                     || ((received at time zone tz)::date)::text)) then
    -- Recorded earlier under the previous fingerprint.
    return jsonb_build_object('status', 'duplicate', 'summary', 'Already received');
  end if;

  insert into public.bank_messages (user_id, sender, body, body_hash, received_at, parsed,
                                    direction, amount, reference, last4, bank)
  values (k.user_id, left(p_sender, 64), left(btrim(p_body), 2000), hash, received,
          -- imported history is marked so it stays out of the review queue
          -- even when it is filed later, once its account is added
          coalesce(p_parsed, '{}') || case when p_backfill then '{"imported": true}'::jsonb else '{}'::jsonb end,
          p_parsed ->> 'direction',
          case when p_parsed ->> 'amount' ~ '^[0-9]+(\.[0-9]{1,2})?$' then (p_parsed ->> 'amount')::numeric end,
          nullif(p_parsed ->> 'reference', ''),
          p_parsed ->> 'last4',
          p_parsed ->> 'bank')
  on conflict (user_id, body_hash) do nothing
  returning id into mid;

  if mid is null then
    return jsonb_build_object('status', 'duplicate', 'summary', 'Already received');
  end if;

  result := case when p_backfill then public.file_message_as_history(mid)
                 else public.process_bank_message(mid) end;

  -- Imported history is settled: it isn't queued for a one-by-one check.
  -- (Anything that couldn't be placed still waits in Review.)
  if p_backfill and result ? 'transaction_id' then
    update public.transactions set needs_review = false
    where id = (result ->> 'transaction_id')::uuid and user_id = k.user_id;
  end if;

  return result || jsonb_build_object('message_id', mid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Accounts found in waiting messages
-- ---------------------------------------------------------------------------
create or replace function public.discovered_accounts()
returns table (
  bank text,
  last4 text,
  instrument text,
  message_count integer,
  first_at timestamptz,
  last_at timestamptz,
  latest_balance numeric,
  balance_kind text,
  suggested_type public.account_type,
  sample_merchants text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- Waiting transactions, plus balance-only texts ("Avl bal in A/c XX7710…")
  -- for accounts not in the app yet — those count towards the balance shown,
  -- not towards the number of messages.
  with m as (
    select b.*,
           b.status = 'needs_account' as waiting,
           coalesce(b.parsed ->> 'instrument', 'account') as inst,
           coalesce((b.parsed ->> 'isCardPaymentReceived')::boolean, false) as card_paid
    from public.bank_messages b
    where b.user_id = auth.uid()
      and (b.status = 'needs_account'
           or (b.status = 'ignored' and b.account_id is null and b.parsed ->> 'kind' = 'balance'
               and b.last4 is not null))
  )
  select
    m.bank,
    m.last4,
    -- a group is "credit card" if any of its messages says so, or carries an
    -- available-limit figure or a card-payment receipt
    case
      when bool_or(m.inst = 'credit_card' or m.card_paid or m.parsed ->> 'balanceKind' = 'limit') then 'credit_card'
      when bool_or(m.inst = 'debit_card') then 'debit_card'
      when bool_or(m.inst = 'card') then 'card'
      when bool_or(m.inst = 'wallet') then 'wallet'
      else 'account'
    end,
    (count(*) filter (where m.waiting))::integer,
    min(m.received_at),
    max(m.received_at),
    (array_agg((m.parsed ->> 'balance')::numeric order by m.received_at desc)
       filter (where m.parsed ->> 'balance' is not null))[1],
    (array_agg(m.parsed ->> 'balanceKind' order by m.received_at desc)
       filter (where m.parsed ->> 'balance' is not null))[1],
    case
      when bool_or(m.inst = 'credit_card' or m.card_paid or m.parsed ->> 'balanceKind' = 'limit') then 'credit_card'
      when bool_or(m.inst = 'wallet') then 'wallet'
      when bool_or(m.inst = 'card') then 'credit_card'
      else 'savings'
    end::public.account_type,
    (array_agg(distinct m.parsed ->> 'merchant') filter (where m.parsed ->> 'merchant' is not null))[1:3]
  from m
  group by m.bank, m.last4
  having bool_or(m.waiting)
  order by count(*) filter (where m.waiting) desc, max(m.received_at) desc;
$$;

-- Add the account a group of messages belongs to — or, with p_link_account_id,
-- say those digits belong to an account you already have (a debit card on a
-- savings account) — then file every waiting message for it, oldest first.
create or replace function public.account_from_messages(
  p_bank            text,
  p_last4           text,
  p_name            text default null,
  p_type            public.account_type default null,
  p_link_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := auth.uid();
  acc_id    uuid;
  created   boolean := false;
  mid       uuid;
  n         integer := 0;
  bank_label text;
  latest    record;
  cur       numeric;
  later     numeric;
begin
  if uid is null then raise exception 'CF001: Not authenticated'; end if;
  if p_last4 is not null and p_last4 !~ '^[0-9]{3,4}$' then
    raise exception 'CF830: Account digits must be 3 or 4 numbers';
  end if;

  if p_link_account_id is not null then
    select a.id into acc_id from public.accounts a
    where a.id = p_link_account_id and a.user_id = uid and a.is_active;
    if acc_id is null then raise exception 'CF201: Account not found'; end if;
    if p_last4 is not null then
      insert into public.account_aliases (user_id, account_id, last4, bank)
      values (uid, acc_id, p_last4, p_bank)
      on conflict do nothing;
    end if;
  else
    if p_type is null then raise exception 'CF831: Choose what kind of account this is'; end if;
    bank_label := case p_bank
      when 'hdfc' then 'HDFC Bank' when 'icici' then 'ICICI Bank' when 'sbi' then 'State Bank of India'
      when 'axis' then 'Axis Bank' when 'kotak' then 'Kotak Mahindra Bank' when 'idfc' then 'IDFC FIRST Bank'
      when 'yes' then 'Yes Bank' when 'indusind' then 'IndusInd Bank' when 'au' then 'AU Small Finance Bank'
      when 'federal' then 'Federal Bank' when 'pnb' then 'Punjab National Bank' when 'bob' then 'Bank of Baroda'
      when 'canara' then 'Canara Bank' when 'union' then 'Union Bank of India' when 'idbi' then 'IDBI Bank'
      when 'rbl' then 'RBL Bank' when 'sc' then 'Standard Chartered' when 'hsbc' then 'HSBC'
      when 'amex' then 'American Express' when 'onecard' then 'OneCard' when 'boi' then 'Bank of India'
      else null end;
    insert into public.accounts (user_id, name, type, institution, provider, last4)
    values (uid,
            left(coalesce(nullif(btrim(p_name), ''),
                          concat_ws(' ', coalesce(bank_label, 'Bank'),
                                    case when p_type = 'credit_card' then 'card' else 'account' end,
                                    p_last4)), 60),
            p_type, bank_label, p_bank,
            case when p_last4 ~ '^[0-9]{4}$' then p_last4 end)
    returning id into acc_id;
    created := true;
    -- 3-digit references (ICICI writes "Acct XX234") live as an alias.
    if p_last4 ~ '^[0-9]{3}$' then
      insert into public.account_aliases (user_id, account_id, last4, bank)
      values (uid, acc_id, p_last4, p_bank)
      on conflict do nothing;
    end if;
  end if;

  for mid in
    select b.id from public.bank_messages b
    where b.user_id = uid
      and (b.status = 'needs_account'
           or (b.status = 'ignored' and b.account_id is null and b.parsed ->> 'kind' = 'balance'))
      and b.bank is not distinct from p_bank
      and b.last4 is not distinct from p_last4
    order by b.received_at
  loop
    update public.bank_messages set status = 'received', account_id = acc_id where id = mid;
    perform public.file_message_as_history(mid);
    -- imported history is settled — don't queue it for a one-by-one check
    update public.transactions t set needs_review = false
    from public.bank_messages b
    where b.id = mid and t.id = b.transaction_id and t.user_id = uid
      and coalesce((b.parsed ->> 'imported')::boolean, false);
    -- count transactions filed, not balance-only texts
    if exists (select 1 from public.bank_messages b where b.id = mid and b.parsed ->> 'kind' = 'transaction') then
      n := n + 1;
    end if;
  end loop;

  -- A new bank account starts where the bank says it stands: the opening
  -- balance is chosen so that, at the moment of the most recent SMS that
  -- printed a balance, the app's balance equals the bank's — anything filed
  -- after that message then moves it on from there. (Cards report available
  -- credit, which needs the limit, so their balance is left to the user.)
  if created and not public.is_liability(p_type) then
    select (b.parsed ->> 'balance')::numeric as bal, b.parsed ->> 'balanceKind' as kind, b.received_at as at
    into latest
    from public.bank_messages b
    where b.user_id = uid and b.account_id = acc_id and b.parsed ->> 'balance' is not null
    order by b.received_at desc limit 1;
    if found and coalesce(latest.kind, 'balance') = 'balance' then
      select coalesce(sum(case
               when t.account_id = acc_id and t.type = 'expense' then -t.amount
               when t.account_id = acc_id and t.type = 'income' then t.amount
               when t.account_id = acc_id and t.type = 'adjustment' then t.amount
               when t.account_id = acc_id and t.type = 'transfer' then -t.amount
               when t.to_account_id = acc_id and t.type = 'transfer' then t.amount
               else 0 end), 0)
      into later
      from public.transactions t
      where t.user_id = uid and (t.account_id = acc_id or t.to_account_id = acc_id)
        and t.occurred_at > latest.at;
      select a.current_balance into cur from public.accounts a where a.id = acc_id;
      update public.accounts
      set opening_balance = opening_balance + ((latest.bal + later) - cur)
      where id = acc_id;
    end if;
  end if;

  return jsonb_build_object('account_id', acc_id, 'created', created, 'messages', n);
end;
$$;

revoke execute on function
  public.tg_profiles_timezone(),
  public.file_message_as_history(uuid),
  public.ingest_bank_sms(text, text, text, timestamptz, jsonb, boolean),
  public.account_from_messages(text, text, text, public.account_type, uuid),
  public.discovered_accounts()
from public, anon, authenticated;

grant execute on function public.ingest_bank_sms(text, text, text, timestamptz, jsonb, boolean) to service_role;
grant execute on function
  public.is_bank_sender(text),
  public.discovered_accounts(),
  public.account_from_messages(text, text, text, public.account_type, uuid)
to authenticated;
