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

/**
 * Sends one SMS the way the Edge Function does. `at` sets when it arrived
 * (for history); `backfill` sends it as an imported past message.
 */
async function sms(
  body: string,
  sender = 'AX-HDFCBK',
  key = KEY_HASH,
  opts: { at?: string; backfill?: boolean } = {},
): Promise<Record<string, string>> {
  clock += 60_000;
  const receivedAt = opts.at ?? new Date(clock).toISOString();
  const parsed = parseBankSms({ body, sender, receivedAt });
  const c = db.admin;
  await c.query('begin');
  try {
    await c.query('set local role service_role');
    const { rows } = await c.query<{ r: Record<string, string> }>(
      `select ingest_bank_sms($1, $2, $3, $4, $5::jsonb, $6) as r`,
      [key, sender, body, receivedAt, JSON.stringify(parsed), opts.backfill ?? false],
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
  const r = await one<{ b: string }>(`select current_balance::text as b from accounts where name = $1`, [
    name,
  ]);
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
      asUser(db, uid, (q) => q(`select ingest_bank_sms($1, 'x', 'y', now(), '{}', false)`, [KEY_HASH])),
      /permission denied/,
    );
    await expectError(
      asUser(db, null, (q) => q(`select ingest_bank_sms($1, 'x', 'y', now(), '{}', false)`, [KEY_HASH])),
      /permission denied/,
    );
  });

  it('rejects an unknown key', async () => {
    await expectError(
      sms('Sent Rs.1.00 From HDFC Bank A/C *1234 To X', 'AX-HDFCBK', 'f'.repeat(64)),
      /CF810/,
    );
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
      type: string;
      amount: string;
      account_name: string;
      category_name: string;
      subcategory_name: string;
      merchant_name: string;
      needs_review: boolean;
      source: string;
      external_ref: string;
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
        `select save_transaction('create', gen_random_uuid(), 'expense', 320, $1, $2::timestamptz,
           null, (select id from transaction_categories where name = 'Groceries'), null, null, 'Corner store')`,
        // typed in a few minutes before the bank's SMS arrives
        [acc['HDFC Savings'], new Date(clock).toISOString()],
      ),
    );
    const before = await expenseCount();
    const r = await sms(
      'Rs.320.00 debited from HDFC Bank A/c **1234 on 03-10-26 to VPA cornerstore@ybl (UPI Ref No 627800002222)',
    );
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
    const r = await sms(
      'Rs.3000.00 withdrawn from HDFC Bank A/c XX1234 At MG ROAD ATM On 2026-10-03:19:01:22',
    );
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
    const t = await one<{ type: string }>(`select type from transactions where bank_message_id = $1`, [
      r.message_id,
    ]);
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

