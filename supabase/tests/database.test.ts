/**
 * SQL-layer tests: schema constraints, balance maintenance, transfers, RLS,
 * column privileges, recurring engine, budgets, goals, net worth, storage.
 *
 * Run with: npm run test:db   (needs a disposable local PostgreSQL)
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { asUser, createTestDb, createUser, expectError, type TestDb } from './helpers';

let db: TestDb;
let alice: string;
let bob: string;

type Row = Record<string, unknown>;

async function categoryId(uid: string, name: string, parent?: string): Promise<string> {
  const rows = await asUser(db, uid, (q) =>
    q<{ id: string }>(
      parent
        ? `select c.id from transaction_categories c join transaction_categories p on p.id = c.parent_id
           where c.name = $1 and p.name = $2`
        : `select id from transaction_categories where name = $1 and parent_id is null`,
      parent ? [name, parent] : [name],
    ),
  );
  assert.equal(rows.length, 1, `category ${name} should exist`);
  return rows[0].id;
}

async function createAccount(uid: string, name: string, type: string, opening = '0'): Promise<string> {
  const rows = await asUser(db, uid, (q) =>
    q<{ id: string }>(`insert into accounts (name, type, opening_balance) values ($1, $2, $3) returning id`, [
      name,
      type,
      opening,
    ]),
  );
  return rows[0].id;
}

async function balance(uid: string, accountId: string): Promise<string> {
  const rows = await asUser(db, uid, (q) =>
    q<{ current_balance: string }>(`select current_balance from accounts where id = $1`, [accountId]),
  );
  return rows[0].current_balance;
}

async function save(uid: string, args: Row): Promise<Row> {
  const p: Row = {
    mode: 'create',
    id: randomUUID(),
    to_account_id: null,
    category_id: null,
    subcategory_id: null,
    merchant_id: null,
    merchant_name: null,
    notes: null,
    tags: null,
    expected_updated_at: null,
    occurred_at: '2026-09-15T10:00:00+05:30',
    ...args,
  };
  const rows = await asUser(db, uid, (q) =>
    q(
      `select * from save_transaction(
         p_mode => $1, p_id => $2, p_type => $3::txn_type, p_amount => $4, p_account_id => $5,
         p_occurred_at => $6, p_to_account_id => $7, p_category_id => $8, p_subcategory_id => $9,
         p_merchant_id => $10, p_merchant_name => $11, p_notes => $12, p_tags => $13,
         p_expected_updated_at => $14)`,
      [
        p.mode,
        p.id,
        p.type,
        p.amount,
        p.account_id,
        p.occurred_at,
        p.to_account_id,
        p.category_id,
        p.subcategory_id,
        p.merchant_id,
        p.merchant_name,
        p.notes,
        p.tags,
        p.expected_updated_at,
      ],
    ),
  );
  return rows[0];
}

before(async () => {
  db = await createTestDb();
  alice = await createUser(db, 'alice@example.com');
  bob = await createUser(db, 'bob@example.com');
});

after(async () => {
  await db?.close();
});

describe('new user bootstrap', () => {
  it('creates profile, settings and default categories', async () => {
    const [profile] = await asUser(db, alice, (q) => q(`select * from profiles`));
    assert.equal(profile.default_currency, 'INR');
    const [settings] = await asUser(db, alice, (q) => q(`select * from app_settings`));
    assert.equal(settings.budget_warning_percent, 80);
    const cats = await asUser(db, alice, (q) =>
      q<{ name: string; kind: string }>(
        `select name, kind from transaction_categories where parent_id is null`,
      ),
    );
    const names = cats.map((c) => c.name);
    for (const n of ['Food', 'Groceries', 'Restaurants', 'Rent', 'Subscriptions', 'Other', 'Salary']) {
      assert.ok(names.includes(n), `missing ${n}`);
    }
    // No demo transactions are ever created for a real user.
    const [{ count }] = await asUser(db, alice, (q) => q(`select count(*)::int as count from transactions`));
    assert.equal(count, 0);
  });
});

describe('accounts & balances', () => {
  it('starts at the opening balance and ignores client-supplied current_balance', async () => {
    const id = await createAccount(alice, 'HDFC Bank', 'bank', '50000.50');
    assert.equal(await balance(alice, id), '50000.50');
    await expectError(
      asUser(db, alice, (q) => q(`update accounts set current_balance = 999 where id = $1`, [id])),
      /permission denied/,
    );
    await expectError(
      asUser(db, alice, (q) =>
        q(`insert into accounts (name, type, current_balance) values ('X', 'cash', 5)`),
      ),
      /permission denied/,
    );
  });

  it('applies expense, income, edits and deletes atomically', async () => {
    const acc = await createAccount(alice, 'Salary Account', 'bank', '1000.00');
    const food = await categoryId(alice, 'Food');
    const salary = await categoryId(alice, 'Salary');

    const e = await save(alice, { type: 'expense', amount: '249.75', account_id: acc, category_id: food });
    assert.equal(await balance(alice, acc), '750.25');

    await save(alice, { type: 'income', amount: '125000.00', account_id: acc, category_id: salary });
    assert.equal(await balance(alice, acc), '125750.25');

    // Edit the expense amount.
    await save(alice, {
      mode: 'update',
      id: e.id,
      type: 'expense',
      amount: '300.00',
      account_id: acc,
      category_id: food,
      expected_updated_at: e.updated_at,
    });
    assert.equal(await balance(alice, acc), '125700.00');

    // Delete it.
    await asUser(db, alice, (q) => q(`select delete_transaction($1)`, [e.id]));
    assert.equal(await balance(alice, acc), '126000.00');

    // Changing the opening balance shifts the current balance by the delta.
    await asUser(db, alice, (q) => q(`update accounts set opening_balance = 2000 where id = $1`, [acc]));
    assert.equal(await balance(alice, acc), '127000.00');
  });

  it('moves money between accounts on edit', async () => {
    const a = await createAccount(alice, 'Wallet A', 'wallet', '500');
    const b = await createAccount(alice, 'Wallet B', 'wallet', '500');
    const food = await categoryId(alice, 'Food');
    const t = await save(alice, { type: 'expense', amount: '100', account_id: a, category_id: food });
    await save(alice, {
      mode: 'update',
      id: t.id,
      type: 'expense',
      amount: '100',
      account_id: b,
      category_id: food,
    });
    assert.equal(await balance(alice, a), '500.00');
    assert.equal(await balance(alice, b), '400.00');
  });

  it('rejects amounts with more than two decimals and non-positive amounts', async () => {
    const acc = await createAccount(alice, 'Precision', 'cash', '0');
    const food = await categoryId(alice, 'Food');
    await expectError(
      save(alice, { type: 'expense', amount: '1.005', account_id: acc, category_id: food }),
      /CF205/,
    );
    await expectError(
      save(alice, { type: 'expense', amount: '0', account_id: acc, category_id: food }),
      /check constraint/,
    );
    await expectError(
      save(alice, { type: 'expense', amount: '-5', account_id: acc, category_id: food }),
      /check constraint/,
    );
  });

  it('blocks deleting an account that has history but allows archiving', async () => {
    const acc = await createAccount(alice, 'Old Bank', 'bank', '0');
    const food = await categoryId(alice, 'Food');
    await save(alice, { type: 'expense', amount: '10', account_id: acc, category_id: food });
    await expectError(
      asUser(db, alice, (q) => q(`delete from accounts where id = $1`, [acc])),
      /foreign key/,
    );
    await asUser(db, alice, (q) => q(`update accounts set is_active = false where id = $1`, [acc]));
    await expectError(
      save(alice, { type: 'expense', amount: '10', account_id: acc, category_id: food }),
      /CF203/,
    );
  });

  it('records balance reconciliation as an adjustment excluded from income/expense', async () => {
    const acc = await createAccount(alice, 'Brokerage', 'investment', '10000');
    await asUser(db, alice, (q) => q(`select set_account_balance($1, 12500.40, 'Valuation')`, [acc]));
    assert.equal(await balance(alice, acc), '12500.40');
    const [adj] = await asUser(db, alice, (q) =>
      q(`select type, amount from transactions where account_id = $1`, [acc]),
    );
    assert.equal(adj.type, 'adjustment');
    assert.equal(adj.amount, '2500.40');
  });
});

describe('transfers', () => {
  it('moves money without counting as income or expense', async () => {
    const carol = await createUser(db, 'carol@example.com');
    const bank = await createAccount(carol, 'HDFC Bank', 'bank', '50000');
    const card = await createAccount(carol, 'HDFC Credit Card', 'credit_card', '0');
    const shopping = await categoryId(carol, 'Shopping');

    await save(carol, { type: 'expense', amount: '8000', account_id: card, category_id: shopping });
    assert.equal(await balance(carol, card), '-8000.00');

    // Pay the card bill.
    await save(carol, { type: 'transfer', amount: '8000', account_id: bank, to_account_id: card });
    assert.equal(await balance(carol, bank), '42000.00');
    assert.equal(await balance(carol, card), '0.00');

    const [s] = await asUser(db, carol, (q) => q(`select * from report_summary('2026-09-01', '2026-09-30')`));
    assert.equal(s.expense, '8000.00');
    assert.equal(s.income, '0');
  });

  it('rejects malformed transfers', async () => {
    const acc = await createAccount(alice, 'Self', 'bank', '0');
    await expectError(
      save(alice, { type: 'transfer', amount: '1', account_id: acc, to_account_id: acc }),
      /check constraint/,
    );
    await expectError(
      save(alice, { type: 'transfer', amount: '1', account_id: acc }),
      /check constraint|CF201/,
    );
  });

  it('stays consistent across a randomized sequence of operations', async () => {
    const dave = await createUser(db, 'dave@example.com');
    const accounts = [
      await createAccount(dave, 'A', 'bank', '1000'),
      await createAccount(dave, 'B', 'cash', '250.50'),
      await createAccount(dave, 'C', 'credit_card', '0'),
    ];
    const food = await categoryId(dave, 'Food');
    const salary = await categoryId(dave, 'Salary');
    const ids: { id: string; updated_at: unknown }[] = [];
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 150; i++) {
      const op = rand(10);
      const amount = `${rand(100000)}.${String(rand(100)).padStart(2, '0')}`;
      if (amount === '0.00') continue;
      const from = accounts[rand(3)];
      let to = accounts[rand(3)];
      if (to === from) to = accounts[(accounts.indexOf(from) + 1) % 3];
      if (op < 4) {
        ids.push(
          (await save(dave, { type: 'expense', amount, account_id: from, category_id: food })) as never,
        );
      } else if (op < 6) {
        ids.push(
          (await save(dave, { type: 'income', amount, account_id: from, category_id: salary })) as never,
        );
      } else if (op < 8) {
        ids.push(
          (await save(dave, { type: 'transfer', amount, account_id: from, to_account_id: to })) as never,
        );
      } else if (ids.length > 0) {
        const victim = ids.splice(rand(ids.length), 1)[0];
        if (op === 8) {
          await asUser(db, dave, (q) => q(`select delete_transaction($1)`, [victim.id]));
        } else {
          ids.push(
            (await save(dave, {
              mode: 'update',
              id: victim.id,
              type: 'transfer',
              amount,
              account_id: from,
              to_account_id: to,
            })) as never,
          );
        }
      }
    }
    const rows = await asUser(db, dave, (q) => q(`select * from verify_account_balances()`));
    assert.equal(rows.length, 3);
    for (const r of rows) assert.equal(r.is_consistent, true, JSON.stringify(r));
  });
});

describe('save_transaction semantics', () => {
  it('is idempotent for create replays (offline queue)', async () => {
    const acc = await createAccount(alice, 'Idem', 'cash', '100');
    const food = await categoryId(alice, 'Food');
    const id = randomUUID();
    await save(alice, { id, type: 'expense', amount: '10', account_id: acc, category_id: food });
    await save(alice, { id, type: 'expense', amount: '10', account_id: acc, category_id: food });
    assert.equal(await balance(alice, acc), '90.00');
  });

  it('detects concurrent edits', async () => {
    const acc = await createAccount(alice, 'Conflict', 'cash', '100');
    const food = await categoryId(alice, 'Food');
    const t = await save(alice, { type: 'expense', amount: '10', account_id: acc, category_id: food });
    await save(alice, {
      mode: 'update',
      id: t.id,
      type: 'expense',
      amount: '11',
      account_id: acc,
      category_id: food,
      expected_updated_at: t.updated_at,
    });
    await expectError(
      save(alice, {
        mode: 'update',
        id: t.id,
        type: 'expense',
        amount: '12',
        account_id: acc,
        category_id: food,
        expected_updated_at: t.updated_at,
      }),
      /CF409/,
    );
  });

  it('resolves merchants case-insensitively, learns default category, and syncs tags', async () => {
    const acc = await createAccount(alice, 'Tags', 'cash', '1000');
    const food = await categoryId(alice, 'Food');
    const t1 = await save(alice, {
      type: 'expense',
      amount: '450',
      account_id: acc,
      category_id: food,
      merchant_name: '  Swiggy ',
      tags: ['work', 'Lunch'],
    });
    const t2 = await save(alice, {
      type: 'expense',
      amount: '300',
      account_id: acc,
      category_id: food,
      merchant_name: 'SWIGGY',
    });
    assert.equal(t1.merchant_id, t2.merchant_id);
    const [m] = await asUser(db, alice, (q) =>
      q(`select name, default_category_id from merchants where id = $1`, [t1.merchant_id]),
    );
    assert.equal(m.name, 'Swiggy');
    assert.equal(m.default_category_id, food);

    await save(alice, {
      mode: 'update',
      id: t1.id,
      type: 'expense',
      amount: '450',
      account_id: acc,
      category_id: food,
      merchant_id: t1.merchant_id,
      tags: ['lunch', 'team'],
    });
    const [v] = await asUser(db, alice, (q) =>
      q<{ tag_names: string[]; search_text: string }>(
        `select tag_names, search_text from transactions_view where id = $1`,
        [t1.id],
      ),
    );
    assert.deepEqual(v.tag_names, ['Lunch', 'team']);
    assert.match(v.search_text, /swiggy/);
    assert.match(v.search_text, /450\.00/);
  });

  it('validates category kind and subcategory parentage', async () => {
    const acc = await createAccount(alice, 'Cats', 'cash', '0');
    const salary = await categoryId(alice, 'Salary');
    const food = await categoryId(alice, 'Food');
    const shopping = await categoryId(alice, 'Shopping');
    const clothing = await categoryId(alice, 'Clothing', 'Shopping');
    await expectError(
      save(alice, { type: 'expense', amount: '5', account_id: acc, category_id: salary }),
      /CF303/,
    );
    await expectError(
      save(alice, {
        type: 'expense',
        amount: '5',
        account_id: acc,
        category_id: food,
        subcategory_id: clothing,
      }),
      /CF304/,
    );
    await expectError(
      save(alice, { type: 'expense', amount: '5', account_id: acc, category_id: clothing }),
      /CF302/,
    );
    await save(alice, {
      type: 'expense',
      amount: '5',
      account_id: acc,
      category_id: shopping,
      subcategory_id: clothing,
    });
    // In-use categories cannot be deleted, only archived (archiving cascades to subcategories).
    await expectError(
      asUser(db, alice, (q) => q(`delete from transaction_categories where id = $1`, [shopping])),
      /foreign key/,
    );
    await asUser(db, alice, (q) =>
      q(`update transaction_categories set is_archived = true where id = $1`, [shopping]),
    );
    const [sub] = await asUser(db, alice, (q) =>
      q(`select is_archived from transaction_categories where id = $1`, [clothing]),
    );
    assert.equal(sub.is_archived, true);
  });
});

describe('row level security', () => {
  it('isolates every table between users', async () => {
    const acc = await createAccount(alice, 'Private', 'bank', '777');
    const food = await categoryId(alice, 'Food');
    await save(alice, {
      type: 'expense',
      amount: '7',
      account_id: acc,
      category_id: food,
      merchant_name: 'Secret Shop',
    });
    await asUser(db, alice, (q) =>
      q(`insert into savings_goals (name, target_amount) values ('Hidden', 100)`),
    );

    const tables = [
      'accounts',
      'transactions',
      'transactions_view',
      'merchants',
      'transaction_categories',
      'savings_goals',
      'tags',
      'transaction_tags',
      'budgets',
      'recurring_transactions',
      'net_worth_snapshots',
      'attachments',
      'goal_contributions',
      'profiles',
      'app_settings',
    ];
    for (const t of tables) {
      const rows = await asUser(db, bob, (q) =>
        q(`select * from ${t} where ${t === 'profiles' ? 'id' : 'user_id'} = $1`, [alice]),
      );
      assert.equal(rows.length, 0, `bob can see alice's ${t}`);
    }
  });

  it('prevents writes to other users rows and cross-user references', async () => {
    const aliceAcc = await createAccount(alice, 'Target', 'bank', '1000');
    const bobFood = await categoryId(bob, 'Food');
    const bobAcc = await createAccount(bob, 'Bob Bank', 'bank', '0');

    const updated = await asUser(db, bob, (q) =>
      q(`update accounts set name = 'pwned' where id = $1 returning id`, [aliceAcc]),
    );
    assert.equal(updated.length, 0);
    const deleted = await asUser(db, bob, (q) =>
      q(`delete from accounts where id = $1 returning id`, [aliceAcc]),
    );
    assert.equal(deleted.length, 0);

    // Bob tries to post an expense against Alice's account.
    await expectError(
      save(bob, { type: 'expense', amount: '1', account_id: aliceAcc, category_id: bobFood }),
      /CF201|foreign key|row-level security/,
    );
    // Bob tries to transfer from his account into Alice's account.
    await expectError(
      save(bob, { type: 'transfer', amount: '1', account_id: bobAcc, to_account_id: aliceAcc }),
      /CF201|foreign key|row-level security/,
    );
    // Bob tries to insert a row owned by Alice.
    await expectError(
      asUser(db, bob, (q) =>
        q(`insert into accounts (user_id, name, type) values ($1, 'x', 'cash')`, [alice]),
      ),
      /row-level security/,
    );
    // Direct insert referencing Alice's account under Bob's user id: composite FK blocks it.
    await expectError(
      asUser(db, bob, (q) =>
        q(
          `insert into transactions (type, amount, currency, account_id, category_id, occurred_at)
           values ('expense', 1, 'INR', $1, $2, now())`,
          [aliceAcc, bobFood],
        ),
      ),
      /CF201|foreign key/,
    );
    assert.equal(await balance(alice, aliceAcc), '1000.00');
  });

  it('gives the anon role no access', async () => {
    await expectError(
      asUser(db, null, (q) => q(`select * from accounts`)),
      /permission denied/,
    );
    await expectError(
      asUser(db, null, (q) => q(`select * from get_dashboard('2026-09-01','2026-09-30')`)),
      /permission denied/,
    );
  });

  it('prevents clients from forging net worth snapshots or goal progress', async () => {
    await expectError(
      asUser(db, alice, (q) =>
        q(
          `insert into net_worth_snapshots (snapshot_date, currency, assets, liabilities) values (current_date, 'INR', 1, 0)`,
        ),
      ),
      /permission denied/,
    );
    await expectError(
      asUser(db, alice, (q) => q(`update savings_goals set current_amount = 999999`)),
      /permission denied/,
    );
  });

  it('restricts receipt storage to the owner folder', async () => {
    await asUser(db, alice, (q) =>
      q(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [
        `${alice}/transactions/x/receipt.jpg`,
      ]),
    );
    await expectError(
      asUser(db, bob, (q) =>
        q(`insert into storage.objects (bucket_id, name) values ('receipts', $1)`, [
          `${alice}/transactions/y/evil.jpg`,
        ]),
      ),
      /row-level security/,
    );
    const seen = await asUser(db, bob, (q) =>
      q(`select * from storage.objects where bucket_id = 'receipts'`),
    );
    assert.equal(seen.length, 0);
    await expectError(
      asUser(db, alice, (q) =>
        q(`insert into attachments (storage_path, mime_type, size_bytes) values ($1, 'image/jpeg', 100)`, [
          `${bob}/inbox/a.jpg`,
        ]),
      ),
      /check constraint/,
    );
    await expectError(
      asUser(db, alice, (q) =>
        q(
          `insert into attachments (storage_path, mime_type, size_bytes) values ($1, 'application/zip', 100)`,
          [`${alice}/inbox/a.zip`],
        ),
      ),
      /check constraint/,
    );
  });
});

describe('recurring engine', () => {
  it('generates month-end occurrences without drift', async () => {
    const rows = await asUser(db, alice, (q) =>
      q<{ d: string }>(
        `select to_char(d, 'YYYY-MM-DD') as d from recurrence_occurrences('2026-01-31', 'monthly', 1, null, '2026-01-01', '2026-06-30') d`,
      ),
    );
    assert.deepEqual(
      rows.map((r) => r.d),
      ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30'],
    );
    const weekly = await asUser(db, alice, (q) =>
      q<{ d: string }>(
        `select to_char(d, 'YYYY-MM-DD') as d from recurrence_occurrences('2026-09-01', 'weekly', 2, '2026-10-01', '2026-09-10', '2026-12-31') d`,
      ),
    );
    assert.deepEqual(
      weekly.map((r) => r.d),
      ['2026-09-15', '2026-09-29'],
    );
    const yearly = await asUser(db, alice, (q) =>
      q<{ d: string }>(
        `select to_char(d, 'YYYY-MM-DD') as d from recurrence_occurrences('2024-02-29', 'yearly', 1, null, '2024-01-01', '2028-12-31') d`,
      ),
    );
    assert.deepEqual(
      yearly.map((r) => r.d),
      ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'],
    );
  });

  it('posts, skips and never duplicates occurrences', async () => {
    const erin = await createUser(db, 'erin@example.com');
    const bank = await createAccount(erin, 'Bank', 'bank', '100000');
    const subs = await categoryId(erin, 'Subscriptions');
    const [r] = await asUser(db, erin, (q) =>
      q<{ id: string }>(
        `insert into recurring_transactions (name, type, kind, amount, account_id, category_id, frequency, start_date)
         values ('Netflix', 'expense', 'subscription', 649, $1, $2, 'monthly', '2026-07-05') returning id`,
        [bank, subs],
      ),
    );
    const due = async () =>
      (
        await asUser(db, erin, (q) =>
          q<{ d: string }>(
            `select to_char(next_due_date(r), 'YYYY-MM-DD') as d from recurring_transactions r where id = $1`,
            [r.id],
          ),
        )
      )[0].d;

    assert.equal(await due(), '2026-07-05');
    await expectError(
      asUser(db, erin, (q) => q(`select post_recurring_occurrence($1, '2026-08-05')`, [r.id])),
      /CF603/,
    );
    await asUser(db, erin, (q) => q(`select post_recurring_occurrence($1, '2026-07-05')`, [r.id]));
    // Replaying the same post is a no-op.
    await asUser(db, erin, (q) => q(`select post_recurring_occurrence($1, '2026-07-05')`, [r.id]));
    assert.equal(await due(), '2026-08-05');
    assert.equal(await balance(erin, bank), '99351.00');

    await asUser(db, erin, (q) => q(`select skip_recurring_occurrence($1, '2026-08-05')`, [r.id]));
    assert.equal(await due(), '2026-09-05');
    const [{ count }] = await asUser(db, erin, (q) =>
      q(`select count(*)::int as count from transactions where recurring_id = $1`, [r.id]),
    );
    assert.equal(count, 1);

    const [{ s }] = await asUser(db, erin, (q) =>
      q(`select subscription_expense as s from report_summary('2026-07-01','2026-07-31')`),
    );
    assert.equal(s, '649.00');

    // Deleting the template keeps posted history.
    await asUser(db, erin, (q) => q(`delete from recurring_transactions where id = $1`, [r.id]));
    const kept = await asUser(db, erin, (q) =>
      q(`select recurring_id, recurring_occurrence from transactions where account_id = $1`, [bank]),
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0].recurring_id, null);
  });

  it('auto-posts all due occurrences idempotently', async () => {
    const frank = await createUser(db, 'frank@example.com');
    const bank = await createAccount(frank, 'Bank', 'bank', '0');
    const salary = await categoryId(frank, 'Salary');
    const start = await asUser(db, frank, (q) =>
      q<{ d: string }>(`select to_char(user_today() - 65, 'YYYY-MM-DD') as d`),
    );
    await asUser(db, frank, (q) =>
      q(
        `insert into recurring_transactions (name, type, amount, account_id, category_id, frequency, start_date, auto_post)
         values ('Salary', 'income', 100000, $1, $2, 'monthly', $3, true)`,
        [bank, salary, start[0].d],
      ),
    );
    const [{ n }] = await asUser(db, frank, (q) => q<{ n: number }>(`select post_due_recurring() as n`));
    assert.ok(n === 3 || n === 2, `expected 2-3 postings, got ${n}`);
    const [{ n: again }] = await asUser(db, frank, (q) =>
      q<{ n: number }>(`select post_due_recurring() as n`),
    );
    assert.equal(again, 0);
    assert.equal(await balance(frank, bank), `${n * 100000}.00`);
  });
});

describe('budgets', () => {
  it('computes period bounds', async () => {
    const rows = await asUser(db, alice, (q) =>
      q<{ s: string; e: string }>(
        `select to_char(period_start,'YYYY-MM-DD') s, to_char(period_end,'YYYY-MM-DD') e
       from budget_period_bounds('monthly', '2026-01-25', null, '2026-03-10')`,
      ),
    );
    assert.deepEqual(rows[0], { s: '2026-02-25', e: '2026-03-24' });
    const w = await asUser(db, alice, (q) =>
      q<{ s: string; e: string }>(
        `select to_char(period_start,'YYYY-MM-DD') s, to_char(period_end,'YYYY-MM-DD') e
       from budget_period_bounds('weekly', '2026-09-07', null, '2026-09-20')`,
      ),
    );
    assert.deepEqual(w[0], { s: '2026-09-14', e: '2026-09-20' });
  });

  it('sums only expenses in the period and category', async () => {
    const gina = await createUser(db, 'gina@example.com');
    const bank = await createAccount(gina, 'Bank', 'bank', '100000');
    const food = await categoryId(gina, 'Food');
    const snacks = await categoryId(gina, 'Snacks & Coffee', 'Food');
    const shopping = await categoryId(gina, 'Shopping');
    const salary = await categoryId(gina, 'Salary');
    const [b] = await asUser(db, gina, (q) =>
      q<{ id: string }>(
        `insert into budgets (name, period, start_date) values ('Monthly', 'monthly', '2026-01-01') returning id`,
      ),
    );
    await asUser(db, gina, (q) =>
      q(
        `insert into budget_items (budget_id, category_id, amount) values ($1, $2, 12000), ($1, null, 30000)`,
        [b.id, food],
      ),
    );
    await save(gina, {
      type: 'expense',
      amount: '1000',
      account_id: bank,
      category_id: food,
      occurred_at: '2026-09-02T12:00:00+05:30',
    });
    await save(gina, {
      type: 'expense',
      amount: '250.50',
      account_id: bank,
      category_id: food,
      subcategory_id: snacks,
      occurred_at: '2026-09-30T23:30:00+05:30',
    });
    await save(gina, {
      type: 'expense',
      amount: '5000',
      account_id: bank,
      category_id: shopping,
      occurred_at: '2026-09-10T12:00:00+05:30',
    });
    await save(gina, {
      type: 'expense',
      amount: '999',
      account_id: bank,
      category_id: food,
      occurred_at: '2026-08-31T23:00:00+05:30',
    });
    await save(gina, {
      type: 'income',
      amount: '50000',
      account_id: bank,
      category_id: salary,
      occurred_at: '2026-09-01T09:00:00+05:30',
    });
    // 2026-10-01 01:00 IST is 2026-09-30 19:30 UTC — belongs to October locally.
    await save(gina, {
      type: 'expense',
      amount: '77',
      account_id: bank,
      category_id: food,
      occurred_at: '2026-09-30T19:30:00Z',
    });

    const rows = await asUser(db, gina, (q) =>
      q<{ category_id: string | null; spent: string }>(
        `select category_id, spent from get_budget_status($1, '2026-09-15')`,
        [b.id],
      ),
    );
    const overall = rows.find((r) => r.category_id === null);
    const foodRow = rows.find((r) => r.category_id === food);
    assert.equal(foodRow?.spent, '1250.50');
    assert.equal(overall?.spent, '6250.50');
  });
});

describe('goals', () => {
  it('derives current amount from contributions and blocks over-withdrawal', async () => {
    const [g] = await asUser(db, alice, (q) =>
      q<{ id: string; current_amount: string }>(
        `insert into savings_goals (name, target_amount, initial_amount) values ('MacBook', 120000, 50000) returning id, current_amount`,
      ),
    );
    assert.equal(g.current_amount, '50000.00');
    await asUser(db, alice, (q) =>
      q(`insert into goal_contributions (goal_id, amount) values ($1, 22000)`, [g.id]),
    );
    const [after1] = await asUser(db, alice, (q) =>
      q(`select current_amount from savings_goals where id = $1`, [g.id]),
    );
    assert.equal(after1.current_amount, '72000.00');
    await expectError(
      asUser(db, alice, (q) =>
        q(`insert into goal_contributions (goal_id, amount) values ($1, -80000)`, [g.id]),
      ),
      /CF401/,
    );
  });
});

describe('net worth', () => {
  it('captures assets and liabilities from real balances', async () => {
    const hank = await createUser(db, 'hank@example.com');
    await createAccount(hank, 'Bank', 'bank', '84250');
    await createAccount(hank, 'Cash', 'cash', '1750');
    await createAccount(hank, 'Card', 'credit_card', '-12000');
    const [s] = await asUser(db, hank, (q) => q(`select * from capture_net_worth_snapshot()`));
    assert.equal(s.assets, '86000.00');
    assert.equal(s.liabilities, '12000.00');
    assert.equal(s.net_worth, '74000.00');
    // Capturing again on the same day updates rather than duplicates.
    await asUser(db, hank, (q) => q(`select * from capture_net_worth_snapshot()`));
    const [{ count }] = await asUser(db, hank, (q) =>
      q(`select count(*)::int as count from net_worth_snapshots`),
    );
    assert.equal(count, 1);
  });
});

describe('reports & merchants', () => {
  it('produces dashboard, zero-filled series, breakdowns and merges merchants', async () => {
    const ivy = await createUser(db, 'ivy@example.com');
    const bank = await createAccount(ivy, 'Bank', 'bank', '0');
    const food = await categoryId(ivy, 'Food');
    const restaurants = await categoryId(ivy, 'Restaurants');
    const salary = await categoryId(ivy, 'Salary');
    await save(ivy, {
      type: 'income',
      amount: '125000',
      account_id: bank,
      category_id: salary,
      occurred_at: '2026-09-01T09:00:00+05:30',
    });
    await save(ivy, {
      type: 'expense',
      amount: '450',
      account_id: bank,
      category_id: food,
      merchant_name: 'Zomato',
      occurred_at: '2026-09-03T20:00:00+05:30',
    });
    await save(ivy, {
      type: 'expense',
      amount: '1200',
      account_id: bank,
      category_id: restaurants,
      merchant_name: 'zomato.',
      occurred_at: '2026-09-05T20:00:00+05:30',
    });
    await save(ivy, {
      type: 'expense',
      amount: '800',
      account_id: bank,
      category_id: food,
      merchant_name: 'Zomato',
      occurred_at: '2026-07-05T20:00:00+05:30',
    });

    const [{ d }] = await asUser(db, ivy, (q) =>
      q<{ d: Record<string, unknown> }>(`select get_dashboard('2026-09-01', '2026-09-30') as d`),
    );
    const current = d.current as Record<string, number>;
    assert.equal(Number(current.income), 125000);
    assert.equal(Number(current.expense), 1650);
    assert.equal((d.trend as unknown[]).length, 6);
    assert.equal((d.accounts as unknown[]).length, 1);

    const series = await asUser(db, ivy, (q) =>
      q<{ expense: string }>(`select expense from report_time_series('2026-09-01', '2026-09-07', 'day')`),
    );
    assert.equal(series.length, 7);
    assert.equal(series[2].expense, '450.00');
    assert.equal(series[1].expense, '0');

    const cats = await asUser(db, ivy, (q) =>
      q<{ name: string; total: string }>(
        `select name, total from report_by_category('2026-09-01', '2026-09-30')`,
      ),
    );
    assert.deepEqual(
      cats.map((c) => [c.name, c.total]),
      [
        ['Restaurants', '1200.00'],
        ['Food', '450.00'],
      ],
    );

    const merchants = await asUser(db, ivy, (q) =>
      q<{ id: string; name: string }>(`select id, name from merchants order by name`),
    );
    assert.equal(merchants.length, 2); // "Zomato" and "zomato."
    const [dup, keep] = merchants[0].name === 'zomato.' ? merchants : [merchants[1], merchants[0]];
    await asUser(db, ivy, (q) => q(`select merge_merchants($1, $2)`, [dup.id, keep.id]));
    const [stats] = await asUser(db, ivy, (q) =>
      q(`select * from merchant_stats((select id from merchants))`),
    );
    assert.equal(stats.tx_count, '3');
    assert.equal(stats.total, '2450.00');
    assert.equal(stats.largest, '1200.00');
  });
});
