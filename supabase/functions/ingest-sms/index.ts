// Supabase Edge Function: ingest-sms
// -----------------------------------------------------------------------------
// Receives bank SMS forwarded by the iPhone Shortcut and records them.
//
// Request (POST, JSON):
//   headers: x-sync-key: <the key shown in the app>
//   body:    { "text": "<SMS body>", "sender": "<sender id>", "received_at": "<ISO, optional>" }
//   or       { "test": true }   — checks the key and connection, records nothing
//
// Response: { status, summary, message_id? } — `summary` is a short line the
// Shortcut can show as a notification ("Spent ₹450.00 · Swiggy").
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

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
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
    return json(200, { status: 'ok', summary: 'Connected to Charan Finance' });
  }

  const body = asText(payload.text) ?? asText(payload.body) ?? asText(payload.message);
  if (!body || !body.trim()) return json(400, { status: 'error', summary: 'No message text' });
  if (body.length > MAX_BODY) return json(413, { status: 'error', summary: 'Message too long' });

  const sender = (asText(payload.sender) ?? '').slice(0, 64) || null;
  const receivedRaw = asText(payload.received_at);
  const receivedAt =
    receivedRaw && !Number.isNaN(Date.parse(receivedRaw)) ? new Date(receivedRaw).toISOString() : new Date().toISOString();

  const parsed = parseBankSms({ body, sender, receivedAt });

  const { data, error } = await supabase.rpc('ingest_bank_sms', {
    p_key_hash: keyHash,
    p_sender: sender,
    p_body: body,
    p_received_at: receivedAt,
    p_parsed: parsed,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('CF810')) return json(401, { status: 'error', summary: 'Sync key not recognised' });
    if (msg.includes('CF811')) return json(429, { status: 'error', summary: 'Too many messages — try later' });
    console.error('ingest_failed', error.code);
    return json(500, { status: 'error', summary: 'Could not record this message' });
  }

  const result = (data ?? {}) as Record<string, unknown>;
  return json(200, {
    status: result.status ?? 'ok',
    summary: (result.summary as string | undefined) ?? describeParsed(parsed),
    message_id: result.message_id ?? null,
  });
});
