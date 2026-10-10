/**
 * BUD AI (in-app engine): real sentences in, answers built only from the data
 * it looked up, and changes only as proposals to confirm.
 */
import { EMPTY_CONVERSATION, respond, type AssistantData, type TxnHit } from '@/lib/assistant/engine';
import { classify, parseAmount, parsePeriod } from '@/lib/assistant/language';
import type { Account, Category, CategoryTotal, PeriodSummary } from '@/types/domain';

const TODAY = '2026-10-08'; // a Thursday

const cat = (id: string, name: string, kind: 'expense' | 'income' = 'expense'): Category => ({
  id,
  parentId: null,
  name,
  kind,
  classification: null,
  icon: null,
  color: null,
  isArchived: false,
  sortOrder: 0,
});
const CATS = [
  cat('c-food', 'Food'),
  cat('c-shop', 'Shopping'),
  cat('c-trans', 'Transport'),
  cat('c-sal', 'Salary', 'income'),
];
const acct = (id: string, name: string, type: string, balance: number, limit: number | null = null) =>
  ({
    id,
    name,
    type,
    currentBalance: balance,
    creditLimit: limit,
    isActive: true,
    systemKind: null,
  }) as unknown as Account;
const ACCOUNTS = [
  acct('a-sbi', 'SBI Savings', 'savings', 4800000),
  acct('a-hdfc', 'HDFC Credit Card', 'credit_card', -1250000, 10000000),
  { ...acct('a-fr', 'Friends', 'other_asset', 100000), systemKind: 'friends' } as Account,
];
const summary = (expense: number, income = 0, expenseCount = 3): PeriodSummary => ({
  income: income as never,
  expense: expense as never,
  net: (income - expense) as never,
  transactionCount: expenseCount,
  expenseCount,
  recurringExpense: 0 as never,
  subscriptionExpense: 0 as never,
  essentialExpense: 0 as never,
  discretionaryExpense: 0 as never,
  dayCount: 30,
});
const ct = (categoryId: string, name: string, total: number, count = 1): CategoryTotal => ({
  categoryId,
  name,
  total: total as never,
  count,
  icon: null,
  color: null,
  classification: null,
});
const txn = (id: string, day: string, merchant: string, amount: number, categoryId = 'c-food'): TxnHit => ({
  id,
  occurredAt: `${day}T06:00:00.000Z`,
  day,
  type: 'expense',
  amount: amount as never,
  merchant,
  categoryId,
  category: CATS.find((c) => c.id === categoryId)!.name,
  account: 'HDFC Credit Card',
  sharedExpenseId: null,
});

function fake(over: Partial<AssistantData> = {}) {
  const calls: string[] = [];
  const log =
    <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    (...a: A) => {
      calls.push(`${name} ${JSON.stringify(a)}`);
      return fn(...a);
    };
  const data: AssistantData = {
    today: TODAY,
    cycleStartDay: 1,
    currency: 'INR',
    summary: log('summary', async (r) =>
      r.start === '2026-09-01' ? summary(3990500, 8500000, 42) : summary(3200000, 8500000, 30),
    ),
    byCategory: log('byCategory', async (r, kind) =>
      kind === 'income'
        ? [ct('c-sal', 'Salary', 8500000)]
        : r.start === '2026-09-01'
          ? [ct('c-food', 'Food', 842000, 12), ct('c-shop', 'Shopping', 210500, 3)]
          : [ct('c-food', 'Food', 600000, 9), ct('c-shop', 'Shopping', 450000, 4)],
    ),
    byMerchant: log('byMerchant', async () => [
      {
        merchantId: 'm1',
        name: 'Amazon',
        total: 125000 as never,
        count: 2,
        average: 62500 as never,
        largest: 100000 as never,
      },
    ]),
    byAccount: log('byAccount', async () => []),
    totals: log('totals', async (f) => {
      const zero = { income: 0 as never, expense: 0 as never, count: 0, expenseCount: 0 };
      if (f.from) return { ...zero, expense: 45000 as never, count: 1, expenseCount: 1 };
      if (f.categoryId) {
        return f.categoryId === 'c-food' && f.range.start === '2026-09-01'
          ? { ...zero, expense: 842000 as never, count: 12, expenseCount: 12 }
          : zero;
      }
      if (f.accountIds?.length) {
        return { ...zero, expense: (215200 * f.accountIds.length) as never, count: 2, expenseCount: 2 };
      }
      return f.range.start === '2026-09-01'
        ? { income: 8500000 as never, expense: 3990500 as never, count: 44, expenseCount: 42 }
        : { income: 8500000 as never, expense: 3200000 as never, count: 32, expenseCount: 30 };
    }),
    search: log('search', async () => []),
    accounts: async () => ACCOUNTS,
    categories: async () => CATS,
    friends: async () => [
      { userId: 'u-rahul', name: 'Rahul Sharma', username: 'rahul', net: 100000 as never },
      { userId: 'u-priya', name: 'Priya', username: 'priya_k', net: -25000 as never },
    ],
    groups: async () => [],
    ...over,
  };
  return { data, calls };
}

