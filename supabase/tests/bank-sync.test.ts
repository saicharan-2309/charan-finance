/**
 * End-to-end tests for automatic bank sync: real bank SMS text goes through the
 * same parser the Edge Function uses, then through `ingest_bank_sms` exactly as
 * the service role calls it. Checks what lands in the ledger — and, as
 * importantly, what doesn't (duplicates, OTPs, transfers counted as spending).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { parseBankSms } from '../functions/_shared/bank-sms';
import { asUser, createTestDb, createUser, expectError, type TestDb } from './helpers';

let db: TestDb;
let uid: string;
let other: string;
const KEY = 'test-sync-key-0123456789abcdef0123456789abcdef';
const KEY_HASH = createHash('sha256').update(KEY).digest('hex');

const acc: Record<string, string> = {};
let clock = Date.parse('2026-10-03T04:00:00Z');

/** Sends one SMS the way the Edge Function does. */
async function sms(body: string, sender = 'AX-HDFCBK', key = KEY_HASH): Promise<Record<string, string>> {
  clock += 60_000;
  const receivedAt = new Date(clock).toISOString();
  const parsed = parseBankSms({ body, sender, receivedAt });
  const c = db.admin;
  await c.query('begin');
  try {
    await c.query('set local role service_role');
    const { rows } = await c.query<{ r: Record<string, string> }>(
      `select ingest_bank_sms($1, $2, $3, $4, $5::jsonb) as r`,
      [key, sender, body, receivedAt, JSON.stringify(parsed)],
    );
    await c.query('commit');
    return rows[0].r;
  } catch (err) {
    await c.query('rollback');
    throw err;
  }
}

async function one<T extends object>(sql: string, params: unknown[] = []): Promise<T> {
  const rows = await asUser(db, uid, (q) => q<T>(sql, params));
  assert.equal(rows.length, 1, `expected one row for: ${sql}`);
  return rows[0];
}

async function balance(name: string): Promise<number> {
  const r = await one<{ b: string }>(`select current_balance::text as b from accounts where name = $1`, [name]);
  return Number(r.b);
}

async function expenseCount(): Promise<number> {
  const r = await one<{ n: number }>(`select count(*)::int as n from transactions where type = 'expense'`);
  return r.n;
}

