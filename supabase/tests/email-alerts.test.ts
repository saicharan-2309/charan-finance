/**
 * Bank alerts by text AND email — the same payment must be counted once.
 * Messages go through the same parser + email reader the Edge Function uses,
 * then `ingest_bank_message` as the service role, exactly as in production.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { bankEmailSender, emailToAlert } from '../functions/_shared/bank-email';
import { parseBankSms } from '../functions/_shared/bank-sms';
import { asUser, createTestDb, createUser, expectError, type TestDb } from './helpers';

let db: TestDb;
let uid: string;
let card: string;
const KEY_HASH = createHash('sha256').update('email-test-key-0123456789abcdef0123456789').digest('hex');

async function send(channel: 'sms' | 'email', sender: string, body: string, at: string) {
  const parsed = parseBankSms({ body, sender, receivedAt: at });
  const c = db.admin;
  await c.query('begin');
  try {
    await c.query('set local role service_role');
    const { rows } = await c.query<{ r: Record<string, string> }>(
      `select ingest_bank_message($1, $2, $3, $4, $5, $6::jsonb, false) as r`,
      [KEY_HASH, channel, sender, body, at, JSON.stringify(parsed)],
    );
    await c.query('commit');
    return rows[0]!.r;
  } catch (err) {
    await c.query('rollback');
    throw err;
  }
}

const axisSms = (amount: number, time: string, merchant = 'Blinkit') =>
  `Spent INR ${amount}\nAxis Bank Card no. XX1205\n08-10-26 ${time} IST\n${merchant}\nAvl Limit: INR 396186\nNot you? SMS BLOCK 1205 to 919951860002`;
const axisEmail = (amount: number, time: string, merchant = 'BLINKIT') =>
  emailToAlert(
    'Transaction alert on Axis Bank Credit Card no. XX1205',
    `Dear Customer,\nHere's the summary of your Axis Bank Credit Card Transaction:\nTransaction Amount: INR ${amount}\nMerchant Name: ${merchant}\nAxis Bank Credit Card No. XX1205\nDate & Time: 08-10-2026, ${time} IST\nAvailable Limit*: INR 396186\nDisclaimer: system generated.`,
  );
const EMAIL_SENDER = bankEmailSender('Axis Bank Alerts <alerts@axisbank.com>')!;

async function expenses(): Promise<{ n: number; total: number }> {
  const rows = await asUser(db, uid, (q) =>
    q<{ n: number; total: string }>(
      `select count(*)::int as n, coalesce(sum(amount), 0)::text as total from transactions where type = 'expense'`,
    ),
  );
  return { n: rows[0]!.n, total: Number(rows[0]!.total) };
}
async function cardOwed(): Promise<number> {
  const rows = await asUser(db, uid, (q) =>
    q<{ b: string }>(`select current_balance::text as b from accounts where id = $1`, [card]),
  );
  return -Number(rows[0]!.b);
}

before(async () => {
  db = await createTestDb();
  uid = await createUser(db, 'email@example.com');
  await asUser(db, uid, async (q) => {
    const rows = await q<{ id: string }>(
      `insert into accounts (name, type, last4, provider, opening_balance, credit_limit)
       values ('Axis credit card', 'credit_card', '1205', 'axis', 0, 400000) returning id`,
    );
    card = rows[0]!.id;
    await q(`select register_ingest_key($1)`, [KEY_HASH]);
  });
});

after(async () => {
  await db?.close();
});

describe('one payment, two alerts', () => {
  it('text first, then the email: counted once, the email is linked as a duplicate', async () => {
    const a = await send('sms', 'JK-AXISBK-S', axisSms(2285, '17:09:11'), '2026-10-08T11:39:11Z');
    assert.equal(a.status, 'created');
    const b = await send('email', EMAIL_SENDER, axisEmail(2285, '17:09:11'), '2026-10-08T11:40:02Z');
    assert.equal(b.status, 'duplicate');
    assert.equal(b.summary, 'Already recorded from your text message');
    assert.deepEqual(await expenses(), { n: 1, total: 2285 });
    assert.equal(await cardOwed(), 2285);
    const link = await asUser(db, uid, (q) =>
      q<{ channel: string; status: string; same_txn: boolean }>(
        `select d.channel, d.status, d.transaction_id = o.transaction_id as same_txn
         from bank_messages d join bank_messages o on o.id = d.duplicate_of where d.id = $1`,
        [b.message_id],
      ),
    );
    assert.deepEqual(link, [{ channel: 'email', status: 'duplicate', same_txn: true }]);
  });

  it('email first, then the text: also counted once', async () => {
    const a = await send('email', EMAIL_SENDER, axisEmail(640, '19:00:00', 'SWIGGY'), '2026-10-08T13:30:00Z');
    assert.equal(a.status, 'created');
    const b = await send('sms', 'JK-AXISBK-S', axisSms(640, '19:00:00', 'Swiggy'), '2026-10-08T13:31:00Z');
    assert.equal(b.status, 'duplicate');
    assert.equal(b.summary, 'Already recorded from your email');
    assert.deepEqual(await expenses(), { n: 2, total: 2925 });
  });

  it('two genuine identical payments, each by text and email: both count, once each', async () => {
    await send('sms', 'JK-AXISBK-S', axisSms(50, '20:00:01', 'Cafe'), '2026-10-08T14:30:01Z');
    await send('sms', 'JK-AXISBK-S', axisSms(50, '20:05:44', 'Cafe'), '2026-10-08T14:35:44Z');
    const e1 = await send('email', EMAIL_SENDER, axisEmail(50, '20:00:01', 'CAFE'), '2026-10-08T14:31:00Z');
    const e2 = await send('email', EMAIL_SENDER, axisEmail(50, '20:05:44', 'CAFE'), '2026-10-08T14:36:30Z');
    assert.equal(e1.status, 'duplicate');
    assert.equal(e2.status, 'duplicate');
    assert.notEqual(e1.duplicate_of, e2.duplicate_of);
    assert.deepEqual(await expenses(), { n: 4, total: 3025 });
  });

  it('a different amount is a different payment', async () => {
    await send('sms', 'JK-AXISBK-S', axisSms(300, '21:00:00', 'Uber'), '2026-10-08T15:30:00Z');
    const e = await send('email', EMAIL_SENDER, axisEmail(310, '21:00:00', 'UBER'), '2026-10-08T15:31:00Z');
    assert.equal(e.status, 'created');
    assert.deepEqual(await expenses(), { n: 6, total: 3635 });
  });

  it('the same email delivered twice is still only a duplicate', async () => {
    const body = axisEmail(2285, '17:09:11');
    const again = await send('email', EMAIL_SENDER, body, '2026-10-08T11:40:02Z');
    assert.equal(again.status, 'duplicate');
    assert.deepEqual(await expenses(), { n: 6, total: 3635 });
  });
});

describe('status and access', () => {
  it('records when each channel last delivered, and the Gmail heartbeat', async () => {
    const c = db.admin;
    await c.query('begin');
    await c.query('set local role service_role');
    const { rows } = await c.query<{ ok: boolean }>(`select touch_email_check($1) as ok`, [KEY_HASH]);
    await c.query('commit');
    assert.equal(rows[0]!.ok, true);
    const s = await asUser(db, uid, (q) =>
      q<{ s: Record<string, string | null> }>(`select bank_sync_status() as s`),
    );
    assert.ok(s[0]!.s.last_sms_at);
    assert.ok(s[0]!.s.last_email_at);
    assert.ok(s[0]!.s.email_checked_at);
  });

  it('only the server can deliver messages', async () => {
    await expectError(
      asUser(db, uid, (q) =>
        q(`select ingest_bank_message($1, 'email', 'EM-AXISBK', 'x', now(), '{}', false)`, [KEY_HASH]),
      ),
      /permission denied/,
    );
    await expectError(
      asUser(db, uid, (q) => q(`select touch_email_check($1)`, [KEY_HASH])),
      /permission denied/,
    );
  });
});
