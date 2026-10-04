-- =============================================================================
-- Automatic bank sync (bank SMS capture), categorisation rules, review inbox,
-- subscription detection, split transactions and payday cycles.
-- =============================================================================
-- How bank sync works
--   1. The phone forwards bank SMS to the `ingest-sms` Edge Function, which
--      authenticates the per-user ingest key and parses the text.
--   2. `ingest_bank_sms` (service role only) stores the raw message and calls
--      `process_bank_message`, which — atomically, inside one transaction —
--        * matches the message to one of the user's accounts by its last digits,
--        * skips duplicates (same text, or same reference on the same account),
--        * links it to a transaction the user already entered by hand,
--        * pairs the two halves of a transfer between the user's own accounts
--          (and a bank debit with the credit-card payment it made), so moving
--          money is never counted as spending,
--        * otherwise creates the expense/income, auto-categorised, and flags it
--          for review.
--   3. Anything it cannot place (unknown account digits, a card payment with no
--      matching card) waits in the review inbox for one tap from the user.
--
-- Additive only: no existing column, row or behaviour is removed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns on existing tables
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists cycle_start_day smallint not null default 1,
  add column if not exists default_rules_seeded boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_cycle_start_day_check') then
    alter table public.app_settings
      add constraint app_settings_cycle_start_day_check check (cycle_start_day between 1 and 28);
  end if;
end;
$$;
comment on column public.app_settings.cycle_start_day is
  'Day of month the user''s money month starts (their payday). 1 = calendar months.';

alter table public.accounts
  add column if not exists reported_balance      public.money_amount,
  add column if not exists reported_balance_kind text,
  add column if not exists reported_balance_at   timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_reported_balance_kind_check') then
    alter table public.accounts
      add constraint accounts_reported_balance_kind_check
      check (reported_balance_kind is null or reported_balance_kind in ('balance', 'limit'));
  end if;
end;
$$;
comment on column public.accounts.reported_balance is
  'Latest balance (or available credit limit) printed in a bank SMS. Server-written only.';

alter table public.transactions
  add column if not exists source          text not null default 'manual',
  add column if not exists needs_review    boolean not null default false,
  add column if not exists external_ref    text,
  add column if not exists bank_message_id uuid,
  add column if not exists split_group_id  uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_source_check') then
    alter table public.transactions
      add constraint transactions_source_check
      check (source in ('manual', 'sms', 'import', 'recurring', 'receipt'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_external_ref_check') then
    alter table public.transactions
      add constraint transactions_external_ref_check
      check (external_ref is null or char_length(external_ref) between 1 and 64);
  end if;
end;
$$;

create index if not exists transactions_external_ref_idx
  on public.transactions (user_id, external_ref) where external_ref is not null;
create index if not exists transactions_review_idx
  on public.transactions (user_id, occurred_at desc) where needs_review;
create index if not exists transactions_split_idx
  on public.transactions (split_group_id) where split_group_id is not null;

-- ---------------------------------------------------------------------------
-- 2. New tables
-- ---------------------------------------------------------------------------

-- One active key per user. Only a SHA-256 hash is stored; the key itself lives
-- on the user's phone (in the app's secure storage and in the Shortcut).
create table if not exists public.ingest_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key_hash      text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index if not exists ingest_keys_user_idx on public.ingest_keys (user_id) where revoked_at is null;

-- Every forwarded message, kept so nothing is ever lost silently and so the
-- user can see exactly what was read from each SMS.
create table if not exists public.bank_messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  sender          text check (char_length(sender) <= 64),
  body            text not null check (char_length(body) between 1 and 2000),
  body_hash       text not null,
  received_at     timestamptz not null,
  parsed          jsonb not null default '{}'::jsonb,
  status          text not null default 'received' check (status in (
                    'received', 'created', 'linked', 'paired', 'duplicate', 'ignored',
                    'needs_account', 'awaiting_pair', 'balance', 'dismissed')),
  -- Denormalised from `parsed` for pairing queries and the inbox.
  direction       text check (direction in ('debit', 'credit')),
  amount          public.money_amount,
  reference       text,
  last4           text,
  bank            text,
  account_id      uuid,
  transaction_id  uuid,
  note            text check (char_length(note) <= 200),
  created_at      timestamptz not null default now(),
  processed_at    timestamptz,
  unique (id, user_id),
  unique (user_id, body_hash),
  foreign key (account_id) references public.accounts (id) on delete set null,
  foreign key (transaction_id) references public.transactions (id) on delete set null
);
create index if not exists bank_messages_user_idx on public.bank_messages (user_id, received_at desc);
create index if not exists bank_messages_pending_idx
  on public.bank_messages (user_id, status) where status in ('needs_account', 'awaiting_pair');

-- Extra identifiers that belong to an account: a debit card's digits on a
-- savings account, an old account number, a card that was reissued.
create table if not exists public.account_aliases (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id  uuid not null,
  last4       text not null check (last4 ~ '^[0-9]{3,4}$'),
  bank        text check (char_length(bank) <= 20),
  created_at  timestamptz not null default now(),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade
);
create unique index if not exists account_aliases_uq
  on public.account_aliases (user_id, last4, coalesce(bank, ''));

