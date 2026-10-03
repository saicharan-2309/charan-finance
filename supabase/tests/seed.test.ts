/**
 * The development seed must apply cleanly against the real schema and produce
 * a consistent set of balances — it is the fastest way to catch a migration
 * that breaks the demo data, and it proves the new payment-method and loan
 * columns are usable end to end.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { asUser, createTestDb, createUser, type TestDb } from './helpers';

let db: TestDb;
let uid: string;

before(async () => {
  db = await createTestDb();
  uid = await createUser(db, 'seed@example.com');
  await db.admin.query(readFileSync(path.resolve(__dirname, '..', 'seed', 'dev_seed.sql'), 'utf8'));
  await db.admin.query(`select dev.seed_demo_data($1)`, [uid]);
});

after(async () => {
  await db?.close();
});

describe('development seed', () => {
  it('creates a mix of payment methods with the right fields set', async () => {
    const rows = await asUser(db, uid, (q) =>
      q<{ name: string; type: string; provider: string | null; statement_day: number | null }>(
        `select name, type, provider, statement_day from accounts order by sort_order`,
      ),
    );
    assert.deepEqual(
      rows.map((r) => r.type),
      ['bank', 'savings', 'cash', 'wallet', 'credit_card'],
    );
    const card = rows.find((r) => r.type === 'credit_card')!;
    assert.equal(card.statement_day, 28);
    assert.equal(rows.find((r) => r.type === 'wallet')?.provider, 'gpay');
    // Non-card methods carry no billing dates.
    for (const r of rows.filter((x) => x.type !== 'credit_card')) {
      assert.equal(r.statement_day, null, `${r.name} should have no statement day`);
    }
  });

  it('spends from every payment method and keeps balances consistent', async () => {
    const byAccount = await asUser(db, uid, (q) =>
      q<{ name: string; n: string }>(
        `select a.name, count(t.id)::text as n
         from accounts a join transactions t on t.account_id = a.id
         where t.type = 'expense' group by a.name order by a.name`,
      ),
    );
    assert.equal(byAccount.length, 5, 'every method should have expenses');

    // The balance triggers and a from-scratch recomputation must agree.
    const check = await asUser(db, uid, (q) =>
      q<{ account_id: string; stored_balance: string; computed_balance: string; is_consistent: boolean }>(
        `select * from verify_account_balances()`,
      ),
    );
    assert.equal(check.length, 5);
    assert.deepEqual(
      check.filter((r) => !r.is_consistent),
      [],
    );
  });

  it('seeds two EMIs paid from different payment methods', async () => {
    const loans = await asUser(db, uid, (q) =>
      q<{ name: string; account_type: string; scheduled_total: string; next_payment_date: string | null }>(
        `select name, account_type, scheduled_total, next_payment_date from loan_status order by name`,
      ),
    );
    assert.deepEqual(
      loans.map((l) => [l.name, l.account_type]),
      [
        ['Car Loan', 'bank'],
        ['Phone EMI', 'credit_card'],
      ],
    );
    assert.equal(loans[0].scheduled_total, '1110000.00');
    assert.ok(loans[0].next_payment_date, 'the schedule should have a next payment');
  });

  it('records card payments as transfers, never as extra spending', async () => {
    const [row] = await asUser(db, uid, (q) =>
      q<{ transfers: string; card_payments: string }>(
        `select count(*)::text as transfers,
                count(*) filter (where to_account_type = 'credit_card')::text as card_payments
         from transactions_view where type = 'transfer'`,
      ),
    );
    assert.ok(Number(row.card_payments) >= 6, 'six months of card bills');
    const [summary] = await asUser(db, uid, (q) =>
      q<{ expense: string; income: string }>(
        // The window spans the seed's future-dated rent too, so the totals can
        // be compared against the raw rows.
        `select expense, income from report_summary(current_date - 400, current_date + 400)`,
      ),
    );
    // Transfers are excluded from both sides of the summary.
    const [transferTotal] = await asUser(db, uid, (q) =>
      q<{ total: string }>(
        `select coalesce(sum(amount),0)::text as total from transactions where type = 'transfer'`,
      ),
    );
    assert.ok(Number(transferTotal.total) > 0);
    const [expenseTotal] = await asUser(db, uid, (q) =>
      q<{ total: string }>(
        `select coalesce(sum(amount),0)::text as total from transactions where type = 'expense'`,
      ),
    );
    assert.equal(summary.expense, Number(expenseTotal.total).toFixed(2));
    assert.ok(Number(summary.income) > 0);
  });

  it('refuses to seed over real data', async () => {
    await assert.rejects(db.admin.query(`select dev.seed_demo_data($1)`, [uid]), /already has transactions/);
  });
});
