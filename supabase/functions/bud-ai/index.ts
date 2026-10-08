// Supabase Edge Function: bud-ai
// -----------------------------------------------------------------------------
// BUD AI — answers questions about the user's own money and prepares changes
// for them to confirm.
//
// Request (POST, JSON, with the user's Supabase session — JWT verification ON):
//   { "messages": [{ "role": "user" | "assistant", "content": "…" }, …] }
//   The last message is the new question. Up to 20 messages are kept.
//
// Response:
//   { reply: "You spent ₹8,420 on Food last month.",
//     actions: [ProposedAction…],        // changes waiting for Confirm
//     sources: ["Spending by category, 1 Sep – 30 Sep"] }
//
// Safety
//   * The model can only call the tools in _shared/bud-ai.ts. Reads go through
//     fixed database functions, made with the *user's* token, so row-level
//     security limits them to the user's own data. There is no SQL from the
//     model, and no service-role key here.
//   * The model cannot change anything. A change comes back as a proposal; the
//     app performs it through its existing functions after the user confirms.
//   * At most 150 questions a day per user (ai_take_quota), 6 tool rounds per
//     question, and capped message sizes, so the AI bill stays bounded.
//   * The Anthropic key lives only in this function's secrets
//     (ANTHROPIC_API_KEY); it never reaches the app.
//   * Privacy: the question and the figures the tools return are sent to
//     Anthropic's API to write the answer. The app says so on the BUD AI screen.
// -----------------------------------------------------------------------------
import { createClient } from 'jsr:@supabase/supabase-js@2';

import {
  ALLOWED_RPCS,
  type AccountLite,
  type AllowedRpc,
  type CategoryLite,
  type FriendLite,
  type ProposedAction,
  runTool,
  systemPrompt,
  todayIn,
  TOOLS,
  type ToolContext,
} from '../_shared/bud-ai.ts';

const MODEL = Deno.env.get('BUD_AI_MODEL') ?? 'claude-sonnet-5-5';
const MAX_ROUNDS = 6;
const MAX_MESSAGES = 20;
const MAX_CHARS = 2000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type Msg = { role: 'user' | 'assistant'; content: string | Block[] };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Use POST' });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return json(503, {
      code: 'not_configured',
      error: 'BUD AI isn’t set up on the server yet: add the ANTHROPIC_API_KEY secret to Supabase.',
    });
  }

  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { error: 'Sign in to use BUD AI' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  // Every database call below runs as the signed-in user (row-level security).
  const db = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  if (userError || !userData.user) return json(401, { error: 'Sign in to use BUD AI' });
  const me = userData.user.id;

  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Body must be JSON' });
  }
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        !!m &&
        typeof m === 'object' &&
        ((m as Msg).role === 'user' || (m as Msg).role === 'assistant') &&
        typeof (m as Msg).content === 'string' &&
        !!((m as Msg).content as string).trim(),
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  // The conversation must start with the user and end with the new question.
  while (history.length && history[0]!.role !== 'user') history.shift();
  if (!history.length || history[history.length - 1]!.role !== 'user') {
    return json(400, { error: 'Ask a question' });
  }

  const quota = await db.rpc('ai_take_quota');
  if (quota.error) {
    const msg = quota.error.message ?? '';
    return json(msg.includes('CF901') ? 429 : 500, {
      error: msg.includes('CF901') ? msg.replace(/^CF901:\s*/, '') : 'Could not start BUD AI',
    });
  }

  const [profile, settings] = await Promise.all([
    db.from('profiles').select('display_name, timezone').eq('id', me).maybeSingle(),
    db.from('app_settings').select('cycle_start_day').eq('user_id', me).maybeSingle(),
  ]);
  const timeZone = (profile.data?.timezone as string | null) ?? 'Asia/Kolkata';
  const cycleStartDay = Number(settings.data?.cycle_start_day ?? 1);
  const today = todayIn(timeZone);

  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>) => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key) as Promise<T>;
  };
  const ctx: ToolContext = {
    today,
    timeZone,
    me,
    rpc: async (fn: AllowedRpc, args?: Record<string, unknown>) => {
      if (!(ALLOWED_RPCS as readonly string[]).includes(fn)) throw new Error('not allowed');
      const { data, error } = await db.rpc(fn, args ?? {});
      if (error) throw new Error(error.message);
      return data;
    },
    accounts: () =>
      once('accounts', async () => {
        const { data, error } = await db
          .from('accounts')
          .select('id, name, type, current_balance, credit_limit, is_active, system_kind')
          .order('created_at');
        if (error) throw new Error(error.message);
        return (data ?? []).map((a): AccountLite => ({
          id: a.id,
          name: a.name,
          type: a.type,
          currentBalance: String(a.current_balance),
          creditLimit: a.credit_limit === null ? null : String(a.credit_limit),
          isActive: a.is_active,
          systemKind: a.system_kind ?? null,
        }));
      }),
    categories: () =>
      once('categories', async () => {
        const { data, error } = await db
          .from('transaction_categories')
          .select('id, name, kind, parent_id')
          .order('sort_order');
        if (error) throw new Error(error.message);
        return (data ?? []).map((c): CategoryLite => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          parentId: c.parent_id,
        }));
      }),
    friends: () =>
      once('friends', async () => {
        const { data, error } = await db.rpc('ai_friends');
        if (error) throw new Error(error.message);
        return ((data ?? []) as Record<string, unknown>[]).map((f): FriendLite => ({
          userId: String(f.user_id),
          name: String(f.name),
          username: (f.username as string | null) ?? null,
          net: String(f.net ?? 0),
        }));
      }),
  };

  const messages: Msg[] = history.map((m) => ({ role: m.role, content: m.content }));
  const actions: ProposedAction[] = [];
  const sources: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt(
          today,
          timeZone,
          cycleStartDay,
          (profile.data?.display_name as string | null) ?? null,
        ),
        tools: TOOLS,
        messages,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('anthropic_error', res.status, detail.slice(0, 300));
      return json(502, {
        error:
          res.status === 401
            ? 'BUD AI’s API key was rejected — check the ANTHROPIC_API_KEY secret.'
            : res.status === 429
              ? 'BUD AI is busy right now — try again in a minute.'
              : 'BUD AI couldn’t answer just now — try again.',
      });
    }
    const out = (await res.json()) as { content: Block[]; stop_reason: string };
    messages.push({ role: 'assistant', content: out.content });

    const uses = out.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (out.stop_reason !== 'tool_use' || uses.length === 0) {
      const reply = out.content
        .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return json(200, { reply: reply || 'I couldn’t find an answer to that.', actions, sources });
    }

    const results: Block[] = [];
    for (const use of uses) {
      try {
        const outcome = await runTool(use.name, use.input ?? {}, ctx);
        if (outcome.action) actions.push(outcome.action);
        if (!sources.includes(outcome.label)) sources.push(outcome.label);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(outcome.result) });
      } catch (e) {
        console.error('tool_failed', use.name, e instanceof Error ? e.message : e);
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify({ error: 'that lookup failed — tell the user and do not guess' }),
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return json(200, {
    reply: 'That needed more steps than I can take at once — try asking a narrower question.',
    actions,
    sources,
  });
});
