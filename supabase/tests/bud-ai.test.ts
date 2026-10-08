/**
 * BUD AI's database functions and the logo palette migration, against the
 * real schema, each call made as a user through the `authenticated` role.
 *
 *   * ai_search_transactions only ever sees the caller's own rows.
 *   * ai_friends lists accepted friends with the real shared-expense balance.
 *   * ai_take_quota stops at 150 questions a day, per user.
 *   * Factory category colours moved off the old greens; user colours kept.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { asUser, createTestDb, createUser, expectError, type TestDb } from './helpers';

let db: TestDb;
let A: string;
let B: string;
const bank: Record<string, string> = {};

type Q = <R extends object = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;
const as = <T>(uid: string, fn: (q: Q) => Promise<T>) => asUser(db, uid, fn);

before(async () => {
  db = await createTestDb();
  A = await createUser(db, 'ai-a@example.com');
  B = await createUser(db, 'ai-b@example.com');
  for (const [uid, name] of [
    [A, 'Asha'],
    [B, 'Bilal'],
  ] as const) {
    await db.admin.query(`update profiles set display_name = $2 where id = $1`, [uid, name]);
    const rows = await as(uid, (q) =>
      q<{ id: string }>(
        `insert into accounts (name, type, opening_balance) values ('Bank', 'bank', 50000) returning id`,
      ),
    );
    bank[uid] = rows[0]!.id;
  }
});

after(async () => {
  await db?.close();
});

describe('ai_search_transactions', () => {
  it('finds the caller’s own transactions by text, type and amount — never anyone else’s', async () => {
    for (const [uid, merchant, amount] of [
      [A, 'Amazon', '1250'],
      [A, 'Swiggy', '450'],
      [B, 'Amazon', '999'],
    ] as const) {
      await as(uid, (q) =>
        q(
          `select save_transaction('create', gen_random_uuid(), 'expense', $1::numeric, $2::uuid, now(),
                                   null, (select id from transaction_categories where name = 'Food' and parent_id is null), null, null, $3, null, null, null)`,
          [amount, bank[uid], merchant],
        ),
      );
    }
    const mine = await as(A, (q) =>
      q<{ merchant_name: string; amount: string }>(
        `select merchant_name, amount::text from ai_search_transactions(p_text => 'amazon')`,
      ),
    );
    assert.deepEqual(mine, [{ merchant_name: 'Amazon', amount: '1250.00' }]);

    const big = await as(A, (q) =>
      q<{ n: number }>(`select count(*)::int as n from ai_search_transactions(p_min_amount => 500)`),
    );
    assert.equal(big[0]!.n, 1);

    // B's transaction id is invisible to A even when asked for directly.
    const bRow = await as(B, (q) => q<{ id: string }>(`select id from ai_search_transactions()`));
    const peek = await as(A, (q) =>
      q<{ n: number }>(`select count(*)::int as n from ai_search_transactions(p_id => $1)`, [bRow[0]!.id]),
    );
    assert.equal(peek[0]!.n, 0);
  });

  it('is not callable without signing in', async () => {
    await expectError(
      db.admin.query(`set role anon; select * from public.ai_search_transactions()`),
      /permission denied/,
    );
    await db.admin.query(`reset role`);
  });
});

describe('ai_friends', () => {
  it('lists accepted friends with the real balance from a shared expense', async () => {
    await as(A, (q) => q(`select send_friend_request($1)`, [B]));
    await as(B, (q) => q(`select respond_friend_request($1, true)`, [A]));
    await as(A, (q) =>
      q(
        `select create_shared_expense(jsonb_build_object(
           'paid_by', $1::text, 'title', 'Dinner', 'total', '2000.00', 'currency', 'INR',
           'occurred_on', current_date::text, 'split_method', 'equal',
           'payer_account_id', $3::text,
           'shares', jsonb_build_array(
             jsonb_build_object('user_id', $1::text, 'amount', '1000.00'),
             jsonb_build_object('user_id', $2::text, 'amount', '1000.00'))))`,
        [A, B, bank[A]],
      ),
    );
    const a = await as(A, (q) =>
      q<{ name: string; net: string }>(`select name, net::text from ai_friends()`),
    );
    assert.deepEqual(a, [{ name: 'Bilal', net: '1000.00' }]);
    const b = await as(B, (q) =>
      q<{ name: string; net: string }>(`select name, net::text from ai_friends()`),
    );
    assert.deepEqual(b, [{ name: 'Asha', net: '-1000.00' }]);
  });
});

describe('ai_take_quota', () => {
  it('allows 150 questions a day per user, then refuses', async () => {
    const left = await as(A, (q) => q<{ v: number }>(`select ai_take_quota() as v`));
    assert.equal(left[0]!.v, 149);
    await db.admin.query(`insert into ai_requests (user_id) select $1 from generate_series(1, 149)`, [A]);
    await expectError(
      as(A, (q) => q(`select ai_take_quota()`)),
      /CF901/,
    );
    // B is unaffected.
    const bLeft = await as(B, (q) => q<{ v: number }>(`select ai_take_quota() as v`));
    assert.equal(bLeft[0]!.v, 149);
  });

  it('keeps the request log private', async () => {
    await expectError(
      as(A, (q) => q(`select * from ai_requests`)),
      /permission denied/,
    );
  });
});

describe('logo palette', () => {
  it('moves factory colours off the old greens and leaves the user’s own colours alone', async () => {
    const greens = await as(A, (q) =>
      q<{ n: number }>(
        `select count(*)::int as n from transaction_categories
         where upper(color) in ('#2F5E52', '#4E7363', '#2F7A64', '#4F7A73', '#5E7A3A')`,
      ),
    );
    assert.equal(greens[0]!.n, 0);
    const food = await as(A, (q) =>
      q<{ color: string }>(
        `select color from transaction_categories where name = 'Shopping' and parent_id is null`,
      ),
    );
    assert.equal(food[0]!.color, '#B4436C');

    // An old swatch on an account maps to its new counterpart; a custom colour stays.
    await db.admin.query(`update accounts set color = '#2F7A64' where id = $1`, [bank[A]]);
    await db.admin.query(`update accounts set color = '#123456' where id = $1`, [bank[B]]);
    await db.admin.query(`select apply_logo_colours(null)`);
    const colours = await db.admin.query(`select id, color from accounts where id = any($1)`, [
      [bank[A], bank[B]],
    ]);
    const byId = Object.fromEntries(colours.rows.map((r: { id: string; color: string }) => [r.id, r.color]));
    assert.equal(byId[bank[A]!], '#0E76A8');
    assert.equal(byId[bank[B]!], '#123456');
  });
});