describe('language', () => {
  it('reads amounts the Indian way', () => {
    expect(parseAmount('Record ₹1,250 spent at Amazon')).toBe(125000);
    expect(parseAmount('spent rs 500 on food')).toBe(50000);
    expect(parseAmount('add 2k salary')).toBe(200000);
    expect(parseAmount('got 1.5 lakh bonus')).toBe(15000000);
    expect(parseAmount('show my last 5 transactions')).toBeNull();
    expect(parseAmount('what did I spend on 5th october')).toBeNull();
  });

  it('reads periods, against the payday month', () => {
    expect(parsePeriod('last month', TODAY, 1)).toMatchObject({ start: '2026-09-01', end: '2026-09-30' });
    expect(parsePeriod('last month', TODAY, 25)).toMatchObject({ start: '2026-08-25', end: '2026-09-24' });
    expect(parsePeriod('yesterday', TODAY, 1)).toMatchObject({ start: '2026-10-07', end: '2026-10-07' });
    expect(parsePeriod('this week', TODAY, 1)).toMatchObject({ start: '2026-10-05', end: TODAY });
    expect(parsePeriod('spent in September', TODAY, 1)).toMatchObject({
      start: '2026-09-01',
      end: '2026-09-30',
      label: 'September',
    });
    expect(parsePeriod('in december', TODAY, 1)).toMatchObject({ start: '2025-12-01' }); // most recent December
    expect(parsePeriod('last 7 days', TODAY, 1)).toMatchObject({ start: '2026-10-02', end: TODAY });
    expect(parsePeriod('may I see my spending', TODAY, 1)).toBeNull();
    expect(parsePeriod('todays expense', TODAY, 1)).toMatchObject({
      start: TODAY,
      end: TODAY,
      label: 'today',
    });
    expect(parsePeriod('day before yesterday', TODAY, 1)).toMatchObject({ start: '2026-10-06' });
    expect(parsePeriod('on 5th October', TODAY, 1)).toMatchObject({ start: '2026-10-05', end: '2026-10-05' });
    expect(parsePeriod('october 5', TODAY, 1)).toMatchObject({ start: '2026-10-05' });
    expect(parsePeriod('on 5/10', TODAY, 1)).toMatchObject({ start: '2026-10-05' });
    expect(parsePeriod('last 2 weeks', TODAY, 1)).toMatchObject({ start: '2026-09-25', end: TODAY });
    const now = new Date('2026-10-08T10:30:00Z');
    const hour = parsePeriod('in the last one hour', TODAY, 1, now)!;
    expect([hour.from, hour.to]).toEqual(['2026-10-08T09:30:00.000Z', '2026-10-08T10:30:00.000Z']);
    const mins = parsePeriod('past 30 minutes', TODAY, 1, now)!;
    expect(mins.from).toBe('2026-10-08T10:00:00.000Z');
    expect(parsePeriod('last 3 hours', TODAY, 1, now)!.from).toBe('2026-10-08T07:30:00.000Z');
  });

  it('tells questions from requests', () => {
    expect(classify('What was my food expense last month?').kind).toBe('spend');
    expect(classify('How much do my friends owe me?').kind).toBe('friends');
    expect(classify('Why did my spending increase?').kind).toBe('compare');
    expect(classify('Record ₹500 spent at Starbucks')).toEqual({ kind: 'create', type: 'expense' });
    expect(classify('Add ₹2,000 salary income')).toEqual({ kind: 'create', type: 'income' });
    expect(classify('Change my Amazon transaction from yesterday to Shopping').kind).toBe('recategorise');
    expect(classify('Where did most of my money go?').kind).toBe('breakdown');
    expect(classify('What are my balances?').kind).toBe('balances');
  });
});

