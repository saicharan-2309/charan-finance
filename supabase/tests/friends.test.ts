/**
 * Friends, shared expenses and settlements — against the real schema, each
 * call made as the user through the `authenticated` role, so row-level
 * security and function grants are exercised exactly as in the app.
 *
 * The headline scenario is the acceptance test from the brief:
 *   A pays ₹2,000, splits it equally with B.
 *   A: spending ₹1,000, receivable ₹1,000, bank −₹2,000.
 *   B: spending ₹1,000, owes A ₹1,000, bank unchanged.
 *   B settles ₹1,000; A records the receipt.
 *   A: bank −₹1,000, Friends 0. B: bank −₹1,000, Friends 0. Both net 0.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { asUser, createTestDb, createUser, expectError, type TestDb } from './helpers';

let db: TestDb;
let A: string;
let B: string;
let C: string;
const bank: Record<string, string> = {};

type Q = <R extends object = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;
const as = <T>(uid: string, fn: (q: Q) => Promise<T>) => asUser(db, uid, fn);

async function scalar<T = string>(uid: string, sql: string, params: unknown[] = []): Promise<T> {
  const rows = await as(uid, (q) => q<{ v: T }>(sql, params));
  return rows[0]?.v as T;
}

const balanceOf = async (uid: string, accountId: string) =>
  Number(await scalar(uid, `select current_balance::text as v from accounts where id = $1`, [accountId]));
const friendsBalance = async (uid: string) =>
  Number(await scalar(uid, `select current_balance::text as v from accounts where system_kind = 'friends'`));
const spending = async (uid: string) =>
  Number(
    await scalar(uid, `select coalesce(sum(amount), 0)::text as v from transactions where type = 'expense'`),
  );
const netWith = async (uid: string, other: string) =>
  Number(
    (await scalar<string | null>(uid, `select net::text as v from friend_balances() where user_id = $1`, [
      other,
    ])) ?? 0,
  );

before(async () => {
  db = await createTestDb();
  A = await createUser(db, 'a@example.com');
  B = await createUser(db, 'b@example.com');
  C = await createUser(db, 'c@example.com');
  for (const [uid, name] of [
    [A, 'Asha'],
    [B, 'Bilal'],
    [C, 'Chitra'],
  ] as const) {
    await db.admin.query(`update profiles set display_name = $2 where id = $1`, [uid, name]);
    const rows = await as(uid, (q) =>
      q<{ id: string }>(
        `insert into accounts (name, type, opening_balance) values ('Bank', 'bank', 50000) returning id`,
      ),
    );
    bank[uid] = rows[0].id;
  }
});

after(async () => {
  await db?.close();
});

describe('usernames and finding people', () => {
  it('sets usernames and rejects taken or malformed ones', async () => {
    await as(A, (q) => q(`select set_username('asha.k')`));
    await as(B, (q) => q(`select set_username('bilal')`));
    await as(C, (q) => q(`select set_username('chitra')`));
    await expectError(
      as(B, (q) => q(`select set_username('Asha.K')`)),
      /CF611/,
    );
    await expectError(
      as(B, (q) => q(`select set_username('x')`)),
      /CF610/,
    );
  });

  it('finds by username prefix and exact email, never yourself', async () => {
    const byName = await as(A, (q) => q<{ username: string }>(`select username from search_people('bil')`));
    assert.deepEqual(
      byName.map((r) => r.username),
      ['bilal'],
    );
    const byEmail = await as(A, (q) =>
      q<{ username: string }>(`select username from search_people('c@example.com')`),
    );
    assert.deepEqual(
      byEmail.map((r) => r.username),
      ['chitra'],
    );
    const self = await as(A, (q) => q(`select * from search_people('asha')`));
    assert.equal(self.length, 0);
  });
});

describe('friend requests', () => {
  it('sends, prevents duplicates, and accepts', async () => {
    assert.equal(await scalar(A, `select send_friend_request($1) as v`, [B]), 'requested');
    await expectError(
      as(A, (q) => q(`select send_friend_request($1)`, [B])),
      /CF602/,
    );
    await expectError(
      as(A, (q) => q(`select respond_friend_request($1, true)`, [B])),
      /CF605/,
    );
    assert.equal(await scalar(B, `select respond_friend_request($1, true) as v`, [A]), 'accepted');
    await expectError(
      as(A, (q) => q(`select send_friend_request($1)`, [B])),
      /CF601/,
    );
    const notes = await as(A, (q) =>
      q<{ kind: string }>(`select kind from notifications order by created_at`),
    );
    assert.ok(notes.some((n) => n.kind === 'friend_accepted'));
  });

  it('lets someone ask again after a decline, and a crossed request accepts', async () => {
    await as(A, (q) => q(`select send_friend_request($1)`, [C]));
    await as(C, (q) => q(`select respond_friend_request($1, false)`, [A]));
    assert.equal(await scalar(A, `select send_friend_request($1) as v`, [C]), 'requested');
    // C now sends one back instead of answering: that accepts.
    assert.equal(await scalar(C, `select send_friend_request($1) as v`, [A]), 'accepted');
  });

  it('blocks: no requests, no messages, and the blocked person can’t see the block', async () => {
    await as(C, (q) => q(`select send_friend_request($1)`, [B]));
    await as(B, (q) => q(`select block_user($1)`, [C]));
    await expectError(
      as(C, (q) => q(`select send_friend_request($1)`, [B])),
      /CF603/,
    );
    const seen = await as(C, (q) => q(`select * from friendships where $1 in (user_low, user_high)`, [B]));
    assert.equal(seen.length, 0);
    const found = await as(C, (q) => q(`select * from search_people('bilal')`));
    assert.equal(found.length, 0);
    await as(B, (q) => q(`select unblock_user($1)`, [C]));
  });
});

describe('privacy', () => {
  it('friends can’t read each other’s accounts, transactions or profiles', async () => {
    const acc = await as(B, (q) => q(`select * from accounts where user_id = $1`, [A]));
    const txn = await as(B, (q) => q(`select * from transactions where user_id = $1`, [A]));
    const prof = await as(B, (q) => q(`select * from profiles where id = $1`, [A]));
    assert.equal(acc.length, 0);
    assert.equal(txn.length, 0);
    assert.equal(prof.length, 0);
  });

  it('the anon role can’t call any Friends function', async () => {
    await expectError(
      asUser(db, null, (q) => q(`select * from friend_balances()`)),
      /permission denied/,
    );
  });
});

describe('A pays ₹2,000 and splits it equally with B', () => {
  let expenseId: string;

  it('rejects splits that don’t add up, or include non-friends', async () => {
    const bad = {
      title: 'Dinner',
      total: 2000,
      paid_by: A,
      occurred_on: '2026-10-07',
      split_method: 'amount',
      payer_account_id: bank[A],
      shares: [
        { user_id: A, amount: 1000 },
        { user_id: B, amount: 999 },
      ],
    };
    await expectError(
      as(A, (q) => q(`select create_shared_expense($1::jsonb)`, [JSON.stringify(bad)])),
      /CF655/,
    );
    const stranger = await createUser(db, 'stranger@example.com');
    const notFriend = {
      ...bad,
      shares: [
        { user_id: A, amount: 1000 },
        { user_id: stranger, amount: 1000 },
      ],
    };
    await expectError(
      as(A, (q) => q(`select create_shared_expense($1::jsonb)`, [JSON.stringify(notFriend)])),
      /CF653/,
    );
  });

  it('creates it and books both sides correctly', async () => {
    const p = {
      title: 'Dinner at Absolute Barbecues',
      category_name: 'Food',
      total: 2000,
      paid_by: A,
      occurred_on: '2026-10-07',
      split_method: 'equal',
      payer_account_id: bank[A],
      shares: [
        { user_id: A, amount: 1000 },
        { user_id: B, amount: 1000 },
      ],
    };
    expenseId = await scalar(A, `select create_shared_expense($1::jsonb) as v`, [JSON.stringify(p)]);

    // A: bank −2,000; personal spending 1,000; 1,000 owed to them.
    assert.equal(await balanceOf(A, bank[A]), 48000);
    assert.equal(await spending(A), 1000);
    assert.equal(await friendsBalance(A), 1000);
    assert.equal(await netWith(A, B), 1000);

    // B: bank untouched; spending 1,000; owes A 1,000.
    assert.equal(await balanceOf(B, bank[B]), 50000);
    assert.equal(await spending(B), 1000);
    assert.equal(await friendsBalance(B), -1000);
    assert.equal(await netWith(B, A), -1000);
  });

  it('both see the expense; a third person doesn’t', async () => {
    const forB = await as(B, (q) => q(`select * from shared_expenses where id = $1`, [expenseId]));
    const forC = await as(C, (q) => q(`select * from shared_expenses where id = $1`, [expenseId]));
    assert.equal(forB.length, 1);
    assert.equal(forC.length, 0);
    const card = await as(B, (q) =>
      q<{ kind: string }>(
        `select m.kind from messages m join conversations c on c.id = m.conversation_id where m.shared_expense_id = $1`,
        [expenseId],
      ),
    );
    assert.deepEqual(
      card.map((m) => m.kind),
      ['expense'],
    );
  });

  it('B can’t edit or delete the booked share by hand', async () => {
    await expectError(
      as(B, (q) => q(`update transactions set amount = 1 where shared_expense_id = $1`, [expenseId])),
      /CF701/,
    );
    await expectError(
      as(B, (q) => q(`delete from transactions where shared_expense_id = $1`, [expenseId])),
      /CF701/,
    );
  });

  it('B pays part, then the rest; balances and status update on both sides', async () => {
    await expectError(
      as(B, (q) => q(`select record_settlement($1, 'i_paid', 1500, $2)`, [A, bank[B]])),
      /CF664/,
    );
    const s1 = await scalar(B, `select record_settlement($1, 'i_paid', 600, $2) as v`, [A, bank[B]]);
    assert.equal(await netWith(A, B), 400);
    assert.equal(await netWith(B, A), -400);
    assert.equal(await balanceOf(B, bank[B]), 49400);

    const s2 = await scalar(B, `select record_settlement($1, 'i_paid', 400, $2) as v`, [A, bank[B]]);
    assert.equal(await netWith(A, B), 0);

    // A records receiving both into their bank.
    await as(A, (q) => q(`select book_settlement_side($1, $2)`, [s1, bank[A]]));
    await as(A, (q) => q(`select book_settlement_side($1, $2)`, [s2, bank[A]]));

    assert.equal(await balanceOf(A, bank[A]), 49000);
    assert.equal(await friendsBalance(A), 0);
    assert.equal(await spending(A), 1000);
    assert.equal(await balanceOf(B, bank[B]), 49000);
    assert.equal(await friendsBalance(B), 0);
    assert.equal(await spending(B), 1000);

    const alloc = await as(A, (q) =>
      q<{ total: string }>(
        `select sum(amount)::text as total from settlement_allocations where shared_expense_id = $1`,
        [expenseId],
      ),
    );
    assert.equal(Number(alloc[0].total), 1000);
    // Settled expenses can't be rewritten underneath their settlements.
    await expectError(
      as(A, (q) => q(`select cancel_shared_expense($1)`, [expenseId])),
      /CF658/,
    );
  });
});

describe('netting, linking an SMS payment, cancelling', () => {
  it('nets several expenses between two people', async () => {
    // B pays 900 for A and B (A owes 450); A pays 300 for both (B owes 150): net A owes B 300.
    const e1 = {
      title: 'Cab',
      total: 900,
      paid_by: B,
      occurred_on: '2026-10-08',
      split_method: 'equal',
      payer_account_id: bank[B],
      shares: [
        { user_id: A, amount: 450 },
        { user_id: B, amount: 450 },
      ],
    };
    const e2 = {
      title: 'Coffee',
      total: 300,
      paid_by: A,
      occurred_on: '2026-10-08',
      split_method: 'equal',
      payer_account_id: bank[A],
      shares: [
        { user_id: A, amount: 150 },
        { user_id: B, amount: 150 },
      ],
    };
    await as(B, (q) => q(`select create_shared_expense($1::jsonb)`, [JSON.stringify(e1)]));
    await as(A, (q) => q(`select create_shared_expense($1::jsonb)`, [JSON.stringify(e2)]));
    assert.equal(await netWith(A, B), -300);
    assert.equal(await netWith(B, A), 300);
  });

  it('turns an existing expense into a split without duplicating it, and cancelling restores it', async () => {
    const food = await scalar(
      C,
      `select id as v from transaction_categories where name = 'Food' and parent_id is null`,
    );
    const txn = await scalar(
      C,
      `insert into transactions (type, amount, account_id, category_id, occurred_at, source)
       values ('expense', 3000, $1, $2, now(), 'sms') returning id as v`,
      [bank[C], food],
    );
    const before = await balanceOf(C, bank[C]);
    const p = {
      title: 'Restaurant XYZ',
      category_name: 'Food',
      total: 3000,
      paid_by: C,
      occurred_on: '2026-10-08',
      split_method: 'equal',
      payer_transaction_id: txn,
      shares: [
        { user_id: C, amount: 1000 },
        { user_id: A, amount: 2000 },
      ],
    };
    const id = await scalar(C, `select create_shared_expense($1::jsonb) as v`, [JSON.stringify(p)]);
    assert.equal(await balanceOf(C, bank[C]), before, 'no extra money left the bank');
    assert.equal(
      Number(
        await scalar(
          C,
          `select count(*)::text as v from transactions where type = 'expense' and amount = 3000`,
        ),
      ),
      0,
    );
    assert.equal(await spending(C), 1000);
    assert.equal(await netWith(C, A), 2000);

    await as(C, (q) => q(`select cancel_shared_expense($1)`, [id]));
    assert.equal(await balanceOf(C, bank[C]), before);
    assert.equal(await spending(C), 3000, 'the SMS expense is whole again');
    assert.equal(await netWith(C, A), 0);
  });
});

describe('groups', () => {
  it('creates a group of friends and works out each member’s position', async () => {
    const gid = await scalar(A, `select create_split_group('Goa trip', $1::uuid[]) as v`, [[B, C]]);
    const hotel = {
      group_id: gid,
      title: 'Hotel',
      total: 9000,
      paid_by: A,
      occurred_on: '2026-10-09',
      split_method: 'equal',
      payer_account_id: bank[A],
      shares: [
        { user_id: A, amount: 3000 },
        { user_id: B, amount: 3000 },
        { user_id: C, amount: 3000 },
      ],
    };
    await as(A, (q) => q(`select create_shared_expense($1::jsonb)`, [JSON.stringify(hotel)]));
    const rows = await as(B, (q) =>
      q<{ user_id: string; net: string }>(`select user_id, net::text from group_balances($1)`, [gid]),
    );
    const net = Object.fromEntries(rows.map((r) => [r.user_id, Number(r.net)]));
    assert.equal(net[A], 6000);
    assert.equal(net[B], -3000);
    assert.equal(net[C], -3000);
    // Someone outside the group can't read it.
    const outsider = await createUser(db, 'outsider@example.com');
    await expectError(
      as(outsider, (q) => q(`select * from group_balances($1)`, [gid])),
      /CF404/,
    );
    // Group debts stay in the group, not in person-to-person balances.
    const pos = await as(B, (q) =>
      q<{ net: string }>(`select net::text from my_group_positions() where group_id = $1`, [gid]),
    );
    assert.equal(Number(pos[0].net), -3000);
  });

  it('settles a routed payment the fewest-payments plan suggests', async () => {
    // A paid 3,000 for A and B; B paid 3,000 for B and C. Net: A +1,500, B 0, C −1,500.
    // The plan is "C pays A" — C and A never shared a bill directly.
    const gid = await scalar(A, `select create_split_group('Flat', $1::uuid[]) as v`, [[B, C]]);
    const e = (paid: string, a: string, b: string) => ({
      group_id: gid,
      title: 'Groceries',
      total: 3000,
      paid_by: paid,
      occurred_on: '2026-10-10',
      split_method: 'equal',
      payer_account_id: bank[paid],
      shares: [
        { user_id: a, amount: 1500 },
        { user_id: b, amount: 1500 },
      ],
    });
    await as(A, (q) => q(`select create_shared_expense($1::jsonb)`, [JSON.stringify(e(A, A, B))]));
    await as(B, (q) => q(`select create_shared_expense($1::jsonb)`, [JSON.stringify(e(B, B, C))]));
    const before = await as(A, (q) =>
      q<{ user_id: string; net: string }>(`select user_id, net::text from group_balances($1)`, [gid]),
    );
    const n = Object.fromEntries(before.map((r) => [r.user_id, Number(r.net)]));
    assert.deepEqual([n[A], n[B], n[C]], [1500, 0, -1500]);

    await expectError(
      as(C, (q) => q(`select record_settlement($1, 'i_paid', 1600, $2, $3)`, [A, bank[C], gid])),
      /CF664/,
    );
    await as(C, (q) => q(`select record_settlement($1, 'i_paid', 1500, $2, $3)`, [A, bank[C], gid]));
    const after = await as(A, (q) => q<{ net: string }>(`select net::text from group_balances($1)`, [gid]));
    assert.ok(
      after.every((r) => Number(r.net) === 0),
      'everyone in the group is settled',
    );
  });
});

describe('messaging', () => {
  it('sends, counts unread, marks read, and stays private', async () => {
    const cid = await scalar(A, `select direct_conversation($1) as v`, [B]);
    await as(A, (q) => q(`select send_message($1, 'I paid for dinner, split it here')`, [cid]));
    const list = await as(B, (q) =>
      q<{ unread: number }>(`select unread from list_conversations() where id = $1`, [cid]),
    );
    assert.ok(list[0].unread >= 1);
    await as(B, (q) => q(`select mark_conversation_read($1)`, [cid]));
    const after2 = await as(B, (q) =>
      q<{ unread: number }>(`select unread from list_conversations() where id = $1`, [cid]),
    );
    assert.equal(after2[0].unread, 0);
    const outsider = await as(C, (q) => q(`select * from messages where conversation_id = $1`, [cid]));
    assert.equal(outsider.length, 0);
    await expectError(
      as(C, (q) => q(`select send_message($1, 'hi')`, [cid])),
      /CF404/,
    );
  });
});
