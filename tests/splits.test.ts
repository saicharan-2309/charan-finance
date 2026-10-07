import { summariseGroup } from '@/lib/balance-groups';
import { allocate, minimiseTransfers, splitBill, splitItems } from '@/lib/splits';
import type { Account } from '@/types/domain';

const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
const people = (...ids: string[]) => ids.map((userId) => ({ userId }));

describe('splitBill', () => {
  it('equal: ₹2,400 three ways is ₹800 each', () => {
    const r = splitBill(240000 as never, 'equal', people('me', 'a', 'b'));
    expect(r.ok && r.shares.map((s) => s.amount)).toEqual([80000, 80000, 80000]);
  });

  it('equal: leftover paise go to the first people, and the total always reconciles', () => {
    const r = splitBill(10000 as never, 'equal', people('me', 'a', 'b'));
    expect(r.ok && r.shares.map((s) => s.amount)).toEqual([3334, 3333, 3333]);
    expect(r.ok && sum(r.shares)).toBe(10000);
  });

  it('custom amounts must add up exactly', () => {
    const good = splitBill(240000 as never, 'amount', [
      { userId: 'me', value: 100000 },
      { userId: 'a', value: 70000 },
      { userId: 'b', value: 70000 },
    ]);
    expect(good.ok).toBe(true);
    const short = splitBill(240000 as never, 'amount', [
      { userId: 'me', value: 100000 },
      { userId: 'a', value: 70000 },
    ]);
    expect(short).toEqual({ ok: false, error: '₹700 still to assign.' });
  });

  it('percent: 50/25/25 of ₹2,400', () => {
    const r = splitBill(240000 as never, 'percent', [
      { userId: 'me', value: 50 },
      { userId: 'a', value: 25 },
      { userId: 'b', value: 25 },
    ]);
    expect(r.ok && r.shares.map((s) => s.amount)).toEqual([120000, 60000, 60000]);
    const bad = splitBill(240000 as never, 'percent', [
      { userId: 'me', value: 50 },
      { userId: 'a', value: 40 },
    ]);
    expect(bad.ok).toBe(false);
  });

  it('shares: 2/1/1 of ₹2,400, and awkward totals still reconcile', () => {
    const r = splitBill(240000 as never, 'shares', [
      { userId: 'me', value: 2 },
      { userId: 'a', value: 1 },
      { userId: 'b', value: 1 },
    ]);
    expect(r.ok && r.shares.map((s) => s.amount)).toEqual([120000, 60000, 60000]);
    const odd = splitBill(100001 as never, 'shares', [
      { userId: 'me', value: 3 },
      { userId: 'a', value: 7 },
    ]);
    expect(odd.ok && sum(odd.shares)).toBe(100001);
  });

  it('rejects one person, duplicates and zero totals', () => {
    expect(splitBill(1000 as never, 'equal', people('me')).ok).toBe(false);
    expect(splitBill(1000 as never, 'equal', people('me', 'me')).ok).toBe(false);
    expect(splitBill(0 as never, 'equal', people('me', 'a')).ok).toBe(false);
  });
});

describe('splitItems', () => {
  it('assigns items and spreads tax over everyone', () => {
    const r = splitItems(
      [
        { label: 'Pizza', amount: 80000 as never, userIds: ['me'] },
        { label: 'Burger', amount: 50000 as never, userIds: ['a'] },
        { label: 'Drinks', amount: 30000 as never, userIds: ['b'] },
        { label: 'Tax', amount: 18000 as never, userIds: [] },
      ],
      ['me', 'a', 'b'],
    );
    expect(r.ok && r.shares.map((s) => s.amount)).toEqual([86000, 56000, 36000]);
    expect(r.ok && sum(r.shares)).toBe(178000);
  });
});

describe('allocate', () => {
  it('never loses or invents a paisa', () => {
    for (const total of [1, 7, 100, 99999, 123457]) {
      const parts = allocate(total, [1, 2, 3, 0, 5]);
      expect(parts.reduce((s, v) => s + v, 0)).toBe(total);
      expect(parts[3]).toBe(0);
    }
  });
});

describe('minimiseTransfers', () => {
  it('clears a circular debt with no payments', () => {
    // A owes B 500, B owes C 500, C owes A 500 → everyone nets to zero.
    expect(minimiseTransfers({ A: 0, B: 0, C: 0 })).toEqual([]);
  });

  it('settles a group in at most n − 1 payments', () => {
    const net = { me: 125000, rahul: -125000 + 50000, priya: -80000, arjun: 30000 };
    const out = minimiseTransfers(net);
    expect(out.length).toBeLessThanOrEqual(3);
    const after = { ...net } as Record<string, number>;
    for (const t of out) {
      after[t.from]! += t.amount;
      after[t.to]! -= t.amount;
    }
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });
});

describe('summariseGroup', () => {
  const acc = (over: Partial<Account>): Account =>
    ({
      id: Math.random().toString(),
      name: 'x',
      type: 'bank',
      institution: null,
      last4: null,
      currency: 'INR',
      openingBalance: 0,
      currentBalance: 0,
      creditLimit: null,
      isActive: true,
      includeInNetWorth: true,
      color: null,
      icon: null,
      notes: null,
      sortOrder: 0,
      provider: null,
      statementDay: null,
      dueDay: null,
      minimumDue: null,
      reportedBalance: null,
      reportedBalanceKind: null,
      reportedBalanceAt: null,
      systemKind: null,
      ...over,
    }) as Account;

  it('adds bank balances but never a card limit', () => {
    const s = summariseGroup(
      [
        acc({ type: 'bank', currentBalance: 9800000 as never }),
        acc({ type: 'savings', currentBalance: 7500000 as never }),
        acc({ type: 'credit_card', currentBalance: -2500000 as never, creditLimit: 15000000 as never }),
      ],
      'INR',
    );
    expect(s.cash).toBe(17300000);
    expect(s.owed).toBe(2500000);
    expect(s.availableCredit).toBe(12500000);
  });
});