-- "Anything containing SWIGGY is Food › Food Delivery." Longest match wins.
create table if not exists public.categorisation_rules (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pattern         text not null check (char_length(btrim(pattern)) between 2 and 60),
  kind            public.category_kind not null default 'expense',
  category_id     uuid not null,
  subcategory_id  uuid,
  created_at      timestamptz not null default now(),
  unique (id, user_id),
  foreign key (category_id, user_id) references public.transaction_categories (id, user_id) on delete cascade,
  foreign key (subcategory_id, user_id) references public.transaction_categories (id, user_id) on delete set null (subcategory_id)
);
create unique index if not exists categorisation_rules_uq
  on public.categorisation_rules (user_id, kind, lower(btrim(pattern)));

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.regex_escape(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(p, '([.*+?^${}()|\[\]\\/-])', '\\\1', 'g');
$$;

-- Does `p_text` contain `p_pattern` as whole words? ("ola" must not match "cola")
create or replace function public.text_has_words(p_text text, p_pattern text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~* ('(^|[^[:alnum:]])' || public.regex_escape(btrim(p_pattern)) || '($|[^[:alnum:]])');
$$;

create or replace function public.category_by_name(
  p_user_id uuid, p_kind public.category_kind, p_name text, p_parent uuid default null)
returns uuid
language sql
stable
set search_path = ''
as $$
  select c.id from public.transaction_categories c
  where c.user_id = p_user_id and c.kind = p_kind and not c.is_archived
    and lower(c.name) = lower(p_name)
    and c.parent_id is not distinct from p_parent
  order by c.sort_order limit 1;
$$;

-- Built-in Indian merchant rules, seeded once per user, by category name, so a
-- renamed or deleted category is simply skipped.
create or replace function public.seed_default_rules(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  pat text;
  cat uuid;
  sub uuid;
  n integer := 0;
begin
  if coalesce((select s.default_rules_seeded from public.app_settings s where s.user_id = p_user_id), false) then
    return 0;
  end if;

  for rec in
    select * from (values
      ('expense', 'Food', 'Food Delivery', array['swiggy', 'zomato', 'eatsure', 'box8', 'faasos', 'magicpin']),
      ('expense', 'Food', 'Snacks & Coffee', array['starbucks', 'chai point', 'third wave', 'blue tokai', 'chaayos', 'cafe coffee day', 'ccd', 'tim hortons']),
      ('expense', 'Restaurants', null, array['restaurant', 'dominos', 'domino''s', 'mcdonald''s', 'mcdonalds', 'kfc', 'burger king', 'pizza hut', 'haldiram', 'barbeque nation', 'subway', 'dine', 'eatery', 'dhaba', 'biryani']),
      ('expense', 'Groceries', null, array['swiggy instamart', 'instamart', 'blinkit', 'zepto', 'bigbasket', 'dmart', 'jiomart', 'reliance fresh', 'reliance smart', 'more retail', 'spencers', 'nature''s basket', 'ratnadeep', 'kirana', 'supermarket', 'grocery', 'milkbasket', 'country delight']),
      ('expense', 'Shopping', null, array['amazon', 'flipkart', 'meesho', 'tata cliq', 'snapdeal', 'shopsy']),
      ('expense', 'Shopping', 'Clothing', array['myntra', 'ajio', 'westside', 'zara', 'h&m', 'uniqlo', 'max fashion', 'pantaloons', 'lifestyle', 'trends', 'fabindia', 'snitch']),
      ('expense', 'Shopping', 'Electronics', array['croma', 'reliance digital', 'vijay sales', 'apple store', 'samsung']),
      ('expense', 'Shopping', 'Home', array['ikea', 'pepperfry', 'urban ladder', 'home centre', 'wakefit']),
      ('expense', 'Transport', 'Cab & Auto', array['uber', 'ola', 'rapido', 'blusmart', 'namma yatri', 'meru']),
      ('expense', 'Transport', 'Public Transport', array['metro', 'dmrc', 'bmrcl', 'bmtc', 'ksrtc', 'tsrtc', 'msrtc', 'apsrtc', 'redbus']),
      ('expense', 'Transport', 'Parking & Tolls', array['fastag', 'toll', 'parking', 'nhai']),
      ('expense', 'Fuel', null, array['petrol', 'fuel', 'hpcl', 'bpcl', 'iocl', 'indian oil', 'hindustan petroleum', 'bharat petroleum', 'shell', 'nayara', 'filling station']),
      ('expense', 'Travel', null, array['makemytrip', 'goibibo', 'cleartrip', 'yatra', 'ixigo', 'easemytrip', 'irctc']),
      ('expense', 'Travel', 'Flights', array['indigo', 'air india', 'akasa', 'spicejet', 'vistara', 'air asia']),
      ('expense', 'Travel', 'Hotels', array['oyo', 'airbnb', 'booking.com', 'agoda', 'taj hotels', 'marriott', 'treebo', 'fabhotels', 'zostel']),
      ('expense', 'Entertainment', null, array['bookmyshow', 'pvr', 'inox', 'cinepolis', 'paytm insider', 'steam', 'playstation']),
      ('expense', 'Subscriptions', null, array['netflix', 'spotify', 'jiohotstar', 'hotstar', 'prime video', 'amazon prime', 'youtube', 'apple', 'icloud', 'google play', 'google one', 'jiocinema', 'sonyliv', 'zee5', 'audible', 'openai', 'chatgpt', 'claude', 'anthropic', 'adobe', 'microsoft', 'notion', 'linkedin']),
      ('expense', 'Utilities', 'Electricity', array['bescom', 'tneb', 'tangedco', 'msedcl', 'mahadiscom', 'adani electricity', 'tata power', 'bses', 'electricity', 'cesc', 'tsspdcl', 'apspdcl', 'kseb', 'uppcl', 'electricity board']),
      ('expense', 'Utilities', 'Mobile & Internet', array['airtel', 'jio', 'vodafone', 'vi', 'bsnl', 'act fibernet', 'hathway', 'broadband', 'tata play', 'dth', 'recharge']),
      ('expense', 'Utilities', 'Gas', array['indane', 'hp gas', 'bharat gas', 'mahanagar gas', 'igl', 'gail gas', 'cylinder']),
      ('expense', 'Utilities', 'Water', array['water board', 'bwssb', 'water bill', 'jal board']),
      ('expense', 'Rent', null, array['rent', 'nobroker', 'nestaway', 'stanza', 'zolo', 'housing.com']),
      ('expense', 'Healthcare', null, array['hospital', 'clinic', 'diagnostic', 'lab', 'thyrocare', 'dr lal', 'metropolis']),
      ('expense', 'Healthcare', 'Medicines', array['apollo', 'pharmeasy', '1mg', 'tata 1mg', 'netmeds', 'medplus', 'pharmacy', 'chemist', 'medical']),
      ('expense', 'Healthcare', 'Doctor', array['practo', 'doctor', 'dental', 'mfine']),
      ('expense', 'Fitness', null, array['cult.fit', 'cultfit', 'gym', 'fitness', 'decathlon', 'yoga', 'hrx']),
      ('expense', 'Education', null, array['udemy', 'coursera', 'byju', 'unacademy', 'upgrad', 'school', 'college', 'university', 'tuition', 'fees']),
      ('expense', 'Insurance', null, array['lic', 'insurance', 'policybazaar', 'hdfc ergo', 'icici lombard', 'star health', 'acko', 'digit insurance', 'max life', 'tata aia', 'niva bupa', 'care health']),
      ('expense', 'Loans & EMI', null, array['emi', 'loan', 'bajaj finance', 'bajaj finserv', 'home credit', 'tata capital', 'hdb financial', 'navi', 'kreditbee', 'moneyview']),
      ('expense', 'Investments', null, array['zerodha', 'groww', 'upstox', 'kuvera', 'smallcase', 'indmoney', 'paytm money', 'angel one', 'mutual fund', 'nps', 'sip', 'icclzerodha', 'bse star']),
      ('expense', 'Personal Care', null, array['nykaa', 'salon', 'urban company', 'spa', 'lenskart', 'barber', 'parlour', 'purplle']),
      ('expense', 'Gifts', null, array['fnp', 'ferns n petals', 'igp', 'archies', 'gift']),
      ('income',  'Salary', null, array['salary', 'payroll', 'sal']),
      ('income',  'Interest', null, array['interest', 'int.pd', 'int pd', 'int.cr']),
      ('income',  'Dividends', null, array['dividend', 'div']),
      ('income',  'Refunds', null, array['refund', 'reversal', 'reversed', 'cashback'])
    ) as v(kind, cat_name, sub_name, patterns)
  loop
    cat := public.category_by_name(p_user_id, rec.kind::public.category_kind, rec.cat_name);
    continue when cat is null;
    sub := case when rec.sub_name is null then null
                else public.category_by_name(p_user_id, rec.kind::public.category_kind, rec.sub_name, cat) end;
    foreach pat in array rec.patterns loop
      insert into public.categorisation_rules (user_id, pattern, kind, category_id, subcategory_id)
      values (p_user_id, pat, rec.kind::public.category_kind, cat, sub)
      on conflict do nothing;
      n := n + 1;
    end loop;
  end loop;

  update public.app_settings set default_rules_seeded = true where user_id = p_user_id;
  return n;
end;
$$;

-- What category should a bank transaction get?
--   1. the merchant's remembered category (set when the user corrects one),
--   2. the longest matching rule,
--   3. nothing — the caller falls back to Other / Other Income.
create or replace function public.suggest_category(
  p_user_id uuid, p_kind public.category_kind, p_text text, p_merchant_id uuid)
returns table (category_id uuid, subcategory_id uuid)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_merchant_id is not null then
    return query
      select m.default_category_id, null::uuid
      from public.merchants m
      join public.transaction_categories c on c.id = m.default_category_id
      where m.id = p_merchant_id and m.user_id = p_user_id and c.kind = p_kind and not c.is_archived;
    if found then return; end if;
  end if;

  return query
    select r.category_id, r.subcategory_id
    from public.categorisation_rules r
    join public.transaction_categories c on c.id = r.category_id
    where r.user_id = p_user_id and r.kind = p_kind and not c.is_archived
      and public.text_has_words(p_text, r.pattern)
    order by char_length(r.pattern) desc, r.created_at
    limit 1;
end;
$$;

-- Find the user's account for a message's last digits. Returns null when there
-- is no match *or* more than one — guessing between two accounts would put
-- money in the wrong place, so ambiguity goes to the review inbox instead.
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
      and (types is null or a.type = any (types));
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

create or replace function public.merchant_for(p_user_id uuid, p_name text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  clean text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  mid uuid;
begin
  if clean is null then return null; end if;
  select m.id into mid from public.merchants m
  where m.user_id = p_user_id and m.normalized_name = lower(left(clean, 80));
  if mid is null then
    insert into public.merchants (user_id, name) values (p_user_id, left(clean, 80))
    on conflict (user_id, normalized_name) do update set is_archived = false
    returning id into mid;
  end if;
  return mid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The processor
-- ---------------------------------------------------------------------------
create or replace function public.process_bank_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg       public.bank_messages;
  p         jsonb;
  uid       uuid;
  tz        text;
  acc       public.accounts;
  other     public.accounts;
  amt       numeric(18, 2);
  dir       text;
  ref       text;
  occurred  timestamptz;
  t         public.transactions;
  pair      public.bank_messages;
  v_kind    public.category_kind;
  cat_id    uuid;
  sub_id    uuid;
  mid       uuid;
  descr     text;
  label     text;
  flag_bill boolean;
  flag_card_paid boolean;
  cash_id   uuid;
  new_id    uuid;
begin
  select * into msg from public.bank_messages where id = p_message_id for update;
  if not found then
    raise exception 'CF801: Message not found';
  end if;
  if msg.status in ('created', 'linked', 'paired', 'duplicate', 'dismissed') then
    return jsonb_build_object('status', msg.status, 'transaction_id', msg.transaction_id);
  end if;

  uid := msg.user_id;
  p := msg.parsed;
  tz := coalesce((select pr.timezone from public.profiles pr where pr.id = uid), 'Asia/Kolkata');
  perform public.seed_default_rules(uid);

  -- Not a money movement.
  if coalesce(p ->> 'kind', '') not in ('transaction', 'balance') then
    update public.bank_messages
    set status = 'ignored', note = left(coalesce(p ->> 'reason', 'not a transaction'), 200), processed_at = now()
    where id = msg.id;
    return jsonb_build_object('status', 'ignored', 'summary', 'Not a transaction');
  end if;

  -- Which account?
  if msg.account_id is not null then
    select * into acc from public.accounts where id = msg.account_id and user_id = uid;
  else
    select * into acc from public.accounts
    where id = public.match_account(uid, p ->> 'last4', p ->> 'instrument', p ->> 'bank');
  end if;

  if p ->> 'kind' = 'balance' then
    if acc.id is not null then
      update public.accounts
      set reported_balance = (p ->> 'balance')::numeric,
          reported_balance_kind = p ->> 'balanceKind',
          reported_balance_at = msg.received_at
      where id = acc.id and (reported_balance_at is null or reported_balance_at <= msg.received_at);
    end if;
    update public.bank_messages
    set status = case when acc.id is null then 'ignored' else 'balance' end,
        account_id = acc.id, processed_at = now()
    where id = msg.id;
    return jsonb_build_object('status', 'balance', 'summary', 'Balance updated');
  end if;

  amt := (p ->> 'amount')::numeric;
  dir := p ->> 'direction';
  ref := nullif(p ->> 'reference', '');
  flag_bill := coalesce((p ->> 'isCardBillPayment')::boolean, false);
  flag_card_paid := coalesce((p ->> 'isCardPaymentReceived')::boolean, false);
  descr := btrim(concat_ws(' ', p ->> 'merchant', p ->> 'counterparty'));
  label := coalesce(nullif(p ->> 'merchant', ''), case when dir = 'debit' then 'Payment' else 'Money received' end);

  -- When it happened: the moment the SMS arrived, unless the SMS prints a
  -- different day (a delayed message) — then midday on that day.
  occurred := msg.received_at;
  if p ->> 'occurredOn' is not null
     and (p ->> 'occurredOn')::date <> (msg.received_at at time zone tz)::date then
    occurred := public.local_day_start((p ->> 'occurredOn')::date, tz) + interval '12 hours';
  end if;

  if acc.id is null then
    update public.bank_messages
    set status = 'needs_account', processed_at = now(),
        note = case when p ->> 'last4' is null then 'Which account is this?'
                    else 'Which account ends in ' || (p ->> 'last4') || '?' end
    where id = msg.id;
    return jsonb_build_object('status', 'needs_account',
      'summary', 'Needs an account: ' || coalesce('••' || (p ->> 'last4'), 'unknown'));
  end if;

  update public.bank_messages set account_id = acc.id where id = msg.id;

  -- Keep the bank's own balance figure for reconciliation.
  if p ->> 'balance' is not null then
    update public.accounts
    set reported_balance = (p ->> 'balance')::numeric,
        reported_balance_kind = coalesce(p ->> 'balanceKind', 'balance'),
        reported_balance_at = msg.received_at
    where id = acc.id and (reported_balance_at is null or reported_balance_at <= msg.received_at);
  end if;

  -- (a) Same reference already recorded.
  if ref is not null then
    -- The same side of the same movement → duplicate.
    select * into t from public.transactions x
    where x.user_id = uid and x.external_ref = ref
      and (
        (dir = 'debit'  and x.account_id = acc.id and x.type in ('expense', 'transfer')) or
        (dir = 'credit' and ((x.type = 'income' and x.account_id = acc.id) or
                             (x.type = 'transfer' and x.to_account_id = acc.id)))
      )
    limit 1;
    if found then
      update public.bank_messages
      set status = 'duplicate', transaction_id = t.id, processed_at = now()
      where id = msg.id;
      return jsonb_build_object('status', 'duplicate', 'transaction_id', t.id, 'summary', 'Already recorded');
    end if;

    -- The other half of a transfer between the user's own accounts.
    select * into t from public.transactions x
    where x.user_id = uid and x.external_ref = ref and x.source = 'sms'
      and x.amount = amt and x.split_group_id is null
      and (
        (dir = 'credit' and x.type = 'expense' and x.account_id <> acc.id) or
        (dir = 'debit'  and x.type = 'income'  and x.account_id <> acc.id)
      )
    limit 1;
    if found then
      if dir = 'credit' then
        update public.transactions
        set type = 'transfer', to_account_id = acc.id, category_id = null, subcategory_id = null,
            merchant_id = null, needs_review = true
        where id = t.id;
      else
        update public.transactions
        set type = 'transfer', to_account_id = t.account_id, account_id = acc.id, category_id = null,
            subcategory_id = null, merchant_id = null, needs_review = true
        where id = t.id;
      end if;
      update public.bank_messages set status = 'paired', transaction_id = t.id, processed_at = now()
      where id = msg.id;
      update public.bank_messages set status = 'paired' where id = t.bank_message_id;
      return jsonb_build_object('status', 'paired', 'transaction_id', t.id,
        'summary', 'Transfer between your accounts');
    end if;
  end if;

  -- (b) The SMS names the other account and it is one of the user's.
  if p ->> 'counterpartyLast4' is not null then
    select * into other from public.accounts
    where id = public.match_account(uid, p ->> 'counterpartyLast4', 'account', null);
    if other.id is not null and other.id <> acc.id and other.currency = acc.currency then
      insert into public.transactions (user_id, type, amount, account_id, to_account_id, occurred_at,
                                       source, needs_review, external_ref, bank_message_id)
      values (uid, 'transfer', amt,
              case when dir = 'debit' then acc.id else other.id end,
              case when dir = 'debit' then other.id else acc.id end,
              occurred, 'sms', true, ref, msg.id)
      returning * into t;
      update public.bank_messages set status = 'paired', transaction_id = t.id, processed_at = now()
      where id = msg.id;
      return jsonb_build_object('status', 'paired', 'transaction_id', t.id,
        'summary', 'Transfer between your accounts');
    end if;
  end if;

  -- (c) A credit-card payment arriving on the card.
  if dir = 'credit' and flag_card_paid and acc.type = 'credit_card' then
    -- Already recorded from the bank side?
    select * into t from public.transactions x
    where x.user_id = uid and x.type = 'transfer' and x.to_account_id = acc.id and x.amount = amt
      and x.source = 'sms' and x.occurred_at between occurred - interval '7 days' and occurred + interval '2 days'
      and not exists (select 1 from public.bank_messages b
                      where b.transaction_id = x.id and b.id <> x.bank_message_id and b.direction = 'credit')
    order by abs(extract(epoch from x.occurred_at - occurred)) limit 1;
    if found then
      update public.bank_messages set status = 'duplicate', transaction_id = t.id, processed_at = now()
      where id = msg.id;
      return jsonb_build_object('status', 'duplicate', 'transaction_id', t.id, 'summary', 'Card payment already recorded');
    end if;

    -- A bank debit waiting to be paired with exactly this payment?
    select * into pair from public.bank_messages b
    where b.user_id = uid and b.status = 'awaiting_pair' and b.direction = 'debit' and b.amount = amt
      and b.account_id is not null and b.account_id <> acc.id
      and b.received_at between msg.received_at - interval '7 days' and msg.received_at + interval '2 days'
    order by abs(extract(epoch from b.received_at - msg.received_at)) limit 1
    for update;
    if found then
      insert into public.transactions (user_id, type, amount, account_id, to_account_id, occurred_at,
                                       source, needs_review, external_ref, bank_message_id)
      values (uid, 'transfer', amt, pair.account_id, acc.id, least(occurred, pair.received_at),
              'sms', true, coalesce(pair.reference, ref), pair.id)
      returning * into t;
      update public.bank_messages set status = 'paired', transaction_id = t.id, processed_at = now()
      where id in (msg.id, pair.id);
      return jsonb_build_object('status', 'paired', 'transaction_id', t.id, 'summary', 'Card bill paid');
    end if;

    update public.bank_messages
    set status = 'awaiting_pair', processed_at = now(), note = 'Which account paid this card bill?'
    where id = msg.id;
    return jsonb_build_object('status', 'awaiting_pair', 'summary', 'Card payment — waiting for the bank side');
  end if;

  -- (d) A bank debit that pays a credit-card bill.
  if dir = 'debit' and flag_bill and acc.type <> 'credit_card' then
    select * into pair from public.bank_messages b
    where b.user_id = uid and b.status = 'awaiting_pair' and b.direction = 'credit' and b.amount = amt
      and b.received_at between msg.received_at - interval '2 days' and msg.received_at + interval '7 days'
    order by abs(extract(epoch from b.received_at - msg.received_at)) limit 1
    for update;
    if found then
      select * into other from public.accounts where id = pair.account_id;
    else
      -- With exactly one credit card there is nothing to guess.
      select * into other from public.accounts a
      where a.user_id = uid and a.is_active and a.type = 'credit_card' and a.currency = acc.currency
        and (select count(*) from public.accounts z
             where z.user_id = uid and z.is_active and z.type = 'credit_card') = 1;
    end if;

    if other.id is not null then
      insert into public.transactions (user_id, type, amount, account_id, to_account_id, occurred_at,
                                       source, needs_review, external_ref, bank_message_id)
      values (uid, 'transfer', amt, acc.id, other.id, occurred, 'sms', true, ref, msg.id)
      returning * into t;
      update public.bank_messages set status = 'paired', transaction_id = t.id, processed_at = now()
      where id = msg.id or (pair.id is not null and id = pair.id);
      return jsonb_build_object('status', 'paired', 'transaction_id', t.id, 'summary', 'Card bill paid');
    end if;

    update public.bank_messages
    set status = 'awaiting_pair', processed_at = now(), note = 'Which card did this pay?'
    where id = msg.id;
    return jsonb_build_object('status', 'awaiting_pair', 'summary', 'Card bill payment — which card?');
  end if;

  -- (e) Cash from an ATM moves money into the user's cash, it is not spending.
  if dir = 'debit' and coalesce((p ->> 'isCashWithdrawal')::boolean, false)
     and acc.type in ('bank', 'savings', 'debit_card') then
    select a.id into cash_id from public.accounts a
    where a.user_id = uid and a.is_active and a.type = 'cash' and a.currency = acc.currency
    order by a.sort_order, a.created_at limit 1;
    if cash_id is null then
      insert into public.accounts (user_id, name, type, currency, icon)
      values (uid,
              case when exists (select 1 from public.accounts z where z.user_id = uid and lower(z.name) = 'cash')
                   then 'Cash wallet' else 'Cash' end,
              'cash', acc.currency, 'cash-outline')
      returning id into cash_id;
    end if;
    insert into public.transactions (user_id, type, amount, account_id, to_account_id, occurred_at,
                                     source, needs_review, external_ref, bank_message_id, notes)
    values (uid, 'transfer', amt, acc.id, cash_id, occurred, 'sms', true, ref, msg.id, 'ATM withdrawal')
    returning * into t;
    update public.bank_messages set status = 'created', transaction_id = t.id, processed_at = now()
    where id = msg.id;
    return jsonb_build_object('status', 'created', 'transaction_id', t.id, 'summary', 'Cash withdrawn ₹' || amt);
  end if;

  -- (f) Something the user already typed in by hand → link, don't duplicate.
  select * into t from public.transactions x
  where x.user_id = uid and x.account_id = acc.id and x.amount = amt
    and x.source = 'manual' and x.bank_message_id is null and x.external_ref is null
    and x.type = case when dir = 'debit' then 'expense' else 'income' end::public.txn_type
    and x.occurred_at between occurred - interval '2 days' and occurred + interval '2 days'
  order by abs(extract(epoch from x.occurred_at - occurred)) limit 1
  for update;
  if found then
    update public.transactions set external_ref = ref, bank_message_id = msg.id where id = t.id;
    update public.bank_messages set status = 'linked', transaction_id = t.id, processed_at = now()
    where id = msg.id;
    return jsonb_build_object('status', 'linked', 'transaction_id', t.id, 'summary', 'Matched your entry');
  end if;

  -- (g) A new expense or income.
  v_kind := case when dir = 'debit' then 'expense' else 'income' end;
  mid := public.merchant_for(uid, p ->> 'merchant');

  select s.category_id, s.subcategory_id into cat_id, sub_id
  from public.suggest_category(uid, v_kind, descr, mid) s;

  if cat_id is null and v_kind = 'income' then
    cat_id := case
      when coalesce((p ->> 'isRefund')::boolean, false) then public.category_by_name(uid, v_kind, 'Refunds')
      when coalesce((p ->> 'isSalary')::boolean, false) then public.category_by_name(uid, v_kind, 'Salary')
      when coalesce((p ->> 'isInterest')::boolean, false) then public.category_by_name(uid, v_kind, 'Interest')
      else null end;
    if cat_id is null and acc.type = 'credit_card' then
      cat_id := public.category_by_name(uid, v_kind, 'Refunds');
    end if;
  end if;
  if cat_id is null then
    cat_id := coalesce(
      public.category_by_name(uid, v_kind, case when v_kind = 'expense' then 'Other' else 'Other Income' end),
      (select c.id from public.transaction_categories c
       where c.user_id = uid and c.kind = v_kind and c.parent_id is null and not c.is_archived
       order by c.sort_order desc limit 1));
    sub_id := null;
  end if;
  if cat_id is null then
    raise exception 'CF802: No % category to file this under', v_kind;
  end if;

  new_id := gen_random_uuid();
  insert into public.transactions (id, user_id, type, amount, account_id, category_id, subcategory_id,
                                   merchant_id, occurred_at, source, needs_review, external_ref,
                                   bank_message_id)
  values (new_id, uid, v_kind::text::public.txn_type, amt, acc.id, cat_id, sub_id, mid, occurred,
          'sms', true, ref, msg.id)
  returning * into t;

  update public.bank_messages set status = 'created', transaction_id = t.id, processed_at = now()
  where id = msg.id;

  return jsonb_build_object(
    'status', 'created',
    'transaction_id', t.id,
    'summary', case when dir = 'debit' then 'Spent ₹' || amt || ' · ' || label
                    else 'Received ₹' || amt || ' · ' || label end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Entry point for the Edge Function (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.ingest_bank_sms(
  p_key_hash    text,
  p_sender      text,
  p_body        text,
  p_received_at timestamptz,
  p_parsed      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k     public.ingest_keys;
  hash  text;
  mid   uuid;
  recent integer;
  received timestamptz := least(coalesce(p_received_at, now()), now() + interval '5 minutes');
  tz text;
begin
  select * into k from public.ingest_keys
  where key_hash = lower(p_key_hash) and revoked_at is null;
  if not found then
    raise exception 'CF810: Unknown or revoked sync key';
  end if;

  update public.ingest_keys set last_used_at = now() where id = k.id;

  select count(*) into recent from public.bank_messages
  where user_id = k.user_id and created_at > now() - interval '1 hour';
  if recent >= 300 then
    raise exception 'CF811: Too many messages in the last hour';
  end if;

  -- Anything that is not a bank transaction or balance (an OTP, a promotion,
  -- an ordinary text that slipped past the phone's filter) is discarded here
  -- and never stored.
  if coalesce(p_parsed ->> 'kind', '') not in ('transaction', 'balance') then
    return jsonb_build_object('status', 'ignored', 'summary',
      'Not a bank transaction (' || coalesce(replace(p_parsed ->> 'reason', '_', ' '), 'unrecognised') || ')');
  end if;

  tz := coalesce((select pr.timezone from public.profiles pr where pr.id = k.user_id), 'Asia/Kolkata');
  -- Same text on the same day = the same message delivered twice.
  hash := md5(coalesce(p_sender, '') || '|' || btrim(p_body) || '|' || ((received at time zone tz)::date)::text);

  insert into public.bank_messages (user_id, sender, body, body_hash, received_at, parsed,
                                    direction, amount, reference, last4, bank)
  values (k.user_id, left(p_sender, 64), left(btrim(p_body), 2000), hash, received, coalesce(p_parsed, '{}'),
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

  return public.process_bank_message(mid) || jsonb_build_object('message_id', mid);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. User-facing RPCs (authenticated; every one checks ownership)
-- ---------------------------------------------------------------------------

-- Replaces any previous key. The app generates the key on the phone and only
-- ever sends its hash here.
create or replace function public.register_ingest_key(p_key_hash text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  created timestamptz;
begin
  if auth.uid() is null then raise exception 'CF001: Not authenticated'; end if;
  if p_key_hash !~ '^[0-9a-f]{64}$' then raise exception 'CF812: Invalid key'; end if;
  update public.ingest_keys set revoked_at = now() where user_id = auth.uid() and revoked_at is null;
  insert into public.ingest_keys (user_id, key_hash) values (auth.uid(), p_key_hash)
  returning created_at into created;
  perform public.seed_default_rules(auth.uid());
  return created;
end;
$$;

create or replace function public.revoke_ingest_keys()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ingest_keys set revoked_at = now() where user_id = auth.uid() and revoked_at is null;
$$;

create or replace function public.bank_sync_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'connected', exists (select 1 from public.ingest_keys k where k.user_id = auth.uid() and k.revoked_at is null),
    'connected_at', (select max(k.created_at) from public.ingest_keys k where k.user_id = auth.uid() and k.revoked_at is null),
    'last_message_at', (select max(k.last_used_at) from public.ingest_keys k where k.user_id = auth.uid()),
    'pending', (select count(*) from public.bank_messages b
                where b.user_id = auth.uid() and b.status in ('needs_account', 'awaiting_pair')),
    'to_review', (select count(*) from public.transactions t where t.user_id = auth.uid() and t.needs_review),
    'last_30_days', coalesce((
      select jsonb_object_agg(s.status, s.n) from (
        select b.status, count(*) as n from public.bank_messages b
        where b.user_id = auth.uid() and b.created_at > now() - interval '30 days'
        group by b.status) s), '{}'::jsonb)
  );
$$;

-- Put a waiting message into an account (and, with p_remember, teach the app
-- that these digits belong to that account from now on).
create or replace function public.assign_bank_message(
  p_message_id uuid, p_account_id uuid, p_remember boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.bank_messages;
  acc public.accounts;
  result jsonb;
  other_id uuid;
  t public.transactions;
begin
  if auth.uid() is null then raise exception 'CF001: Not authenticated'; end if;
  select * into msg from public.bank_messages where id = p_message_id and user_id = auth.uid() for update;
  if not found then raise exception 'CF801: Message not found'; end if;
  select * into acc from public.accounts where id = p_account_id and user_id = auth.uid() and is_active;
  if not found then raise exception 'CF201: Account not found'; end if;

  -- An awaiting card payment / bill payment: the chosen account is the other side.
  if msg.status = 'awaiting_pair' then
    if msg.account_id is null or msg.account_id = acc.id then
      raise exception 'CF813: Choose the other account in this payment';
    end if;
    insert into public.transactions (user_id, type, amount, account_id, to_account_id, occurred_at,
                                     source, needs_review, external_ref, bank_message_id)
    values (auth.uid(), 'transfer', msg.amount,
            case when msg.direction = 'debit' then msg.account_id else acc.id end,
            case when msg.direction = 'debit' then acc.id else msg.account_id end,
            msg.received_at, 'sms', false, msg.reference, msg.id)
    returning * into t;
    update public.bank_messages set status = 'paired', transaction_id = t.id, processed_at = now()
    where id = msg.id;
    return jsonb_build_object('status', 'paired', 'transaction_id', t.id);
  end if;

  if msg.status <> 'needs_account' then
    raise exception 'CF814: This message has already been handled';
  end if;

  if p_remember and msg.last4 is not null then
    insert into public.account_aliases (user_id, account_id, last4, bank)
    values (auth.uid(), acc.id, right(msg.last4, 4), msg.bank)
    on conflict do nothing;
  end if;

  update public.bank_messages set account_id = acc.id, status = 'received' where id = msg.id;
  result := public.process_bank_message(msg.id);

  -- Everything else waiting on the same digits now has a home too.
  if p_remember and msg.last4 is not null then
    for other_id in
      select b.id from public.bank_messages b
      where b.user_id = auth.uid() and b.status = 'needs_account' and b.last4 = msg.last4
        and b.bank is not distinct from msg.bank
      order by b.received_at
    loop
      update public.bank_messages set status = 'received' where id = other_id;
      perform public.process_bank_message(other_id);
    end loop;
  end if;
  return result;
end;
$$;

-- An awaiting card payment that came from money the app doesn't track:
-- record it as a balance correction on the card, never as income.
create or replace function public.settle_bank_message_externally(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.bank_messages;
  t public.transactions;
begin
  if auth.uid() is null then raise exception 'CF001: Not authenticated'; end if;
  select * into msg from public.bank_messages
  where id = p_message_id and user_id = auth.uid() and status = 'awaiting_pair' and account_id is not null
  for update;
  if not found then raise exception 'CF801: Message not found'; end if;

  insert into public.transactions (user_id, type, amount, account_id, occurred_at, source, notes, bank_message_id)
  values (auth.uid(), 'adjustment',
          case when msg.direction = 'credit' then msg.amount else -msg.amount end,
          msg.account_id, msg.received_at, 'sms',
          case when msg.direction = 'credit' then 'Card payment from an account not in the app'
               else 'Card payment to a card not in the app' end,
          msg.id)
  returning * into t;
  update public.bank_messages set status = 'paired', transaction_id = t.id, processed_at = now() where id = msg.id;
  return jsonb_build_object('status', 'paired', 'transaction_id', t.id);
end;
$$;

create or replace function public.dismiss_bank_message(p_message_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.bank_messages set status = 'dismissed', processed_at = now()
  where id = p_message_id and user_id = auth.uid() and status in ('needs_account', 'awaiting_pair', 'ignored');
$$;

-- Re-run everything still waiting (e.g. after the user added an account with
-- the right last digits).
create or replace function public.retry_bank_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  mid uuid;
  n integer := 0;
  r jsonb;
begin
  if auth.uid() is null then raise exception 'CF001: Not authenticated'; end if;
  for mid in
    select b.id from public.bank_messages b
    where b.user_id = auth.uid() and b.status = 'needs_account'
    order by b.received_at
  loop
    update public.bank_messages set status = 'received' where id = mid;
    r := public.process_bank_message(mid);
    if r ->> 'status' <> 'needs_account' then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

-- Confirm an auto-added transaction, optionally recategorising it and
-- remembering the category for the merchant.
create or replace function public.review_transaction(
  p_id uuid,
  p_category_id uuid default null,
  p_subcategory_id uuid default null,
  p_remember boolean default false
)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  t public.transactions;
begin
  select * into t from public.transactions where id = p_id for update;
  if not found then raise exception 'CF207: Transaction not found'; end if;

  if p_category_id is not null and t.type in ('expense', 'income') then
    update public.transactions
    set category_id = p_category_id, subcategory_id = p_subcategory_id, needs_review = false
    where id = p_id
    returning * into t;
    if p_remember and t.merchant_id is not null then
      update public.merchants set default_category_id = p_category_id where id = t.merchant_id;
    end if;
  else
    update public.transactions set needs_review = false where id = p_id returning * into t;
  end if;
  return t;
end;
$$;

create or replace function public.mark_transactions_reviewed(p_ids uuid[] default null)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with u as (
    update public.transactions set needs_review = false
    where needs_review and user_id = auth.uid() and (p_ids is null or id = any (p_ids))
    returning 1
  )
  select count(*)::integer from u;
$$;

-- ---------------------------------------------------------------------------
-- 7. Split a transaction across categories
-- ---------------------------------------------------------------------------
-- p_parts: [{"amount": "120.00", "category_id": "…", "subcategory_id": null, "notes": "…"}, …]
-- The parts must add up exactly to the original amount. The original row keeps
-- the first part (and its bank reference); the rest become new rows sharing a
-- split_group_id, so balances never move.
create or replace function public.split_transaction(p_id uuid, p_parts jsonb)
returns setof public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.transactions;
  part jsonb;
  total numeric(18, 2) := 0;
  grp uuid;
  i integer := 0;
  a numeric;
begin
  if auth.uid() is null then raise exception 'CF001: Not authenticated'; end if;
  select * into t from public.transactions where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'CF207: Transaction not found'; end if;
  if t.type not in ('expense', 'income') then raise exception 'CF820: Only expenses and income can be split'; end if;
  if jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) not between 2 and 10 then
    raise exception 'CF821: Split into between 2 and 10 parts';
  end if;

  for part in select * from jsonb_array_elements(p_parts) loop
    a := (part ->> 'amount')::numeric;
    if a is null or a <= 0 or a <> round(a, 2) then
      raise exception 'CF822: Every part needs a positive amount';
    end if;
    total := total + a;
  end loop;
  if total <> t.amount then
    raise exception 'CF823: The parts must add up to %', t.amount;
  end if;

  grp := coalesce(t.split_group_id, gen_random_uuid());
  for part in select * from jsonb_array_elements(p_parts) loop
    i := i + 1;
    if i = 1 then
      update public.transactions
      set amount = (part ->> 'amount')::numeric,
          category_id = (part ->> 'category_id')::uuid,
          subcategory_id = nullif(part ->> 'subcategory_id', '')::uuid,
          notes = coalesce(nullif(btrim(part ->> 'notes'), ''), notes),
          split_group_id = grp,
          needs_review = false
      where id = t.id
      returning * into t;
      return next t;
    else
      return query
      insert into public.transactions (user_id, type, amount, account_id, category_id, subcategory_id,
                                       merchant_id, occurred_at, notes, source, split_group_id)
      values (auth.uid(), t.type, (part ->> 'amount')::numeric, t.account_id,
              (part ->> 'category_id')::uuid, nullif(part ->> 'subcategory_id', '')::uuid,
              t.merchant_id, t.occurred_at, nullif(btrim(part ->> 'notes'), ''), t.source, grp)
      returning *;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Subscription & recurring-payment detection
-- ---------------------------------------------------------------------------
-- Looks for merchants charged at a steady rhythm (weekly, monthly, quarterly,
-- yearly) for a steady amount, and says when the next charge is due.
create or replace function public.detect_recurring_payments()
returns table (
  merchant_id uuid,
  merchant_name text,
  category_id uuid,
  account_id uuid,
  frequency public.recurrence_frequency,
  typical_amount numeric,
  last_amount numeric,
  occurrences integer,
  last_date date,
  next_date date,
  is_tracked boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with tz as (select public.user_timezone() as z),
  tx as (
    select t.merchant_id, t.amount, t.account_id, t.category_id,
           (t.occurred_at at time zone tz.z)::date as d
    from public.transactions t, tz
    where t.user_id = auth.uid() and t.type = 'expense' and t.merchant_id is not null
      and t.occurred_at > now() - interval '420 days'
  ),
  daily as (
    -- several charges at one merchant on one day count once
    select merchant_id, d, sum(amount) as amount,
           (array_agg(account_id))[1] as account_id, (array_agg(category_id))[1] as category_id
    from tx group by merchant_id, d
  ),
  gaps as (
    select *, d - lag(d) over (partition by merchant_id order by d) as gap from daily
  ),
  agg as (
    select g.merchant_id,
           count(*)::integer as n,
           percentile_cont(0.5) within group (order by g.gap) filter (where g.gap is not null) as med_gap,
           min(g.gap) filter (where g.gap is not null) as min_gap,
           max(g.gap) filter (where g.gap is not null) as max_gap,
           percentile_cont(0.5) within group (order by g.amount) as med_amount,
           min(g.amount) as min_amount,
           max(g.amount) as max_amount,
           max(g.d) as last_d,
           (array_agg(g.amount order by g.d desc))[1] as last_amount,
           (array_agg(g.account_id order by g.d desc))[1] as account_id,
           (array_agg(g.category_id order by g.d desc))[1] as category_id
    from gaps g group by g.merchant_id
  ),
  classified as (
    select a.*,
      case
        when a.med_gap between 6 and 8   and a.min_gap >= 5   and a.max_gap <= 9   and a.n >= 4 then 'weekly'
        when a.med_gap between 26 and 35 and a.min_gap >= 24  and a.max_gap <= 38  and a.n >= 3 then 'monthly'
        when a.med_gap between 84 and 98 and a.min_gap >= 80  and a.max_gap <= 100 and a.n >= 2 then 'quarterly'
        when a.med_gap between 350 and 380 and a.n >= 2 then 'yearly'
      end as freq
    from agg a
  )
  select c.merchant_id, m.name, c.category_id, c.account_id, c.freq::public.recurrence_frequency,
         round(c.med_amount::numeric, 2), c.last_amount, c.n, c.last_d,
         (c.last_d + case c.freq when 'weekly' then interval '7 days' when 'monthly' then interval '1 month'
                                 when 'quarterly' then interval '3 months' else interval '1 year' end)::date,
         exists (select 1 from public.recurring_transactions r
                 where r.user_id = auth.uid() and r.merchant_id = c.merchant_id and r.is_active)
  from classified c
  join public.merchants m on m.id = c.merchant_id
  where c.freq is not null
    and c.max_amount <= c.min_amount * 1.35
    -- still alive: the next charge isn't long overdue
    and c.last_d + (c.med_gap * 1.6)::integer >= public.user_today()
  order by c.last_amount desc;
$$;

-- ---------------------------------------------------------------------------
-- 9. Views
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
  t.split_group_id
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
-- 10. Row level security and privileges
-- ---------------------------------------------------------------------------
alter table public.ingest_keys          enable row level security;
alter table public.bank_messages        enable row level security;
alter table public.account_aliases      enable row level security;
alter table public.categorisation_rules enable row level security;

drop policy if exists ingest_keys_select on public.ingest_keys;
create policy ingest_keys_select on public.ingest_keys
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists bank_messages_select on public.bank_messages;
drop policy if exists bank_messages_delete on public.bank_messages;
create policy bank_messages_select on public.bank_messages
  for select to authenticated using (user_id = (select auth.uid()));
create policy bank_messages_delete on public.bank_messages
  for delete to authenticated using (user_id = (select auth.uid()));

do $$
declare
  tbl text;
begin
  foreach tbl in array array['account_aliases', 'categorisation_rules'] loop
    execute format('drop policy if exists %I on public.%I', tbl || '_select', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_insert', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_update', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_delete', tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      tbl || '_select', tbl);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
      tbl || '_insert', tbl);
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      tbl || '_update', tbl);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',
      tbl || '_delete', tbl);
  end loop;
end;
$$;

revoke all on public.ingest_keys, public.bank_messages, public.account_aliases, public.categorisation_rules
  from anon, authenticated;
grant select on public.ingest_keys to authenticated;
grant select, delete on public.bank_messages to authenticated;
grant select, insert, delete on public.account_aliases to authenticated;
grant select, insert, delete on public.categorisation_rules to authenticated;
grant update (pattern, kind, category_id, subcategory_id) on public.categorisation_rules to authenticated;

grant update (cycle_start_day) on public.app_settings to authenticated;
-- Marking a transaction reviewed is an ordinary edit; source and references
-- are written only by the server.
grant update (needs_review) on public.transactions to authenticated;

-- Internal machinery: callable by nobody from outside.
revoke execute on function
  public.seed_default_rules(uuid),
  public.process_bank_message(uuid),
  public.ingest_bank_sms(text, text, text, timestamptz, jsonb),
  public.match_account(uuid, text, text, text),
  public.merchant_for(uuid, text),
  public.suggest_category(uuid, public.category_kind, text, uuid),
  public.category_by_name(uuid, public.category_kind, text, uuid)
from public, anon, authenticated;

-- Only the Edge Function (service role) may ingest.
grant execute on function public.ingest_bank_sms(text, text, text, timestamptz, jsonb) to service_role;

grant execute on function
  public.regex_escape(text),
  public.text_has_words(text, text),
  public.register_ingest_key(text),
  public.revoke_ingest_keys(),
  public.bank_sync_status(),
  public.assign_bank_message(uuid, uuid, boolean),
  public.settle_bank_message_externally(uuid),
  public.dismiss_bank_message(uuid),
  public.retry_bank_messages(),
  public.review_transaction(uuid, uuid, uuid, boolean),
  public.mark_transactions_reviewed(uuid[]),
  public.split_transaction(uuid, jsonb),
  public.detect_recurring_payments()
to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Existing users get the built-in merchant rules now
-- ---------------------------------------------------------------------------
do $$
declare
  u uuid;
begin
  for u in select s.user_id from public.app_settings s where not s.default_rules_seeded loop
    perform public.seed_default_rules(u);
  end loop;
end;
$$;
