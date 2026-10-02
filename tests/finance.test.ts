import {
  applyEffects,
  computeNetWorth,
  creditCardDues,
  liquidBalance,
  transactionEffects,
} from '@/lib/accounts';
import { budgetPeriodBounds, budgetProgress } from '@/lib/budget';
import { availableBalance, projectBalance, upcomingItems } from '@/lib/cashflow';
import { goalProgress } from '@/lib/goals';
import { generateInsights, savingsRate } from '@/lib/insights';
import { toMinor, type Minor } from '@/lib/money';
import type { PeriodSummary, RecurringItem } from '@/types/domain';

const m = (v: string) => toMinor(v);

describe('transaction balance effects (mirror of SQL trigger)', () => {
  it('applies expense, income and transfers', () => {
    expect([
      ...transactionEffects({ type: 'expense', amount: m('249.75'), accountId: 'a', toAccountId: null }),
    ]).toEqual([['a', -24975]]);
    expect([
      ...transactionEffects({ type: 'income', amount: m('100'), accountId: 'a', toAccountId: null }),
    ]).toEqual([['a', 10000]]);
    expect([
      ...transactionEffects({ type: 'transfer', amount: m('8000'), accountId: 'bank', toAccountId: 'card' }),
    ]).toEqual([
      ['bank', -800000],
      ['card', 800000],
    ]);
    expect(() =>
      transactionEffects({ type: 'transfer', amount: 1 as Minor, accountId: 'a', toAccountId: null }),
    ).toThrow();
  });

  it('handles create, edit (incl. account change) and delete', () => {
    let balances = new Map<string, Minor>([
      ['a', m('1000')],
      ['b', m('500')],
    ]);
    const tx = { type: 'expense' as const, amount: m('100'), accountId: 'a', toAccountId: null };
    balances = applyEffects(balances, { after: tx });
    expect(balances.get('a')).toBe(m('900'));
    const edited = { ...tx, accountId: 'b', amount: m('150') };
    balances = applyEffects(balances, { before: tx, after: edited });
    expect(balances.get('a')).toBe(m('1000'));
    expect(balances.get('b')).toBe(m('350'));
    balances = applyEffects(balances, { before: edited });
    expect(balances.get('b')).toBe(m('500'));
  });

  it('a transfer leaves the combined total unchanged', () => {
    const start = new Map<string, Minor>([
      ['bank', m('50000')],
      ['card', m('-8000')],
    ]);
    const next = applyEffects(start, {
      after: { type: 'transfer', amount: m('8000'), accountId: 'bank', toAccountId: 'card' },
    });
    expect(next.get('card')).toBe(0);
    expect((next.get('bank') ?? 0) + (next.get('card') ?? 0)).toBe(m('42000'));
  });
});

describe('net worth', () => {
  const accounts = [
    { type: 'bank' as const, currentBalance: m('84250'), includeInNetWorth: true, currency: 'INR' },
    { type: 'cash' as const, currentBalance: m('1750'), includeInNetWorth: true, currency: 'INR' },
    { type: 'credit_card' as const, currentBalance: m('-12000'), includeInNetWorth: true, currency: 'INR' },
    { type: 'investment' as const, currentBalance: m('5000'), includeInNetWorth: false, currency: 'INR' },
    { type: 'bank' as const, currentBalance: m('300'), includeInNetWorth: true, currency: 'USD' },
    {
      type: 'loan' as const,
      currentBalance: m('-200000'),
      includeInNetWorth: true,
      currency: 'INR',
      isActive: false,
    },
  ];
  it('computes assets minus liabilities and flags other currencies', () => {
    expect(computeNetWorth(accounts, 'INR')).toEqual({
      assets: m('86000'),
      liabilities: m('12000'),
      netWorth: m('74000'),
      excludedCurrencies: ['USD'],
    });
  });
  it('computes liquid balance and card dues', () => {
    expect(liquidBalance(accounts, 'INR')).toBe(m('86000'));
    expect(creditCardDues(accounts, 'INR')).toBe(m('12000'));
  });
});