describe('accounts found in your messages', () => {
  const AXIS = 'AX-AXISBK';
  const old = (d: string) => ({ at: `${d}T06:30:00Z`, backfill: true });

  it('never treats a text from a phone number as a bank alert, even with a forged parse', async () => {
    const body = 'Rs.5,000.00 credited to HDFC Bank A/c **1234 on 03-10-26. Avl bal Rs 95,000';
    const before = await balance('HDFC Savings');
    assert.equal((await sms(body, '+919876543210')).status, 'ignored');
    // Even if a client sent a "transaction" parse for it, the database refuses.
    const forged = await db.admin.query<{ r: Record<string, string> }>(
      `select ingest_bank_sms($1, '+91 98765 43210', $2, now(), $3::jsonb) as r`,
      [KEY_HASH, body, JSON.stringify(parseBankSms({ body, sender: 'AX-HDFCBK' }))],
    );
    assert.equal(forged.rows[0].r.status, 'ignored');
    assert.equal(await balance('HDFC Savings'), before);
    const stored = await one<{ n: number }>(`select count(*)::int as n from bank_messages where body = $1`, [
      body,
    ]);
    assert.equal(stored.n, 0);
  });

  it('groups waiting history by account, with its latest balance', async () => {
    await sms(
      'INR 2,000.00 credited\nA/c no. XX7890\n02-10-26, 10:01:11 IST\nUPI/P2A/627700004444/PRIYA S\nAxis Bank',
      AXIS,
      KEY_HASH,
      old('2026-09-20'),
    );
    await sms(
      'Avl bal in A/c XX7890 is Rs 12,000.50 as on 21-09-26. -Axis Bank',
      AXIS,
      KEY_HASH,
      old('2026-09-21'),
    );
    await sms(
      'INR 799.00 debited\nA/c no. XX7890\n03-10-26, 12:15:01\nUPI/P2M/627712340000/BIGBASKET\nAxis Bank',
      AXIS,
      KEY_HASH,
      old('2026-09-25'),
    );
    await sms(
      'INR 3,499.00 spent using ICICI Bank Card XX4321 on 24-Sep-26 on Flipkart. Avl Limit: INR 1,46,501.00.',
      'JD-ICICIT',
      KEY_HASH,
      old('2026-09-24'),
    );
    await sms(
      'ICICI Bank Acct XX234 debited for Rs 1,250.00 on 23-Sep-26; ZOMATO credited. UPI:627712345678.',
      'JD-ICICIB',
      KEY_HASH,
      old('2026-09-23'),
    );

    const found = await asUser(db, uid, (q) =>
      q<{
        bank: string;
        last4: string;
        instrument: string;
        message_count: number;
        latest_balance: string | null;
        suggested_type: string;
      }>(`select * from discovered_accounts()`),
    );
    const axis = found.find((f) => f.bank === 'axis' && f.last4 === '7890');
    assert.ok(axis, 'Axis account should be found');
    assert.equal(axis.message_count, 2, 'the balance-only text is not counted as a message');
    assert.equal(Number(axis.latest_balance), 12000.5);
    assert.equal(axis.suggested_type, 'savings');
    const card = found.find((f) => f.bank === 'icici' && f.last4 === '4321');
    assert.equal(card?.suggested_type, 'credit_card');
    assert.ok(found.find((f) => f.bank === 'icici' && f.last4 === '234'));
  });

  it('adds the account, files all its messages at once and starts from the bank balance', async () => {
    const r = await one<{ r: { account_id: string; created: boolean; messages: number } }>(
      `select account_from_messages('axis', '7890', null, 'savings') as r`,
    );
    assert.equal(r.r.created, true);
    assert.equal(r.r.messages, 2);
    const a = await one<{
      name: string;
      institution: string;
      last4: string;
      current_balance: string;
      reported_balance: string;
    }>(
      `select name, institution, last4, current_balance::text, reported_balance::text from accounts where id = $1`,
      [r.r.account_id],
    );
    assert.equal(a.name, 'Axis Bank account 7890');
    assert.equal(a.institution, 'Axis Bank');
    assert.equal(a.last4, '7890');
    // ₹12,000.50 on the 21st, then BigBasket ₹799 on the 25th.
    assert.equal(Number(a.current_balance), 11201.5);
    assert.equal(Number(a.reported_balance), 12000.5);
    const t = await asUser(db, uid, (q) =>
      q<{ type: string; needs_review: boolean }>(
        `select type, needs_review from transactions where account_id = $1 order by occurred_at`,
        [r.r.account_id],
      ),
    );
    assert.deepEqual(
      t.map((x) => x.type),
      ['income', 'expense'],
    );
    assert.ok(
      t.every((x) => !x.needs_review),
      'imported history is not queued for review',
    );
    // and the next live message goes straight in
    const live = await sms(
      'INR 150.00 debited\nA/c no. XX7890\n04-10-26, 09:15:01\nUPI/P2M/627712349999/SWIGGY\nAxis Bank',
      AXIS,
    );
    assert.equal(live.status, 'created');
  });

  it('adds a credit card without guessing its balance', async () => {
    const r = await one<{ r: { account_id: string; messages: number } }>(
      `select account_from_messages('icici', '4321', 'ICICI Amazon Pay', 'credit_card') as r`,
    );
    assert.equal(r.r.messages, 1);
    const a = await one<{ current_balance: string; reported_balance_kind: string }>(
      `select current_balance::text, reported_balance_kind from accounts where id = $1`,
      [r.r.account_id],
    );
    // what's owed isn't in the messages, so it starts at zero for the user to set
    assert.equal(Number(a.current_balance), 0);
    assert.equal(a.reported_balance_kind, 'limit');
  });

  it('links 3-digit references to an account you already have', async () => {
    const before = await balance('SBI Salary');
    const r = await one<{ r: { account_id: string; created: boolean; messages: number } }>(
      `select account_from_messages('icici', '234', null, null, $1) as r`,
      [acc['SBI Salary']],
    );
    assert.equal(r.r.created, false);
    assert.equal(r.r.account_id, acc['SBI Salary']);
    assert.equal(r.r.messages, 1);
    const alias = await one<{ n: number }>(
      `select count(*)::int as n from account_aliases where last4 = '234' and account_id = $1`,
      [acc['SBI Salary']],
    );
    assert.equal(alias.n, 1);
    // that ₹1,250 was before the account was added, so today's balance holds
    assert.equal(await balance('SBI Salary'), before);
    const left = await asUser(db, uid, (q) => q(`select * from discovered_accounts()`));
    assert.equal(
      left.filter(
        (f: Record<string, unknown>) => f.last4 === '234' || f.last4 === '7890' || f.last4 === '4321',
      ).length,
      0,
    );
  });

  it('adds imported history to reports without moving today’s balance', async () => {
    const before = await balance('HDFC Savings');
    const spentBefore = await expenseCount();
    const r = await sms(
      'Sent Rs.1,200.00\nFrom HDFC Bank A/C *1234\nTo BOOKMYSHOW\nOn 12/08/26\nRef 622400001111',
      'AX-HDFCBK',
      KEY_HASH,
      old('2026-08-12'),
    );
    assert.equal(r.status, 'created');
    assert.equal(await expenseCount(), spentBefore + 1);
    assert.equal(await balance('HDFC Savings'), before);
    const t = await one<{ needs_review: boolean; source: string }>(
      `select needs_review, source from transactions where id = $1`,
      [r.transaction_id],
    );
    assert.deepEqual(t, { needs_review: false, source: 'sms' });
  });

  it('counts the same text once whether it arrived live or from the backup', async () => {
    const body =
      'INR 150.00 debited\nA/c no. XX7890\n04-10-26, 09:15:01\nUPI/P2M/627712349999/SWIGGY\nAxis Bank';
    const live = await one<{ received_at: Date }>(`select received_at from bank_messages where body = $1`, [
      body,
    ]);
    const again = await sms(body, 'AXISBK', KEY_HASH, { at: live.received_at.toISOString(), backfill: true });
    assert.equal(again.status, 'duplicate');
  });

  it('refuses another user’s account and bad digits', async () => {
    await expectError(
      asUser(db, other, (q) =>
        q(`select account_from_messages('hdfc', '1234', null, null, $1)`, [acc['HDFC Savings']]),
      ),
      /CF201/,
    );
    await expectError(one(`select account_from_messages('hdfc', '12a4', null, 'savings')`), /CF830/);
    await expectError(one(`select account_from_messages('hdfc', '9999')`), /CF831/);
  });
});

