import {
  balanceDisplay,
  canSpendFrom,
  cardDates,
  cardStanding,
  dayInMonth,
  fieldsFor,
  groupAccounts,
  isMoveNotSpend,
  nextMonthlyDay,
  providerByKey,
  providersFor,
  transactionFlow,
  accountVisual,
} from '@/lib/payment-methods';
import { toMinor, type Minor } from '@/lib/money';
import type { Account, AccountType } from '@/types/domain';

const m = (v: string) => toMinor(v);

function account(over: Partial<Account> & { type: AccountType }): Account {
  return {
    id: over.name ?? over.type,
    name: over.type,
    institution: null,
    last4: null,
    currency: 'INR',
    openingBalance: 0 as Minor,
    currentBalance: 0 as Minor,
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
  };
}

describe('credit card standing', () => {
  it('derives used, available and utilisation from the balance and limit', () => {
    const card = account({ type: 'credit_card', currentBalance: m('-18450'), creditLimit: m('100000') });
    const s = cardStanding(card);
    expect(s.used).toBe(1845000);
    expect(s.available).toBe(8155000);
    expect(s.utilisation).toBeCloseTo(0.1845, 4);
    expect(s.inCredit).toBe(0);
  });

  it('treats an overpaid card as being in credit, never as negative debt', () => {
    const s = cardStanding(
      account({ type: 'credit_card', currentBalance: m('1200'), creditLimit: m('50000') }),
    );
    expect(s.used).toBe(0);
    expect(s.inCredit).toBe(120000);
    expect(s.available).toBe(5000000);
  });

  it('reports no available credit when no limit is recorded', () => {
    const s = cardStanding(account({ type: 'credit_card', currentBalance: m('-500') }));
    expect(s.available).toBeNull();
    expect(s.utilisation).toBeNull();
  });

  it('never shows available credit below zero when the limit is exceeded', () => {
    const s = cardStanding(
      account({ type: 'credit_card', currentBalance: m('-120000'), creditLimit: m('100000') }),
    );
    expect(s.available).toBe(0);
    expect(s.utilisation).toBeGreaterThan(1);
  });
});

describe('what a row displays', () => {
  it('shows a balance for assets and an amount owed for liabilities', () => {
    expect(balanceDisplay(account({ type: 'savings', currentBalance: m('84250') }))).toEqual({
      amount: 8425000,
      caption: null,
    });
    expect(balanceDisplay(account({ type: 'credit_card', currentBalance: m('-18450') }))).toEqual({
      amount: 1845000,
      caption: 'used',
    });
    expect(balanceDisplay(account({ type: 'credit_card', currentBalance: 0 as Minor })).caption).toBe(
      'nothing owed',
    );
    expect(balanceDisplay(account({ type: 'loan', currentBalance: m('-250000') }))).toEqual({
      amount: 25000000,
      caption: 'owed',
    });
  });

  it('lets money be spent from liquid accounts and cards, but not from investments or loans', () => {
    expect(canSpendFrom(account({ type: 'savings' }))).toBe(true);
    expect(canSpendFrom(account({ type: 'cash' }))).toBe(true);
    expect(canSpendFrom(account({ type: 'wallet' }))).toBe(true);
    expect(canSpendFrom(account({ type: 'debit_card' }))).toBe(true);
    expect(canSpendFrom(account({ type: 'credit_card' }))).toBe(true);
    expect(canSpendFrom(account({ type: 'investment' }))).toBe(false);
    expect(canSpendFrom(account({ type: 'loan' }))).toBe(false);
    expect(canSpendFrom(account({ type: 'cash', isActive: false }))).toBe(false);
  });
});

describe('fields per payment method type', () => {
  it('asks a credit card for a limit and billing dates', () => {
    const f = fieldsFor('credit_card');
    expect(f.creditLimit).toBe(true);
    expect(f.billingDates).toBe(true);
    expect(f.last4).toBe(true);
  });

  it('never asks cash or a wallet for a limit, billing date or card digits', () => {
    for (const t of ['cash', 'wallet'] as AccountType[]) {
      const f = fieldsFor(t);
      expect(f.creditLimit).toBe(false);
      expect(f.billingDates).toBe(false);
      expect(f.last4).toBe(false);
    }
    // A UPI wallet still gets to say which app it is.
    expect(fieldsFor('wallet').provider).toBe(true);
    expect(fieldsFor('cash').provider).toBe(false);
  });

  it('offers UPI apps for wallets and banks for accounts and cards', () => {
    expect(providersFor('wallet').map((p) => p.key)).toEqual([
      'gpay',
      'phonepe',
      'paytm',
      'amazonpay',
      'upi_other',
    ]);
    expect(providersFor('credit_card').some((p) => p.key === 'amex')).toBe(true);
    expect(providersFor('cash')).toEqual([]);
    expect(providerByKey('gpay')?.label).toBe('Google Pay');
    expect(providerByKey(null)).toBeNull();
    expect(providerByKey('nope')).toBeNull();
  });

  it('prefers the account’s own icon and colour, then the provider’s', () => {
    expect(accountVisual(account({ type: 'wallet', provider: 'phonepe' }))).toEqual({
      icon: 'phone-portrait-outline',
      color: '#7A5CCB',
    });
    expect(
      accountVisual(account({ type: 'wallet', provider: 'phonepe', icon: 'star', color: '#123456' })),
    ).toEqual({ icon: 'star', color: '#123456' });
    expect(accountVisual(account({ type: 'cash' })).icon).toBe('cash-outline');
  });
});

