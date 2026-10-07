// Supabase Edge Function: ingest-sms
// -----------------------------------------------------------------------------
// Receives bank SMS forwarded by the iPhone Shortcut and records them.
//
// Request (POST, JSON):
//   headers: x-sync-key: <the key shown in the app>
//   body:    { "text": "<SMS body>", "sender": "<sender id>", "received_at": "<ISO, optional>" }
//   or       { "test": true }   — checks the key and connection, records nothing
//   or       { "messages": [{ text, sender, received_at }, …], "backfill": true }
//            — past messages imported from an iPhone backup (up to 200 a call,
//            oldest first). History has a daily rather than hourly limit and
//            is not queued for review one by one.
//
// Response: { status, summary, message_id? } — `summary` is a short line the
// Shortcut can show as a notification ("Spent ₹450.00 · Swiggy").
// Batch response: { status: 'ok', counts: { created: 12, duplicate: 3, … } }
//
// Security
//   * JWT verification is OFF for this function (a Shortcut has no Supabase
//     session). Instead every request must carry the user's sync key. Only its
//     SHA-256 hash is stored; the database maps it to exactly one user and
//     refuses revoked keys.
//   * The service-role key is used here, server-side only, to call the one
//     function that is granted to it (`ingest_bank_sms`). It is never sent to
//     or stored in the app.
//   * Message bodies are capped at 2,000 characters; the database rate-limits
//     each user to 300 messages an hour.
//   * Non-financial texts are filtered on the phone by the Shortcut, and again
//     here: OTPs and chat are parsed as "ignored" and nothing is created.
// -----------------------------------------------------------------------------
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { describeParsed, parseBankSms } from '../_shared/bank-sms.ts';

const MAX_BODY = 2000;
const MAX_BATCH = 200;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  // Shortcuts sometimes sends a single-item list for "Shortcut Input".
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { status: 'error', summary: 'Use POST' });

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json(400, { status: 'error', summary: 'Body must be JSON' });
  }

  const key = (req.headers.get('x-sync-key') ?? asText(payload.key) ?? '').trim();
  if (key.length < 24 || key.length > 200) {
    return json(401, { status: 'error', summary: 'Missing or invalid sync key' });
  }
  const keyHash = await sha256Hex(key);

  // Injected by Supabase into every Edge Function. A project that has moved to
  // the newer secret keys can set INGEST_SERVICE_KEY to an sb_secret_… key.
  const serviceKey = Deno.env.get('INGEST_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const url = Deno.env.get('SUPABASE_URL');
  if (!serviceKey || !url) {
    console.error('ingest_not_configured');
    return json(500, { status: 'error', summary: 'Bank sync is not configured on the server' });
  }
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (payload.test === true) {
    const { data, error } = await supabase
      .from('ingest_keys')
      .select('id')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) return json(500, { status: 'error', summary: 'Server error' });
    if (!data) return json(401, { status: 'error', summary: 'Sync key not recognised' });
    return json(200, { status: 'ok', summary: 'Connected to BUD' });
  }

  const rpc: Rpc = async (args) => {
    const { data, error } = await supabase.rpc('ingest_bank_sms', args);
    return { data, error: error ? { message: error.message, code: error.code } : null };
  };

  if (Array.isArray(payload.messages)) {
    const items = payload.messages as Record<string, unknown>[];
    if (items.length > MAX_BATCH) {
      return json(413, { status: 'error', summary: `Send at most ${MAX_BATCH} messages at a time` });
    }
    const counts: Record<string, number> = {};
    for (const item of items) {
      const outcome = await ingestOne(rpc, keyHash, item ?? {}, payload.backfill === true);
      if (outcome.fatal) return outcome.fatal;
      counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
    }
    return json(200, { status: 'ok', counts });
  }

  const outcome = await ingestOne(rpc, keyHash, payload, false);
  if (outcome.fatal) return outcome.fatal;
  return json(200, {
    status: outcome.status,
    summary: outcome.summary,
    message_id: outcome.messageId,
  });
});

type Rpc = (
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

interface Outcome {
  status: string;
  summary?: string;
  messageId?: unknown;
  /** Stop the whole request (bad key, rate limit). */
  fatal?: Response;
}

async function ingestOne(
  rpc: Rpc,
  keyHash: string,
  item: Record<string, unknown>,
  backfill: boolean,
): Promise<Outcome> {
  const body = asText(item.text) ?? asText(item.body) ?? asText(item.message);
  if (!body || !body.trim()) {
    return backfill
      ? { status: 'skipped' }
      : { status: 'error', fatal: json(400, { status: 'error', summary: 'No message text' }) };
  }
  if (body.length > MAX_BODY) {
    return backfill
      ? { status: 'skipped' }
      : { status: 'error', fatal: json(413, { status: 'error', summary: 'Message too long' }) };
  }

  const sender = (asText(item.sender) ?? '').slice(0, 64) || null;
  const receivedRaw = asText(item.received_at);
  const receivedAt =
    receivedRaw && !Number.isNaN(Date.parse(receivedRaw))
      ? new Date(receivedRaw).toISOString()
      : new Date().toISOString();

  const parsed = parseBankSms({ body, sender, receivedAt });

  const { data, error } = await rpc({
    p_key_hash: keyHash,
    p_sender: sender,
    p_body: body,
    p_received_at: receivedAt,
    p_parsed: parsed,
    p_backfill: backfill,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('CF810')) {
      return { status: 'error', fatal: json(401, { status: 'error', summary: 'Sync key not recognised' }) };
    }
    if (msg.includes('CF811')) {
      return {
        status: 'error',
        fatal: json(429, { status: 'error', summary: 'Too many messages — try later' }),
      };
    }
    console.error('ingest_failed', error.code);
    if (backfill) return { status: 'failed' };
    return {
      status: 'error',
      fatal: json(500, { status: 'error', summary: 'Could not record this message' }),
    };
  }

  const result = (data ?? {}) as Record<string, unknown>;
  const status = String(result.status ?? 'ok');
  return {
    status,
    summary:
      notificationText(status, parsed) ?? (result.summary as string | undefined) ?? describeParsed(parsed),
    messageId: result.message_id ?? null,
  };
}

/** The line the Shortcut can show a second after a payment, in Indian number format. */
function notificationText(status: string, p: ReturnType<typeof parseBankSms>): string | null {
  if (p.kind !== 'transaction') return null;
  const amount = `₹${new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: p.amount.endsWith('.00') ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number(p.amount))}`;
  const who = p.merchant ? ` · ${p.merchant}` : '';
  switch (status) {
    case 'created':
      return p.isCashWithdrawal
        ? `Cash withdrawn ${amount}`
        : `${p.direction === 'debit' ? 'Spent' : 'Received'} ${amount}${who}`;
    case 'linked':
      return `Matched ${amount} to your entry${who}`;
    case 'paired':
      return p.isCardBillPayment || p.isCardPaymentReceived
        ? `Card bill paid ${amount}`
        : `Moved ${amount} between your accounts`;
    case 'duplicate':
      return `Already recorded ${amount}`;
    case 'needs_account':
      return `${amount}${who} — open the app to pick the account`;
    case 'awaiting_pair':
      return `Card payment ${amount} — open the app to match it`;
    default:
      return null;
  }
}