describe('answers come from the data it looked up', () => {
  it('"What was my food expense last month?"', async () => {
    const { data, calls } = fake();
    const { reply } = await respond('What was my food expense last month?', EMPTY_CONVERSATION, data);
    expect(calls).toEqual([
      'totals [{"range":{"start":"2026-09-01","end":"2026-09-30","label":"last month"},"categoryId":"c-food"}]',
    ]);
    expect(reply.text).toBe('You spent ₹8,420 on Food last month (1 Sep – 30 Sep), across 12 payments.');
    expect(reply.actions).toEqual([]);
  });

  it('"What did I spend last month?" — total and biggest categories', async () => {
    const { reply } = await respond('What did I spend last month?', EMPTY_CONVERSATION, fake().data);
    expect(reply.text).toBe(
      'You spent ₹39,905 last month (1 Sep – 30 Sep), across 42 payments. Your biggest categories:',
    );
    expect(reply.lines).toEqual([
      { label: 'Food', value: '₹8,420 · 21%' },
      { label: 'Shopping', value: '₹2,105 · 5%' },
    ]);
  });

  it('a merchant: "How much did I spend at Amazon this month?"', async () => {
    const { reply } = await respond(
      'How much did I spend at Amazon this month?',
      EMPTY_CONVERSATION,
      fake().data,
    );
    expect(reply.text).toBe(
      'You spent ₹1,250 at Amazon this month (1 Oct – 31 Oct), across 2 payments (largest ₹1,000).',
    );
  });

  it('"Why did my spending increase?" compares like for like and names the causes', async () => {
    const { data, calls } = fake({
      summary: async (r) => (r.start === '2026-10-01' ? summary(1200000) : summary(1000000)),
      byCategory: async (r) =>
        r.start === '2026-10-01'
          ? [ct('c-food', 'Food', 800000), ct('c-shop', 'Shopping', 400000)]
          : [ct('c-food', 'Food', 500000), ct('c-shop', 'Shopping', 500000)],
    });
    const { reply } = await respond('Why did my spending increase?', EMPTY_CONVERSATION, data);
    expect(calls).toEqual([]); // overridden functions aren't logged
    expect(reply.text).toBe(
      'You spent ₹12,000 this month (1 Oct – 8 Oct) — 20% more than by this point last month (₹10,000, 1 Sep – 8 Sep). Biggest increases:',
    );
    expect(reply.lines[0]).toEqual({ label: 'Food', value: '+₹3,000 (₹8,000 vs ₹5,000)' });
  });

  it('balances never count a card limit as money', async () => {
    const { reply } = await respond('What are my balances?', EMPTY_CONVERSATION, fake().data);
    expect(reply.text).toBe(
      'You have ₹48,000 across 1 bank, cash or wallet account, and owe ₹12,500 on credit cards — a card limit isn’t counted as money you have.',
    );
    expect(reply.lines).toContainEqual({
      label: 'HDFC Credit Card',
      value: '₹12,500 owed · ₹87,500 available',
    });
    expect(reply.lines.find((l) => l.label === 'Friends')).toBeUndefined();
  });

  it('friends: one person, or everyone', async () => {
    const { data } = fake();
    expect((await respond('How much does Rahul owe me?', EMPTY_CONVERSATION, data)).reply.text).toBe(
      'Rahul Sharma owes you ₹1,000.',
    );
    expect((await respond('How much do my friends owe me?', EMPTY_CONVERSATION, data)).reply.text).toBe(
      'People owe you ₹1,000, and you owe ₹250.',
    );
  });

  it('includes people from Lent & borrowed, not only BUD friends', async () => {
    const { data } = fake({ ious: async () => [{ person: 'Ravi', net: 500000 as never }] });
    expect((await respond('How much does Ravi owe me?', EMPTY_CONVERSATION, data)).reply.text).toBe(
      'Ravi owes you ₹5,000.',
    );
    expect((await respond('how much do people owe me', EMPTY_CONVERSATION, data)).reply.text).toBe(
      'People owe you ₹6,000, and you owe ₹250.',
    );
  });

  it('says so when there is nothing, instead of inventing a figure', async () => {
    const { data } = fake({ byCategory: async () => [] });
    expect(
      (await respond('How much did I spend on transport last month?', EMPTY_CONVERSATION, data)).reply.text,
    ).toBe('You haven’t spent anything on Transport last month (1 Sep – 30 Sep).');
  });

  it('your real cards: "credit card" and "Axis bank credit card" are the Axis card, not a shop', async () => {
    const real = [
      acct('a1', 'Axis account', 'savings', 9795200),
      acct('a2', 'Axis credit card', 'credit_card', -215200, 40000000),
    ].map((a, i) => ({
      ...a,
      provider: 'axis',
      institution: i ? 'Axis bank' : 'Axis Bank',
      last4: i ? '1205' : '6202',
    }));
    const { data, calls } = fake({ accounts: async () => real as never });
    for (const q of [
      'How much did I spend on credit card',
      'how much did i spend on axis bank credit card',
      'how much did I spend on the card ending 1205',
    ]) {
      calls.length = 0;
      const { reply } = await respond(q, EMPTY_CONVERSATION, data);
      expect([q, reply.text]).toEqual([
        q,
        'You spent ₹2,152 with Axis credit card this month (1 Oct – 31 Oct), across 2 payments.',
      ]);
      expect(calls[0]).toContain('"accountIds":["a2"]');
    }
    const { reply } = await respond(
      'how much did I spend from my axis account this week',
      EMPTY_CONVERSATION,
      data,
    );
    expect(reply.text).toBe(
      'You spent ₹2,152 with Axis account this week (5 Oct – 8 Oct), across 2 payments.',
    );
  });

  it('"my credit cards" with two cards covers both', async () => {
    const two = [
      acct('c1', 'Axis credit card', 'credit_card', 0, 1),
      acct('c2', 'HDFC Millennia', 'credit_card', 0, 1),
      acct('s1', 'Axis account', 'savings', 0),
    ];
    const { data, calls } = fake({ accounts: async () => two });
    const { reply } = await respond('how much did I spend on my credit cards', EMPTY_CONVERSATION, data);
    expect(reply.text).toBe(
      'You spent ₹4,304 with your credit cards this month (1 Oct – 31 Oct), across 2 payments.',
    );
    expect(calls[0]).toContain('"accountIds":["c1","c2"]');
  });

  it('"todays expense" is today, not the month', async () => {
    const { data, calls } = fake();
    await respond('what is todays expense', EMPTY_CONVERSATION, data);
    expect(calls[0]).toContain('"start":"2026-10-08","end":"2026-10-08"');
  });

  it('"in the last one hour" is the last hour, to the minute', async () => {
    const { data, calls } = fake();
    const { reply } = await respond('how much did i spend in the last one hour', EMPTY_CONVERSATION, data);
    expect(reply.text).toMatch(
      /^You spent ₹450 the last hour \(since \d{1,2}:\d{2} [ap]m\), across 1 payment\.$/,
    );
    const sent = JSON.parse(calls[0]!.slice('totals '.length))[0];
    expect(Date.parse(sent.to) - Date.parse(sent.from)).toBe(3_600_000);
  });

  it('asks instead of guessing when it can’t read the period', async () => {
    const { data, calls } = fake();
    const { reply } = await respond('how much did i spend since diwali', EMPTY_CONVERSATION, data);
    expect(reply.text).toMatch(/^I couldn’t tell which period you mean/);
    expect(calls).toEqual([]);
  });

  it('offers what it can do when it doesn’t understand', async () => {
    const { reply } = await respond('tell me a joke', EMPTY_CONVERSATION, fake().data);
    expect(reply.text).toMatch(/^I didn’t catch that/);
    expect(reply.choices.length).toBeGreaterThan(3);
  });
});