describe('review, learning and splitting', () => {
  it('remembers a corrected category for the merchant', async () => {
    const r = await sms(
      'Rs.180.00 debited from HDFC Bank A/c **1234 on 03-10-26 to VPA brewhouse@okaxis (UPI Ref No 627800004444)',
    );
    const coffee = await one<{ id: string; parent_id: string }>(
      `select id, parent_id from transaction_categories where name = 'Snacks & Coffee'`,
    );
    await asUser(db, uid, (q) =>
      q(`select review_transaction($1, $2, $3, true)`, [r.transaction_id, coffee.parent_id, coffee.id]),
    );
    const again = await sms(
      'Rs.210.00 debited from HDFC Bank A/c **1234 on 03-10-26 to VPA brewhouse@okaxis (UPI Ref No 627800005555)',
    );
    const t = await one<{ category_id: string; needs_review: boolean }>(
      `select category_id, needs_review from transactions where id = $1`,
      [again.transaction_id],
    );
    assert.equal(t.category_id, coffee.parent_id);
    const reviewed = await one<{ needs_review: boolean }>(
      `select needs_review from transactions where id = $1`,
      [r.transaction_id],
    );
    assert.equal(reviewed.needs_review, false);
  });

  it('splits a transaction without moving any balance', async () => {
    const r = await sms('Spent Rs.1,000 On HDFC Bank Card 5678 At DMART On 2026-10-03:12:00:00');
    const card = await balance('HDFC Card');
    const cats = await asUser(db, uid, (q) =>
      q<{ id: string; name: string }>(
        `select id, name from transaction_categories where name in ('Groceries', 'Personal Care')`,
      ),
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
    const bad = await asUser(db, uid, (q) =>
      q(`select * from verify_account_balances() where not is_consistent`),
    );
    assert.deepEqual(bad, []);
  });

  it('keeps a time zone the database understands, whatever the device reports', async () => {
    await asUser(db, uid, (q) => q(`update profiles set timezone = 'Asia/Calcutta' where id = auth.uid()`));
    const tz = await one<{ timezone: string }>(`select timezone from profiles where id = auth.uid()`);
    assert.ok(['Asia/Kolkata', 'Asia/Calcutta'].includes(tz.timezone));
    // and every date calculation still works
    await one(`select get_dashboard('2026-10-01', '2026-10-31') as d`);
    await asUser(db, uid, (q) => q(`update profiles set timezone = 'Mars/Olympus' where id = auth.uid()`));
    const fallback = await one<{ timezone: string }>(`select timezone from profiles where id = auth.uid()`);
    assert.equal(fallback.timezone, 'Asia/Kolkata');
  });

  it('reports sync status', async () => {
    const s = await one<{ s: { connected: boolean; pending: number } }>(`select bank_sync_status() as s`);
    assert.equal(s.s.connected, true);
  });
});

describe('bank sync — confidence and duplicates', () => {
  it('reads a short card alert, but sends an ambiguous card to Review instead of guessing', async () => {
    const before = await expenseCount();
    const r = await sms('Rs 1,250 spent at Amazon using HDFC Card', 'AX-HDFCBK');
    // HDFC Savings (with its debit card) and HDFC Card both fit "HDFC Card".
    assert.equal(r.status, 'needs_account');
    assert.equal(await expenseCount(), before, 'nothing booked while the account is uncertain');
    const waiting = await one<{ n: number }>(
      `select count(*)::int as n from bank_messages where status = 'needs_account' and body like '%Amazon%'`,
    );
    assert.equal(waiting.n, 1);
  });

  it('never books the same message twice', async () => {
    const count799 = async () =>
      (
        await one<{ n: number }>(
          `select count(*)::int as n from transactions where type = 'expense' and amount = 799`,
        )
      ).n;
    const before = await count799();
    const body =
      'Rs.799.00 spent on HDFC Bank Card x5678 at MYNTRA on 2026-10-05:10:15:00.Not You? Call 18002586161';
    const first = await sms(body, 'AX-HDFCBK', KEY_HASH, { at: '2026-10-05T04:45:00Z' });
    const again = await sms(body, 'AX-HDFCBK', KEY_HASH, { at: '2026-10-05T04:45:00Z' });
    assert.equal(first.status, 'created');
    assert.equal(again.status, 'duplicate');
    assert.equal(await count799(), before + 1);
  });
});
