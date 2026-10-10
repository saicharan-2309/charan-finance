/**
 * Lent & borrowed, against the real schema as a signed-in user:
 *   * a loan from before BUD never touches a bank balance,
 *   * a loan made now moves money out of the account — but is never spending,
 *   * repayments come back into an account (or outside BUD), never as income,
 *   * the ledger rows can only be changed from Lent & borrowed, and undo cleanly.
 * Plus BUD AI's exact totals (ai_totals) for day ranges, instants and cards.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { asUser, createTestDb, createUser, expectError, type TestDb } from './helpers';

let db: TestDb;
let A: string;
let B: string;
let bank: string;
let card: string;

type Q = <R extends object = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;
const as = <T>(uid: string, fn: (q: Q) => Promise<T>) => asUser(db, uid, fn);
const one = async (uid: string, sql: string, params: unknown[] = []) =>
  (await as(uid, (q) => q<{ v: string | number | null }>(sql, params)))[0]?.v;
const balance = async (id: string) =>
  Number(await one(A, `select current_balance::text as v from accounts where id = $1`, [id]));
const lending = async () =>
  Number(
    (await one(A, `select current_balance::text as v from accounts where system_kind = 'lending'`)) ?? 0,
  );
const spentAndEarned = async () => {
  const r = await as(A, (q) =>
    q<{ income: string; expense: string }>(
      `select income::text, expense::text from report_summary(current_date - 400, current_date + 1)`,
    ),
  );
  return { income: Number(r[0]!.income), expense: Number(r[0]!.expense) };
};

before(async () => {
  db = await createTestDb();
  A = await createUser(db, 'lend-a@example.com');
  B = await createUser(db, 'lend-b@example.com');
  await as(A, async (q) => {
    bank = (
      await q<{ id: string }>(
        `insert into accounts (name, type, opening_balance) values ('Bank', 'savings', 50000) returning id`,
      )
    )[0]!.id;
    card = (
      await q<{ id: string }>(
        `insert into accounts (name, type, opening_balance, credit_limit) values ('Card', 'credit_card', 0, 100000) returning id`,
      )
    )[0]!.id;
  });
});

after(async () => {
  await db?.close();
});

describe('lent & borrowed', () => {
  let old: string;
  let now: string;

  it('a loan from before BUD changes no bank balance and is not spending', async () => {
    old = String(
      await one(
        A,
        `select create_iou(jsonb_build_object('direction','lent','person','Ravi','amount','5000','occurred_on', (current_date - 60)::text)) as v`,
      ),
    );
    assert.equal(await balance(bank), 50000);
    assert.equal(await lending(), 5000);
    assert.deepEqual(await spentAndEarned(), { income: 0, expense: 0 });
  });

  it('a loan made now leaves the account — still not spending', async () => {
    now = String(
      await one(
        A,
        `select create_iou(jsonb_build_object('direction','lent','person','Asha','amount','2000','account_id',$1::text)) as v`,
        [bank],
      ),
    );
    assert.equal(await balance(bank), 48000);
    assert.equal(await lending(), 7000);
    assert.deepEqual(await spentAndEarned(), { income: 0, expense: 0 });
  });

  it('repayments: into an account, or outside BUD — never income; overpaying is refused', async () => {
    await as(A, (q) => q(`select record_iou_repayment($1, 1000, current_date, $2)`, [old, bank]));
    assert.equal(await balance(bank), 49000);
    assert.equal(await lending(), 6000);
    await expectError(
      as(A, (q) => q(`select record_iou_repayment($1, 4001)`, [old])),
      /CF724/,
    );
    await as(A, (q) => q(`select record_iou_repayment($1, 4000)`, [old])); // cash, outside BUD
    assert.equal(await balance(bank), 49000);
    assert.equal(await lending(), 2000);
    assert.ok(await one(A, `select closed_at is not null as v from ious where id = $1`, [old]));
    assert.deepEqual(await spentAndEarned(), { income: 0, expense: 0 });
  });

  it('borrowing is the mirror image', async () => {
    await one(
      A,
      `select create_iou(jsonb_build_object('direction','borrowed','person','Dad','amount','3000','occurred_on',(current_date - 10)::text)) as v`,
    );
    assert.equal(await lending(), -1000); // Asha owes 2,000; you owe Dad 3,000
    assert.equal(await balance(bank), 49000);
  });

  it('its ledger rows can only be changed from Lent & borrowed', async () => {
    await expectError(
      as(A, (q) => q(`delete from transactions where source = 'lending'`)),
      /CF711/,
    );
    await expectError(
      as(A, (q) => q(`update transactions set amount = 1 where source = 'lending'`)),
      /CF711/,
    );
  });

  it('deleting a loan puts every balance back exactly', async () => {
    await as(A, (q) => q(`select delete_iou($1)`, [now]));
    assert.equal(await balance(bank), 51000); // 50,000 + Ravi's 1,000 back
    assert.equal(await lending(), -3000);
  });

  it('nobody else can see or change your loans', async () => {
    assert.equal(Number(await one(B, `select count(*)::int as v from ious`)), 0);
    await expectError(
      as(B, (q) => q(`select record_iou_repayment($1, 1)`, [old])),
      /CF404/,
    );
    await expectError(
      as(B, (q) => q(`select delete_iou($1)`, [old])),
      /CF404/,
    );
  });
});

describe('ai_totals — exact windows', () => {
  it('matches the day summary, filters by card, and measures to the minute', async () => {
    await as(A, async (q) => {
      const food = (
        await q<{ id: string }>(
          `select id from transaction_categories where name = 'Food' and parent_id is null`,
        )
      )[0]!.id;
      for (const [acct, amt, ago] of [
        [card, '450', '20 minutes'],
        [card, '300', '3 hours'],
        [bank, '1000', '30 minutes'],
      ] as const) {
        await q(
          `select save_transaction('create', gen_random_uuid(), 'expense', $1::numeric, $2::uuid, now() - $3::interval,
                                   null, $4::uuid, null, null, 'Shop', null, null, null)`,
          [amt, acct, ago, food],
        );
      }
    });
    const hour = await as(A, (q) =>
      q<{ expense: string; expense_count: number }>(
        `select expense::text, expense_count::int from ai_totals(p_from => now() - interval '1 hour', p_to => now())`,
      ),
    );
    assert.deepEqual(hour[0], { expense: '1450.00', expense_count: 2 });
    const cardToday = await as(A, (q) =>
      q<{ expense: string }>(
        `select expense::text from ai_totals(p_start => current_date - 1, p_end => current_date + 1, p_account_ids => array[$1::uuid])`,
        [card],
      ),
    );
    assert.equal(cardToday[0]!.expense, '750.00');
    const total = await as(A, (q) =>
      q<{ a: string; b: string }>(
        `select (select expense from ai_totals(current_date - 400, current_date + 1))::text as a,
                (select expense from report_summary(current_date - 400, current_date + 1))::text as b`,
      ),
    );
    assert.equal(total[0]!.a, total[0]!.b);
  });

  it('only sees your own transactions', async () => {
    const r = await as(B, (q) =>
      q<{ expense: string }>(`select expense::text from ai_totals(current_date - 400, current_date + 1)`),
    );
    assert.equal(r[0]!.expense, '0');
  });
});
