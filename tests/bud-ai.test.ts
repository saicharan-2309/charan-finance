/**
 * BUD AI's tools: dates, money, name matching, and that every tool passes the
 * database's real figures through untouched and turns requests into exact,
 * confirmable actions.
 */
import {
  matchName,
  moneyMonth,
  periods,
  rupees,
  runTool,
  systemPrompt,
  toAmount,
  type AccountLite,
  type CategoryLite,
  type FriendLite,
  type ToolContext,
} from '@/lib/bud-ai';

const ACCOUNTS: AccountLite[] = [
  {
    id: 'a-sav',
    name: 'SBI Savings',
    type: 'savings',
    currentBalance: '48000.00',
    creditLimit: null,
    isActive: true,
    systemKind: null,
  },
  {
    id: 'a-hdfc',
    name: 'HDFC Credit Card',
    type: 'credit_card',
    currentBalance: '-12500.00',
    creditLimit: '100000.00',
    isActive: true,
    systemKind: null,
  },
  {
    id: 'a-fr',
    name: 'Friends',
    type: 'other_asset',
    currentBalance: '1000.00',
    creditLimit: null,
    isActive: true,
    systemKind: 'friends',
  },
];
const CATEGORIES: CategoryLite[] = [
  { id: 'c-food', name: 'Food', kind: 'expense', parentId: null },
  { id: 'c-shop', name: 'Shopping', kind: 'expense', parentId: null },
  { id: 'c-cafe', name: 'Coffee', kind: 'expense', parentId: 'c-food' },
  { id: 'c-sal', name: 'Salary', kind: 'income', parentId: null },
];
const FRIENDS: FriendLite[] = [
  { userId: 'u-rahul', name: 'Rahul Sharma', username: 'rahul', net: '1000.00' },
  { userId: 'u-priya', name: 'Priya', username: 'priya_k', net: '-250.00' },
];

function ctx(rpc: (fn: string, args?: Record<string, unknown>) => unknown = () => []): ToolContext & {
  calls: [string, Record<string, unknown> | undefined][];
} {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  return {
    calls,
    today: '2026-10-08',
    timeZone: 'Asia/Kolkata',
    me: 'u-me',
    rpc: async (fn, args) => {
      calls.push([fn, args]);
      return rpc(fn, args);
    },
    accounts: async () => ACCOUNTS,
    categories: async () => CATEGORIES,
    friends: async () => FRIENDS,
  };
}