describe('changes are proposals, finished by asking', () => {
  it('"Record ₹500 spent at Starbucks": files it under Food, asks which card, then proposes', async () => {
    const { data } = fake();
    const first = await respond('Record ₹500 spent at Starbucks', EMPTY_CONVERSATION, data);
    expect(first.reply.text).toBe('What did you pay with?');
    expect(first.reply.choices).toEqual([
      { label: 'SBI Savings', value: '§account:a-sbi' },
      { label: 'HDFC Credit Card', value: '§account:a-hdfc' },
    ]);
    expect(first.reply.actions).toEqual([]);
    const second = await respond('§account:a-hdfc', first.convo, data);
    expect(second.reply.actions).toEqual([
      {
        kind: 'create_transaction',
        type: 'expense',
        amount: 50000,
        accountId: 'a-hdfc',
        accountName: 'HDFC Credit Card',
        categoryId: 'c-food',
        categoryName: 'Food',
        merchantName: 'Starbucks',
        occurredOn: TODAY,
        summary: 'Expense ₹500 · Starbucks · Food · HDFC Credit Card',
      },
    ]);
    expect(second.convo.pending).toBeNull();
  });

  it('"Add ₹2,000 salary income" goes to the only bank account, never the card', async () => {
    const { reply } = await respond('Add ₹2,000 salary income', EMPTY_CONVERSATION, fake().data);
    expect(reply.actions[0]).toMatchObject({
      kind: 'create_transaction',
      type: 'income',
      amount: 200000,
      accountId: 'a-sbi',
      categoryId: 'c-sal',
    });
  });

  it('asks for a category it can’t tell, from the user’s own list', async () => {
    const { reply } = await respond('spent ₹300 at Xyz Traders with hdfc', EMPTY_CONVERSATION, fake().data);
    expect(reply.text).toBe('Which category is ₹300 at Xyz Traders?');
    expect(reply.choices.map((c) => c.label)).toEqual(['Food', 'Shopping', 'Transport']);
  });

  it('"Change my Amazon transaction from yesterday to Shopping" finds exactly that one', async () => {
    const searches: unknown[] = [];
    const { data } = fake({
      search: async (f) => {
        searches.push(f);
        return [txn('t-amz', '2026-10-07', 'Amazon', 125000)];
      },
    });
    const { reply } = await respond(
      'Change my Amazon transaction from yesterday to Shopping',
      EMPTY_CONVERSATION,
      data,
    );
    expect(searches).toEqual([
      { range: { start: '2026-10-07', end: '2026-10-07', label: 'yesterday' }, text: 'Amazon', limit: 6 },
    ]);
    expect(reply.actions).toEqual([
      {
        kind: 'update_transaction',
        transactionId: 't-amz',
        categoryId: 'c-shop',
        categoryName: 'Shopping',
        summary: 'Amazon · ₹1,250 · 7 Oct: Food → Shopping',
      },
    ]);
  });

  it('"Mark this as Shopping" after a list asks which, then proposes', async () => {
    const hits = [txn('t1', '2026-10-07', 'Amazon', 125000), txn('t2', '2026-10-06', 'Swiggy', 45000)];
    const { data } = fake({ search: async () => hits });
    const listed = await respond('Show my recent transactions', EMPTY_CONVERSATION, data);
    expect(listed.reply.lines).toEqual([
      { label: '7 Oct · Amazon · Food', value: '₹1,250' },
      { label: '6 Oct · Swiggy · Food', value: '₹450' },
    ]);
    const which = await respond('Mark this as Shopping', listed.convo, data);
    expect(which.reply.text).toBe('Which one?');
    const done = await respond('§transaction:t2', which.convo, data);
    expect(done.reply.actions[0]).toMatchObject({ transactionId: 't2', categoryId: 'c-shop' });
  });

  it('"Split ₹2,000 for dinner with Rahul" — equal shares, to the paisa', async () => {
    const { reply } = await respond(
      'Split ₹2,000 for dinner with Rahul from sbi',
      EMPTY_CONVERSATION,
      fake().data,
    );
    expect(reply.actions).toEqual([
      expect.objectContaining({
        kind: 'split_with_friend',
        friendId: 'u-rahul',
        total: 200000,
        title: 'Dinner',
        accountId: 'a-sbi',
        summary:
          'Dinner · ₹2,000 paid from SBI Savings, split equally — your share ₹1,000, Rahul Sharma owes you ₹1,000',
      }),
    ]);
  });

  it('asks for the day rather than guessing one when given only a month', async () => {
    const r = await respond(
      'Record ₹500 spent on food in December with hdfc',
      EMPTY_CONVERSATION,
      fake().data,
    );
    expect(r.reply.actions).toEqual([]);
    expect(r.reply.text).toMatch(/^Which day was it\?/);
  });

  it('dates "yesterday" correctly', async () => {
    const r = await respond('spent ₹120 on food yesterday with hdfc', EMPTY_CONVERSATION, fake().data);
    expect(r.reply.actions[0]).toMatchObject({
      occurredOn: '2026-10-07',
      categoryId: 'c-food',
      amount: 12000,
    });
  });
});
