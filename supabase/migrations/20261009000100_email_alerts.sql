-- =============================================================================
-- Bank alert emails, alongside SMS — and only one of the two is ever counted
-- =============================================================================
-- Banks send most alerts twice: a text and an email. BUD can now take both
-- routes (iPhone Shortcut for texts, a Google Apps Script in the user's own
-- Gmail for emails), so the same payment can arrive twice in different
-- words. The rule: the first to arrive is recorded; the other is kept only
-- as a "duplicate" of it, linked to the same transaction, and never counted.
--
-- Two messages are the same payment when they come by DIFFERENT channels and
-- agree on direction, amount, card/account digits and bank, within 3 hours
-- of each other — and the earlier one hasn't already been matched. Two
-- genuine identical payments (two ₹50 coffees) each arrive once per channel,
-- so each pair is matched one-to-one and both payments still count.
--
-- * bank_messages.channel ('sms' | 'email'), bank_messages.duplicate_of
-- * ingest_keys.last_sms_at / last_email_at / email_checked_at for the status
-- * ingest_bank_message(): the entry point for both channels (wraps the
--   existing ingest_bank_sms, which is unchanged)
-- * touch_email_check(): the Gmail script's "I'm running" heartbeat
-- * bank_sync_status(): also returns the per-channel times
--
-- Additive and safe to re-run.
-- =============================================================================

alter table public.bank_messages
  add column if not exists channel text not null default 'sms',
  add column if not exists duplicate_of uuid references public.bank_messages (id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bank_messages_channel_check') then
    alter table public.bank_messages
      add constraint bank_messages_channel_check check (channel in ('sms', 'email'));
  end if;
end $$;
create index if not exists bank_messages_match_idx
  on public.bank_messages (user_id, amount, received_at) where status not in ('ignored', 'dismissed', 'duplicate');
create index if not exists bank_messages_duplicate_of_idx on public.bank_messages (duplicate_of) where duplicate_of is not null;

alter table public.ingest_keys
  add column if not exists last_sms_at timestamptz,
  add column if not exists last_email_at timestamptz,
  add column if not exists email_checked_at timestamptz;

create or replace function public.ingest_bank_message(
  p_key_hash    text,
  p_channel     text,
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
  k         public.ingest_keys;
  received  timestamptz := least(coalesce(p_received_at, now()), now() + interval '5 minutes');
  tz        text;
  twin      public.bank_messages;
  result    jsonb;
  mid       uuid;
begin
  if p_channel not in ('sms', 'email') then
    raise exception 'CF812: Unknown channel';
  end if;
  select * into k from public.ingest_keys where key_hash = lower(p_key_hash) and revoked_at is null;
  if not found then
    raise exception 'CF810: Unknown or revoked sync key';
  end if;

  -- One message at a time per user, so a text and an email arriving in the
  -- same second can't both be counted.
  perform pg_advisory_xact_lock(hashtextextended('ingest:' || k.user_id::text, 0));

  if p_channel = 'sms' then
    update public.ingest_keys set last_sms_at = now() where id = k.id;
  else
    update public.ingest_keys set last_email_at = now(), email_checked_at = now() where id = k.id;
  end if;

  -- The same payment already arrived by the other channel?
  if p_parsed ->> 'kind' = 'transaction'
     and p_parsed ->> 'amount' ~ '^[0-9]+(\.[0-9]{1,2})?$'
     and public.is_bank_sender(p_sender) then
    select b.* into twin
    from public.bank_messages b
    where b.user_id = k.user_id
      and b.channel <> p_channel
      and b.status not in ('ignored', 'dismissed', 'duplicate')
      and b.direction = p_parsed ->> 'direction'
      and b.amount = (p_parsed ->> 'amount')::numeric
      and (b.last4 is null or p_parsed ->> 'last4' is null or b.last4 = p_parsed ->> 'last4')
      and (b.bank is null or p_parsed ->> 'bank' is null or b.bank = p_parsed ->> 'bank')
      and b.received_at between received - interval '3 hours' and received + interval '3 hours'
      and not exists (select 1 from public.bank_messages d where d.duplicate_of = b.id)
    order by abs(extract(epoch from (b.received_at - received)))
    limit 1;

    if found then
      tz := coalesce((select pr.timezone from public.profiles pr where pr.id = k.user_id), 'Asia/Kolkata');
      update public.ingest_keys set last_used_at = now() where id = k.id;
      insert into public.bank_messages (user_id, sender, body, body_hash, received_at, parsed, status,
                                        direction, amount, reference, last4, bank, account_id,
                                        transaction_id, note, processed_at, channel, duplicate_of)
      values (k.user_id, left(p_sender, 64), left(btrim(p_body), 2000),
              md5(btrim(p_body) || '|' || ((received at time zone tz)::date)::text),
              received, coalesce(p_parsed, '{}'), 'duplicate',
              p_parsed ->> 'direction', (p_parsed ->> 'amount')::numeric, nullif(p_parsed ->> 'reference', ''),
              p_parsed ->> 'last4', p_parsed ->> 'bank', twin.account_id, twin.transaction_id,
              'Same payment as the ' || (case when twin.channel = 'sms' then 'text' else 'email' end)
                || ' received ' || to_char(twin.received_at at time zone tz, 'DD Mon HH24:MI'),
              now(), p_channel, twin.id)
      on conflict (user_id, body_hash) do nothing
      returning id into mid;
      return jsonb_build_object(
        'status', 'duplicate',
        'summary', 'Already recorded from your ' || (case when twin.channel = 'sms' then 'text message' else 'email' end),
        'message_id', mid,
        'duplicate_of', twin.id);
    end if;
  end if;

  result := public.ingest_bank_sms(p_key_hash, p_sender, p_body, received, p_parsed, p_backfill);
  if result ? 'message_id' and result ->> 'message_id' is not null then
    update public.bank_messages set channel = p_channel
    where id = (result ->> 'message_id')::uuid and user_id = k.user_id;
  end if;
  return result;
end;
$$;
revoke all on function public.ingest_bank_message(text, text, text, text, timestamptz, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.ingest_bank_message(text, text, text, text, timestamptz, jsonb, boolean)
  to service_role;

-- The Gmail script calls this every run, so the app can show it's connected
-- even when no bank email has arrived.
create or replace function public.touch_email_check(p_key_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ingest_keys set email_checked_at = now()
  where key_hash = lower(p_key_hash) and revoked_at is null;
  return found;
end;
$$;
revoke all on function public.touch_email_check(text) from public, anon, authenticated;
grant execute on function public.touch_email_check(text) to service_role;

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
    'last_sms_at', (select max(k.last_sms_at) from public.ingest_keys k where k.user_id = auth.uid()),
    'last_email_at', (select max(k.last_email_at) from public.ingest_keys k where k.user_id = auth.uid()),
    'email_checked_at', (select max(k.email_checked_at) from public.ingest_keys k
                         where k.user_id = auth.uid() and k.revoked_at is null),
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