describe('budgets', () => {
  it('computes period bounds like the database', () => {
    expect(budgetPeriodBounds('monthly', '2026-01-25', null, '2026-03-10')).toEqual({
      start: '2026-02-25',
      end: '2026-03-24',
    });
    expect(budgetPeriodBounds('monthly', '2026-01-01', null, '2026-09-18')).toEqual({
      start: '2026-09-01',
      end: '2026-09-30',
    });
    expect(budgetPeriodBounds('weekly', '2026-09-07', null, '2026-09-20')).toEqual({
      start: '2026-09-14',
      end: '2026-09-20',
    });
    expect(budgetPeriodBounds('yearly', '2026-04-01', null, '2027-03-31')).toEqual({
      start: '2026-04-01',
      end: '2027-03-31',
    });
    expect(budgetPeriodBounds('custom', '2026-09-01', '2026-09-15', '2026-12-01')).toEqual({
      start: '2026-09-01',
      end: '2026-09-15',
    });
    expect(budgetPeriodBounds('monthly', '2026-10-01', null, '2026-09-18')).toEqual({
      start: '2026-10-01',
      end: '2026-10-31',
    });
  });

  it('computes remaining, percentage, projection and status', () => {
    const period = { start: '2026-09-01', end: '2026-09-30' };
    const p = budgetProgress(m('12000'), m('6000'), period, '2026-09-10');
    expect(p.remaining).toBe(m('6000'));
    expect(p.percentUsed).toBe(50);
    expect(p.projected).toBe(m('18000'));
    expect(p.status).toBe('projected_over');
    expect(p.dailyAllowance).toBe(Math.floor(m('6000') / 20));

    expect(budgetProgress(m('12000'), m('10000'), period, '2026-09-28').status).toBe('warning');
    expect(budgetProgress(m('12000'), m('12000.01'), period, '2026-09-28').status).toBe('over');
    expect(budgetProgress(m('12000'), m('2000'), period, '2026-09-15').status).toBe('on_track');
  });
});

describe('savings goals', () => {
  const today = new Date(2026, 8, 18);
  it('computes remaining, required saving and projected completion', () => {
    const g = goalProgress(
      {
        target: m('120000'),
        current: m('72000'),
        targetDate: '2027-03-18',
        recentContributions: m('24000'),
        recentWindowDays: 90,
      },
      today,
    );
    expect(g.remaining).toBe(m('48000'));
    expect(g.percent).toBe(60);
    expect(g.daysLeft).toBe(181);
    expect(g.requiredMonthly).toBe(Math.ceil(m('48000') / (181 / (365.25 / 12))));
    expect(g.requiredWeekly).toBe(Math.ceil(m('48000') / (181 / 7)));
    expect(g.projectedCompletion).toBe('2027-03-17');
    expect(g.onTrack).toBe(true);
  });

  it('handles no pace, overdue and completed goals', () => {
    const none = goalProgress(
      {
        target: m('1000'),
        current: 0 as Minor,
        targetDate: null,
        recentContributions: 0 as Minor,
        recentWindowDays: 90,
      },
      today,
    );
    expect(none.projectedCompletion).toBeNull();
    expect(none.requiredMonthly).toBeNull();
    const overdue = goalProgress(
      {
        target: m('1000'),
        current: m('400'),
        targetDate: '2026-09-01',
        recentContributions: 0 as Minor,
        recentWindowDays: 90,
      },
      today,
    );
    expect(overdue.requiredMonthly).toBe(m('600'));
    expect(overdue.onTrack).toBe(false);
    const done = goalProgress(
      {
        target: m('1000'),
        current: m('1200'),
        targetDate: '2026-12-01',
        recentContributions: 0 as Minor,
        recentWindowDays: 90,
      },
      today,
    );
    expect(done.isComplete).toBe(true);
    expect(done.percent).toBe(100);
    expect(done.remaining).toBe(0);
  });
});