describe('grouping', () => {
  it('groups every type into bank, cards, cash and other, in that order', () => {
    const accounts = [
      account({ type: 'cash', name: 'Cash' }),
      account({ type: 'credit_card', name: 'Card' }),
      account({ type: 'savings', name: 'Savings' }),
      account({ type: 'investment', name: 'MF' }),
      account({ type: 'wallet', name: 'GPay' }),
      account({ type: 'bank', name: 'Salary' }),
    ];
    expect(groupAccounts(accounts).map((g) => [g.group, g.items.map((a) => a.name)])).toEqual([
      ['bank', ['Savings', 'Salary']],
      ['cards', ['Card']],
      ['cash', ['Cash', 'GPay']],
      ['other', ['MF']],
    ]);
  });

  it('leaves out groups with nothing in them', () => {
    expect(groupAccounts([account({ type: 'cash' })]).map((g) => g.group)).toEqual(['cash']);
    expect(groupAccounts([])).toEqual([]);
  });
});

describe('billing dates (mirrors SQL day_in_month)', () => {
  it('clamps a day of month to the length of the month', () => {
    expect(dayInMonth(2026, 1, 31)).toBe('2026-02-28'); // February
    expect(dayInMonth(2028, 1, 31)).toBe('2028-02-29'); // leap February
    expect(dayInMonth(2026, 2, 31)).toBe('2026-03-31'); // same cases as the SQL test
    expect(dayInMonth(2026, 3, 31)).toBe('2026-04-30');
    expect(dayInMonth(2026, 0, 15)).toBe('2026-01-15');
    expect(dayInMonth(2026, 0, 99)).toBe('2026-01-31');
    expect(dayInMonth(2026, 0, 0)).toBe('2026-01-01');
  });

  it('finds the next occurrence of a billing day, rolling into the next month', () => {
    expect(nextMonthlyDay(28, '2026-10-03')).toBe('2026-10-28');
    expect(nextMonthlyDay(1, '2026-10-03')).toBe('2026-11-01');
    expect(nextMonthlyDay(3, '2026-10-03')).toBe('2026-11-03'); // today does not count
    expect(nextMonthlyDay(31, '2026-01-31')).toBe('2026-02-28');
    expect(nextMonthlyDay(15, '2026-12-20')).toBe('2027-01-15');
  });

  it('returns nothing for a card with no dates recorded', () => {
    expect(cardDates(account({ type: 'credit_card' }), '2026-10-03')).toEqual({
      nextStatement: null,
      nextDue: null,
    });
    expect(cardDates(account({ type: 'credit_card', statementDay: 28, dueDay: 12 }), '2026-10-03')).toEqual({
      nextStatement: '2026-10-28',
      nextDue: '2026-10-12',
    });
  });
});

describe('transaction flow', () => {
  it('calls a transfer into a credit card a card payment', () => {
    expect(transactionFlow({ type: 'transfer', toAccountType: 'credit_card' })).toBe('card_payment');
    expect(transactionFlow({ type: 'transfer', toAccountType: 'savings' })).toBe('transfer');
    expect(transactionFlow({ type: 'transfer', toAccountType: null })).toBe('transfer');
    expect(transactionFlow({ type: 'expense' })).toBe('expense');
    expect(transactionFlow({ type: 'income' })).toBe('income');
    expect(transactionFlow({ type: 'adjustment' })).toBe('adjustment');
  });

  it('knows which flows move money rather than spend it', () => {
    expect(isMoveNotSpend('card_payment')).toBe(true);
    expect(isMoveNotSpend('transfer')).toBe(true);
    expect(isMoveNotSpend('expense')).toBe(false);
    expect(isMoveNotSpend('income')).toBe(false);
  });
});