before(async () => {
  db = await createTestDb();
  uid = await createUser(db, 'sync@example.com');
  other = await createUser(db, 'other@example.com');
  await asUser(db, uid, async (q) => {
    for (const [name, type, last4, provider, opening, limit] of [
      ['HDFC Savings', 'savings', '1234', 'hdfc', '100000', null],
      ['HDFC Card', 'credit_card', '5678', 'hdfc', '0', '200000'],
      ['SBI Salary', 'savings', '5566', 'sbi', '50000', null],
    ] as const) {
      const rows = await q<{ id: string }>(
        `insert into accounts (name, type, last4, provider, opening_balance, credit_limit)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [name, type, last4, provider, opening, limit],
      );
      acc[name] = rows[0].id;
    }
    await q(`select register_ingest_key($1)`, [KEY_HASH]);
  });
});

after(async () => {
  await db?.close();
});

describe('bank sync — access', () => {
  it('lets only the service role ingest', async () => {
    await expectError(
      asUser(db, uid, (q) => q(`select ingest_bank_sms($1, 'x', 'y', now(), '{}')`, [KEY_HASH])),
      /permission denied/,
    );
    await expectError(
      asUser(db, null, (q) => q(`select ingest_bank_sms($1, 'x', 'y', now(), '{}')`, [KEY_HASH])),
      /permission denied/,
    );
  });

  it('rejects an unknown key', async () => {
    await expectError(sms('Sent Rs.1.00 From HDFC Bank A/C *1234 To X', 'AX-HDFCBK', 'f'.repeat(64)), /CF810/);
  });

  it('seeds the built-in merchant rules when sync is switched on', async () => {
    const r = await one<{ n: number }>(`select count(*)::int as n from categorisation_rules`);
    assert.ok(r.n > 150, `expected the default rules, got ${r.n}`);
  });
});

describe('bank sync — spending', () => {
  it('records a UPI debit as an auto-categorised expense awaiting review', async () => {
    const r = await sms(
      'Sent Rs.450.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 03/10/26\nRef 627612345678\nNot You?\nCall 18002586161',
    );
    assert.equal(r.status, 'created');
    const t = await one<{
      type: string; amount: string; account_name: string; category_name: string;
      subcategory_name: string; merchant_name: string; needs_review: boolean; source: string; external_ref: string;
    }>(`select * from transactions_view where id = $1`, [r.transaction_id]);
    assert.equal(t.type, 'expense');
    assert.equal(Number(t.amount), 450);
    assert.equal(t.account_name, 'HDFC Savings');
    assert.equal(t.category_name, 'Food');
    assert.equal(t.subcategory_name, 'Food Delivery');
    assert.equal(t.merchant_name, 'Swiggy');
    assert.equal(t.needs_review, true);
    assert.equal(t.source, 'sms');
    assert.equal(t.external_ref, '627612345678');
    assert.equal(await balance('HDFC Savings'), 99550);
  });

  it('ignores the same SMS delivered twice', async () => {
    const before = await expenseCount();
    const r = await sms(
      'Sent Rs.450.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 03/10/26\nRef 627612345678\nNot You?\nCall 18002586161',
    );
    assert.equal(r.status, 'duplicate');
    assert.equal(await expenseCount(), before);
    assert.equal(await balance('HDFC Savings'), 99550);
  });

  it('puts a card spend on the card and remembers the bank-reported limit', async () => {
    const r = await sms(
      'Spent Rs.2,499 On HDFC Bank Card 5678 At AMAZON PAY INDIA On 2026-10-03:14:22:10 Avl Lmt Rs.1,97,501.00',
    );
    assert.equal(r.status, 'created');
    const t = await one<{ account_name: string; category_name: string }>(
      `select account_name, category_name from transactions_view where id = $1`,
      [r.transaction_id],
    );
    assert.deepEqual(t, { account_name: 'HDFC Card', category_name: 'Shopping' });
    const a = await one<{ reported_balance: string; reported_balance_kind: string }>(
      `select reported_balance, reported_balance_kind from accounts where name = 'HDFC Card'`,
    );
    assert.equal(Number(a.reported_balance), 197501);
    assert.equal(a.reported_balance_kind, 'limit');
  });

  it('links to an expense the user already typed in instead of duplicating it', async () => {
    await asUser(db, uid, (q) =>
      q(
        `select save_transaction('create', gen_random_uuid(), 'expense', 320, $1, now(),
           null, (select id from transaction_categories where name = 'Groceries'), null, null, 'Corner store')`,
        [acc['HDFC Savings']],
      ),
    );
    const before = await expenseCount();
    const r = await sms('Rs.320.00 debited from HDFC Bank A/c **1234 on 03-10-26 to VPA cornerstore@ybl (UPI Ref No 627800002222)');
    assert.equal(r.status, 'linked');
    assert.equal(await expenseCount(), before);
  });

  it('ignores OTPs, declined payments and future-debit notices', async () => {
    const before = await expenseCount();
    for (const body of [
      '123456 is your OTP for transaction of Rs 2,499 at AMAZON on HDFC Bank card 5678. Do not share',
      'Transaction of Rs.5000 on HDFC Bank card XX5678 has been declined due to insufficient funds',
      'Your e-mandate for NETFLIX of Rs.649.00 will be debited on 05-10-2026 from A/c XX1234. -HDFC Bank',
    ]) {
      assert.equal((await sms(body)).status, 'ignored');
    }
    assert.equal(await expenseCount(), before);
    // Ignored texts are never stored — an OTP must not sit in the database.
    const stored = await one<{ n: number }>(
      `select count(*)::int as n from bank_messages where body ilike '%otp%' or body ilike '%declined%'`,
    );
    assert.equal(stored.n, 0);
  });
});

describe('bank sync — money moving between your own accounts is never spending', () => {
  it('records a transfer when the SMS names your other account, and skips its other half', async () => {
    const before = await expenseCount();
    const hdfc = await balance('HDFC Savings');
    const sbi = await balance('SBI Salary');
    const r = await sms(
      'Your a/c no. XXXXXXXX1234 is debited for Rs.2,000.00 on 03-10-2026 and credited to a/c no. XXXXXXXX5566 (UPI Ref no 627755556666) -HDFC Bank',
    );
    assert.equal(r.status, 'paired');
    const second = await sms(
      'Dear SBI UPI User, ur A/cX5566 credited by Rs2000 on 03Oct26 by  (Ref no 627755556666)',
      'JD-SBIUPI',
    );
    assert.equal(second.status, 'duplicate');
    assert.equal(await expenseCount(), before);
    assert.equal(await balance('HDFC Savings'), hdfc - 2000);
    assert.equal(await balance('SBI Salary'), sbi + 2000);
  });

  it('turns a debit into a transfer when the matching credit arrives on another account', async () => {
    const r1 = await sms(
      'Dear UPI user A/C X5566 debited by 5000.0 on date 03Oct26 trf to CHARAN K Refno 627711119999. -SBI',
      'JD-SBIUPI',
    );
    assert.equal(r1.status, 'created');
    const before = await expenseCount();
    const r2 = await sms(
      'Dear Customer, A/c XX1234 is credited with Rs 5000.00 on 03-Oct-26 from CHARAN K. UPI:627711119999 -HDFC Bank',
    );
    assert.equal(r2.status, 'paired');
    assert.equal(r2.transaction_id, r1.transaction_id);
    assert.equal(await expenseCount(), before - 1);
    const t = await one<{ type: string; account_name: string; to_account_name: string }>(
      `select type, account_name, to_account_name from transactions_view where id = $1`,
      [r1.transaction_id],
    );
    assert.deepEqual(t, { type: 'transfer', account_name: 'SBI Salary', to_account_name: 'HDFC Savings' });
  });

  it('records a CRED bill payment as a card payment, not an expense, with one card', async () => {
    const before = await expenseCount();
    const card = await balance('HDFC Card');
    const r = await sms(
      'Rs.2499 debited from HDFC Bank A/c **1234 on 03-10-26 to VPA cred.club@axisb(UPI Ref No 627800001111).',
    );
    assert.equal(r.status, 'paired');
    const r2 = await sms(
      'Payment of Rs. 2,499.00 has been received on your HDFC Bank Credit Card ending 5678 through UPI on 03-10-2026. Thank you',
    );
    assert.equal(r2.status, 'duplicate');
    assert.equal(await expenseCount(), before);
    assert.equal(await balance('HDFC Card'), card + 2499);
  });

  it('waits for the card side when there are two cards, then pairs them', async () => {
    acc['SBI Card'] = (
      await one<{ id: string }>(
        `insert into accounts (name, type, last4, provider, credit_limit) values ('SBI Card', 'credit_card', '7788', 'sbi', 100000) returning id`,
      )
    ).id;
    await sms('Rs.1,999.00 spent on your SBI Credit Card ending 7788 at MYNTRA on 03/10/26.', 'AD-SBICRD');
    const before = await expenseCount();
    const r = await sms(
      'Rs.1999 debited from HDFC Bank A/c **1234 on 03-10-26 to VPA cred.club@axisb(UPI Ref No 627800003333).',
    );
    assert.equal(r.status, 'awaiting_pair');
    const r2 = await sms(
      'We have received payment of Rs.1,999.00 via BBPS & the same has been credited to your SBI Credit Card.',
      'AD-SBICRD',
    );
    assert.equal(r2.status, 'paired');
    assert.equal(await expenseCount(), before);
    assert.equal(await balance('SBI Card'), 0);
  });

  it('moves ATM cash into a Cash account it creates', async () => {
    const before = await expenseCount();
    const r = await sms('Rs.3000.00 withdrawn from HDFC Bank A/c XX1234 At MG ROAD ATM On 2026-10-03:19:01:22');
    assert.equal(r.status, 'created');
    assert.equal(await expenseCount(), before);
    assert.equal(await balance('Cash'), 3000);
  });
});

describe('bank sync — accounts it does not know yet', () => {
  it('holds the message, then learns the digits once the user picks an account', async () => {
    const r = await sms(
      'Rs.640.00 spent on HDFC Bank Debit Card XX9012 at DMART on 2026-10-03. Not you? Call 18002586161',
    );
    assert.equal(r.status, 'needs_account');
    const assigned = await asUser(db, uid, (q) =>
      q<{ r: Record<string, string> }>(`select assign_bank_message($1, $2, true) as r`, [
        r.message_id,
        acc['HDFC Savings'],
      ]),
    );
    assert.equal(assigned[0].r.status, 'created');
    const next = await sms('Rs.99.00 spent on HDFC Bank Debit Card XX9012 at BLINKIT on 2026-10-03.');
    assert.equal(next.status, 'created');
    const t = await one<{ account_name: string; category_name: string }>(
      `select account_name, category_name from transactions_view where id = $1`,
      [next.transaction_id],
    );
    assert.deepEqual(t, { account_name: 'HDFC Savings', category_name: 'Groceries' });
  });

  it('settles a card payment from an untracked account as a correction, not income', async () => {
    const r = await sms(
      'Payment of Rs. 700.00 has been received on your HDFC Bank Credit Card ending 5678 through NEFT on 03-10-2026. Thank you',
    );
    assert.equal(r.status, 'awaiting_pair');
    await asUser(db, uid, (q) => q(`select settle_bank_message_externally($1)`, [r.message_id]));
    const t = await one<{ type: string }>(
      `select type from transactions where bank_message_id = $1`,
      [r.message_id],
    );
    assert.equal(t.type, 'adjustment');
  });

  it('never lets another user see or assign your messages', async () => {
    const mine = await one<{ id: string }>(`select id from bank_messages limit 1`);
    const seen = await asUser(db, other, (q) => q(`select * from bank_messages`));
    assert.equal(seen.length, 0);
    await expectError(
      asUser(db, other, (q) => q(`select assign_bank_message($1, $2, true)`, [mine.id, acc['HDFC Savings']])),
      /CF801/,
    );
  });
});

describe('review, learning and splitting', () => {
  it('remembers a corrected category for the merchant', async () => {
    const r = await sms('Rs.180.00 debited from HDFC Bank A/c **1234 on 03-10-26 to VPA brewhouse@okaxis (UPI Ref No 627800004444)');
    const coffee = await one<{ id: string; parent_id: string }>(
      `select id, parent_id from transaction_categories where name = 'Snacks & Coffee'`,
    );
    await asUser(db, uid, (q) =>
      q(`select review_transaction($1, $2, $3, true)`, [r.transaction_id, coffee.parent_id, coffee.id]),
    );
    const again = await sms('Rs.210.00 debited from HDFC Bank A/c **1234 on 03-10-26 to VPA brewhouse@okaxis (UPI Ref No 627800005555)');
    const t = await one<{ category_id: string; needs_review: boolean }>(
      `select category_id, needs_review from transactions where id = $1`,
      [again.transaction_id],
    );
    assert.equal(t.category_id, coffee.parent_id);
    const reviewed = await one<{ needs_review: boolean }>(`select needs_review from transactions where id = $1`, [
      r.transaction_id,
    ]);
    assert.equal(reviewed.needs_review, false);
  });

  it('splits a transaction without moving any balance', async () => {
    const r = await sms('Spent Rs.1,000 On HDFC Bank Card 5678 At DMART On 2026-10-03:12:00:00');
    const card = await balance('HDFC Card');
    const cats = await asUser(db, uid, (q) =>
      q<{ id: string; name: string }>(`select id, name from transaction_categories where name in ('Groceries', 'Personal Care')`),
    );
    const parts = cats.map((c, i) => ({ amount: i === 0 ? '700.00' : '300.00', category_id: c.id }));
    await expectError(
      asUser(db, uid, (q) =>
        q(`select * from split_transaction($1, $2::jsonb)`, [
          r.transaction_id,
          JSON.stringify([{ ...parts[0], amount: '1.00' }, parts[1]]),
        ]),
      ),
      /CF823/,
    );
    const rows = await asUser(db, uid, (q) =>
      q<{ amount: string; split_group_id: string }>(`select * from split_transaction($1, $2::jsonb)`, [
        r.transaction_id,
        JSON.stringify(parts),
      ]),
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].split_group_id, rows[1].split_group_id);
    assert.equal(await balance('HDFC Card'), card);
  });

  it('marks everything reviewed in one go', async () => {
    const n = await one<{ n: number }>(`select mark_transactions_reviewed() as n`);
    assert.ok(n.n > 0);
    const left = await one<{ n: number }>(`select count(*)::int as n from transactions where needs_review`);
    assert.equal(left.n, 0);
  });
});

describe('subscriptions and integrity', () => {
  it('detects a monthly subscription from history', async () => {
    await asUser(db, uid, async (q) => {
      for (const d of ['2026-06-05', '2026-07-05', '2026-08-05', '2026-09-05']) {
        await q(
          `select save_transaction('create', gen_random_uuid(), 'expense', 649, $1, $2::timestamptz,
             null, (select id from transaction_categories where name = 'Subscriptions'), null, null, 'Netflix')`,
          [acc['HDFC Card'], `${d}T10:00:00+05:30`],
        );
      }
    });
    const found = await asUser(db, uid, (q) =>
      q<{ merchant_name: string; frequency: string; next_date: Date; typical_amount: string }>(
        `select * from detect_recurring_payments()`,
      ),
    );
    const netflix = found.find((f) => f.merchant_name === 'Netflix');
    assert.ok(netflix, 'Netflix should be detected');
    assert.equal(netflix.frequency, 'monthly');
    assert.equal(Number(netflix.typical_amount), 649);
  });

  it('keeps every balance consistent with its transactions', async () => {
    const bad = await asUser(db, uid, (q) => q(`select * from verify_account_balances() where not is_consistent`));
    assert.deepEqual(bad, []);
  });

  it('reports sync status', async () => {
    const s = await one<{ s: { connected: boolean; pending: number } }>(`select bank_sync_status() as s`);
    assert.equal(s.s.connected, true);
  });
});