describe('cash-flow projection', () => {
  const base: Omit<
    RecurringItem,
    'id' | 'name' | 'amount' | 'type' | 'accountId' | 'toAccountId' | 'startDate'
  > = {
    kind: 'bill',
    currency: 'INR',
    categoryId: 'c',
    subcategoryId: null,
    merchantId: null,
    notes: null,
    frequency: 'monthly',
    intervalCount: 1,
    endDate: null,
    lastOccurrenceDate: null,
    nextDueDate: null,
    autoPost: false,
    remindDaysBefore: 1,
    isActive: true,
  };
  const recurring: RecurringItem[] = [
    {
      ...base,
      id: 'rent',
      name: 'Rent',
      type: 'expense',
      amount: m('25000'),
      accountId: 'bank',
      toAccountId: null,
      startDate: '2026-09-05',
      lastOccurrenceDate: '2026-09-05',
    },
    {
      ...base,
      id: 'netflix',
      name: 'Netflix',
      type: 'expense',
      kind: 'subscription',
      amount: m('649'),
      accountId: 'card',
      toAccountId: null,
      startDate: '2026-09-25',
    },
    {
      ...base,
      id: 'salary',
      name: 'Salary',
      type: 'income',
      kind: 'general',
      amount: m('125000'),
      accountId: 'bank',
      toAccountId: null,
      startDate: '2026-10-01',
      categoryId: 's',
    },
    {
      ...base,
      id: 'sip',
      name: 'SIP',
      type: 'transfer',
      kind: 'general',
      amount: m('10000'),
      accountId: 'bank',
      toAccountId: 'mf',
      startDate: '2026-09-20',
      categoryId: null,
    },
    {
      ...base,
      id: 'cardpay',
      name: 'Card bill',
      type: 'transfer',
      kind: 'bill',
      amount: m('5000'),
      accountId: 'bank',
      toAccountId: 'card',
      startDate: '2026-09-28',
      categoryId: null,
    },
    {
      ...base,
      id: 'paused',
      name: 'Gym',
      type: 'expense',
      amount: m('2000'),
      accountId: 'bank',
      toAccountId: null,
      startDate: '2026-09-01',
      isActive: false,
    },
  ];
  const liquid = new Set(['bank', 'cash']);

  it('lists upcoming items, marking overdue and actionable ones', () => {
    const items = upcomingItems(recurring, '2026-09-22', '2026-10-31');
    expect(items.map((i) => `${i.recurringId}@${i.date}`)).toEqual([
      'sip@2026-09-20',
      'netflix@2026-09-25',
      'cardpay@2026-09-28',
      'salary@2026-10-01',
      'rent@2026-10-05',
      'sip@2026-10-20',
      'netflix@2026-10-25',
      'cardpay@2026-10-28',
    ]);
    expect(items[0].overdue).toBe(true);
    expect(items.find((i) => i.key === 'sip@2026-10-20'.replace('@', ':'))?.actionable).toBe(false);
  });

  it('projects the liquid balance (card spend does not touch cash until paid)', () => {
    const items = upcomingItems(recurring, '2026-09-22', '2026-10-05');
    const p = projectBalance(m('84250'), items, liquid, '2026-09-22', '2026-10-05');
    // −10,000 SIP (overdue, applied today) −5,000 card payment +1,25,000 salary −25,000 rent
    expect(p.totalOutflow).toBe(m('40000'));
    expect(p.totalInflow).toBe(m('125000'));
    expect(p.endBalance).toBe(m('169250'));
    expect(p.lowestBalance).toBe(m('69250'));
    expect(p.points).toHaveLength(14);
  });

  it('computes available balance after dues and committed outflows', () => {
    const items = upcomingItems(recurring, '2026-09-22', '2026-09-30');
    const avail = availableBalance(m('84250'), m('8000'), items, liquid, new Set(['card']), '2026-09-30');
    // 84,250 − 8,000 card dues − 10,000 SIP (card payment is part of dues)
    expect(avail).toBe(m('66250'));
  });
});

describe('insights', () => {
  const summary = (income: string, expense: string, extra: Partial<PeriodSummary> = {}): PeriodSummary => ({
    income: m(income),
    expense: m(expense),
    net: (m(income) - m(expense)) as Minor,
    transactionCount: 10,
    expenseCount: 8,
    recurringExpense: 0 as Minor,
    subscriptionExpense: 0 as Minor,
    essentialExpense: 0 as Minor,
    discretionaryExpense: 0 as Minor,
    dayCount: 30,
    ...extra,
  });

  it('describes changes using only real numbers', () => {
    const insights = generateInsights({
      currency: 'INR',
      month: { start: '2026-09-01', end: '2026-09-30' },
      today: '2026-09-15',
      current: summary('125000', '31200'),
      previous: summary('120000', '74400'),
      categories: [
        {
          categoryId: 'r',
          name: 'Restaurants',
          icon: null,
          color: null,
          classification: 'discretionary',
          total: m('9280'),
          count: 5,
        },
        {
          categoryId: 's',
          name: 'Shopping',
          icon: null,
          color: null,
          classification: 'discretionary',
          total: m('7176'),
          count: 3,
        },
      ],
      previousCategories: [
        {
          categoryId: 'r',
          name: 'Restaurants',
          icon: null,
          color: null,
          classification: 'discretionary',
          total: m('5000'),
          count: 4,
        },
      ],
      upcomingOutflow30d: m('18500'),
      upcomingCount30d: 3,
    });
    const texts = insights.map((i) => i.text);
    expect(texts).toContain("You've spent ₹4,280 more on Restaurants this month than in all of last month.");
    expect(texts).toContain('Your savings rate increased from 38% to 75%.');
    expect(texts).toContain(
      'You have ₹18,500 of recurring payments coming up in the next 30 days (3 payments).',
    );
    expect(texts).toContain('Restaurants represents 30% of your expenses this month.');
    expect(texts).toContain('Your average daily spending this month is ₹2,080.');
    expect(insights.every((i) => !/invest in|you should buy|recommend/i.test(i.text))).toBe(true);
  });

  it('computes savings rate only when there is income', () => {
    expect(savingsRate({ income: m('125000'), expense: m('62430') })).toBe(50);
    expect(savingsRate({ income: 0 as Minor, expense: m('100') })).toBeNull();
  });
});