describe('dates', () => {
  it('works out every period from today and the payday', () => {
    const p = periods('2026-10-08', 25);
    expect(p.yesterday).toEqual({ start: '2026-10-07', end: '2026-10-07' });
    expect(p.this_week).toEqual({ start: '2026-10-05', end: '2026-10-08' }); // Monday → today
    expect(p.last_week).toEqual({ start: '2026-09-28', end: '2026-10-04' });
    expect(p.last_month).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(p.this_money_month).toEqual({ start: '2026-09-25', end: '2026-10-24' });
    expect(p.last_money_month).toEqual({ start: '2026-08-25', end: '2026-09-24' });
  });

  it('handles a money month across the new year, and calendar months', () => {
    expect(moneyMonth('2026-01-10', 25)).toEqual({ start: '2025-12-25', end: '2026-01-24' });
    expect(moneyMonth('2026-02-10', 1)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
});

describe('money', () => {
  it('formats rupees the Indian way', () => {
    expect(rupees('124499.00')).toBe('₹1,24,499');
    expect(rupees(1250.5)).toBe('₹1,250.50');
    expect(rupees(-638)).toBe('−₹638');
  });
  it('accepts only positive amounts with at most two decimals', () => {
    expect(toAmount('₹1,250')).toBe('1250.00');
    expect(toAmount(500)).toBe('500.00');
    expect(toAmount(0)).toBeNull();
    expect(toAmount(-5)).toBeNull();
    expect(toAmount(1.234)).toBeNull();
    expect(toAmount('abc')).toBeNull();
  });
});

describe('matchName', () => {
  it('prefers exact, then prefix, then a whole word', () => {
    expect(matchName('food', CATEGORIES, (c) => c.name)).toEqual({ kind: 'one', item: CATEGORIES[0] });
    expect(matchName('hdfc', ACCOUNTS, (a) => a.name)).toMatchObject({ kind: 'one', item: { id: 'a-hdfc' } });
    expect(matchName('rahul', FRIENDS, (f) => f.name)).toMatchObject({
      kind: 'one',
      item: { userId: 'u-rahul' },
    });
    expect(matchName('zzz', CATEGORIES, (c) => c.name)).toEqual({ kind: 'none' });
  });
});

describe('read tools pass the real figures through', () => {
  it('spending by category: exact amounts and shares from the database', async () => {
    const c = ctx((fn) =>
      fn === 'report_by_category'
        ? [
            { category_id: 'c-food', name: 'Food', total: '8420.00', tx_count: 12 },
            { category_id: 'c-shop', name: 'Shopping', total: '2105.00', tx_count: 3 },
          ]
        : [],
    );
    const out = await runTool('spending_by_category', { start: '2026-09-01', end: '2026-09-30' }, c);
    expect(c.calls).toEqual([
      ['report_by_category', { p_start: '2026-09-01', p_end: '2026-09-30', p_kind: 'expense' }],
    ]);
    expect(out.result).toMatchObject({
      total: '₹10,525',
      categories: [
        { category: 'Food', amount: '₹8,420', share_percent: 80, count: 12 },
        { category: 'Shopping', amount: '₹2,105', share_percent: 20, count: 3 },
      ],
    });
    expect(out.label).toBe('Spending by category, 1 Sept – 30 Sept');
  });

  it('refuses a malformed range instead of guessing', async () => {
    const c = ctx();
    const out = await runTool('get_summary', { start: 'last month', end: '2026-09-30' }, c);
    expect(out.result).toEqual({ error: 'start and end must be dates as YYYY-MM-DD' });
    expect(c.calls).toEqual([]);
  });

  it('accounts: a credit limit is never counted as money you have', async () => {
    const out = await runTool('get_accounts', {}, ctx());
    expect(out.result).toEqual({
      payment_methods: [
        { name: 'SBI Savings', type: 'Savings account', balance: '₹48,000' },
        {
          name: 'HDFC Credit Card',
          type: 'Credit card',
          owed: '₹12,500',
          credit_limit: '₹1,00,000',
          available_credit: '₹87,500',
        },
      ],
      cash_total: '₹48,000',
    });
  });

  it('friends: who owes what, from the shared-expense balances', async () => {
    const c = ctx((fn) =>
      fn === 'my_group_positions' ? [{ group_id: 'g', name: 'Goa trip', net: '-1500.00' }] : [],
    );
    const out = await runTool('get_friends', {}, c);
    expect(out.result).toMatchObject({
      friends: [
        { name: 'Rahul Sharma', username: '@rahul', balance: 'owes you ₹1,000' },
        { name: 'Priya', username: '@priya_k', balance: 'you owe ₹250' },
      ],
      friends_owe_you_total: '₹1,000',
      you_owe_friends_total: '₹250',
      groups: [{ group: 'Goa trip', position: 'you owe ₹1,500' }],
    });
  });

  it('search resolves names to ids and filters in the database', async () => {
    const c = ctx(() => []);
    await runTool(
      'search_transactions',
      { start: '2026-10-07', end: '2026-10-07', text: 'amazon', account: 'hdfc', category: 'shopping' },
      c,
    );
    expect(c.calls[0]).toEqual([
      'ai_search_transactions',
      {
        p_limit: 20,
        p_start: '2026-10-07',
        p_end: '2026-10-07',
        p_text: 'amazon',
        p_category_id: 'c-shop',
        p_account_id: 'a-hdfc',
      },
    ]);
  });
});

describe('proposals — nothing is written, the app confirms', () => {
  it('"Record ₹500 spent at Starbucks" asks which account when there are several', async () => {
    const c = ctx();
    const out = await runTool(
      'propose_transaction',
      { type: 'expense', amount: 500, merchant: 'Starbucks', category: 'food' },
      c,
    );
    expect(out.action).toBeUndefined();
    expect(out.result).toEqual({
      needs_input: 'which payment method?',
      options: ['SBI Savings', 'HDFC Credit Card'],
    });
    expect(c.calls).toEqual([]); // no database writes, no reads beyond the lists
  });

  it('insists on a category — the database requires one for every expense', async () => {
    const out = await runTool('propose_transaction', { type: 'expense', amount: 500, account: 'sbi' }, ctx());
    expect(out.action).toBeUndefined();
    expect(out.result).toEqual({
      error: 'category is required — choose the closest category for this',
      options: ['Food', 'Shopping'],
    });
  });

  it('builds an exact expense once the account is known', async () => {
    const out = await runTool(
      'propose_transaction',
      { type: 'expense', amount: '1,250', merchant: 'Amazon', category: 'shopping', account: 'HDFC' },
      ctx(),
    );
    expect(out.action).toEqual({
      kind: 'create_transaction',
      type: 'expense',
      amount: '1250.00',
      accountId: 'a-hdfc',
      accountName: 'HDFC Credit Card',
      categoryId: 'c-shop',
      categoryName: 'Shopping',
      merchantName: 'Amazon',
      occurredOn: '2026-10-08',
      notes: null,
      summary: 'Expense ₹1,250 · Amazon · Shopping · HDFC Credit Card',
    });
  });

  it('"Add ₹2,000 salary income" lands in the only bank account, never a card', async () => {
    const out = await runTool(
      'propose_transaction',
      { type: 'income', amount: 2000, category: 'salary' },
      ctx(),
    );
    expect(out.action).toMatchObject({
      kind: 'create_transaction',
      type: 'income',
      amount: '2000.00',
      accountId: 'a-sav',
      categoryId: 'c-sal',
    });
  });

  it('refuses future dates and bad amounts', async () => {
    expect(
      (
        await runTool(
          'propose_transaction',
          { type: 'expense', amount: 10, date: '2026-12-01', account: 'sbi' },
          ctx(),
        )
      ).result,
    ).toEqual({ error: 'that date is in the future' });
    expect((await runTool('propose_transaction', { type: 'expense', amount: -10 }, ctx())).result).toEqual({
      error: 'amount must be a positive number of rupees',
    });
  });

  it('"Change my Amazon transaction from yesterday to Shopping" targets that exact row', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const c = ctx((fn, args) =>
      fn === 'ai_search_transactions' && args?.p_id === id
        ? [
            {
              id,
              occurred_at: '2026-10-07T09:00:00Z',
              type: 'expense',
              amount: '1250.00',
              merchant_name: 'Amazon',
              category_id: 'c-food',
              category_name: 'Food',
              subcategory_name: null,
              account_name: 'HDFC Credit Card',
              to_account_name: null,
              notes: null,
              source: 'sms',
              shared_expense_id: null,
            },
          ]
        : [],
    );
    const out = await runTool('propose_update_transaction', { transaction_id: id, category: 'Shopping' }, c);
    expect(c.calls).toEqual([['ai_search_transactions', { p_id: id, p_limit: 1 }]]);
    expect(out.action).toEqual({
      kind: 'update_transaction',
      transactionId: id,
      categoryId: 'c-shop',
      categoryName: 'Shopping',
      summary: 'Amazon · ₹1,250 · 7 Oct: category → Shopping',
    });
  });

  it('won’t touch a transaction that isn’t the user’s (not found under their login)', async () => {
    const out = await runTool(
      'propose_update_transaction',
      { transaction_id: '99999999-2222-3333-4444-555555555555', category: 'Shopping' },
      ctx(() => []),
    );
    expect(out.action).toBeUndefined();
    expect(out.result).toEqual({ error: 'no transaction with that id — search again' });
  });

  it('splits a bill equally with a friend, to the paisa', async () => {
    const out = await runTool(
      'propose_split_with_friend',
      { friend: '@rahul', amount: 2000, title: 'Dinner', account: 'sbi' },
      ctx(),
    );
    expect(out.action).toMatchObject({
      kind: 'split_with_friend',
      friendId: 'u-rahul',
      total: '2000.00',
      accountId: 'a-sav',
      summary:
        'Dinner · ₹2,000 paid from SBI Savings, split equally with Rahul Sharma — your share ₹1,000, Rahul Sharma owes you ₹1,000',
    });
  });
});

it('the system prompt binds every figure to the tools and spells out the periods', () => {
  const p = systemPrompt('2026-10-08', 'Asia/Kolkata', 25, 'Charan');
  expect(p).toContain('Every amount, count or comparison you state must come from a tool result');
  expect(p).toContain('last_month: 2026-09-01 to 2026-09-30');
  expect(p).toContain('this_money_month: 2026-09-25 to 2026-10-24');
  expect(p).toContain('Never claim something is saved');
});
