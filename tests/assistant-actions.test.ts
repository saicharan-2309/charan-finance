/**
 * What happens when the user taps Confirm on a BUD AI card: each proposal is
 * carried out by the app's existing functions, with exact paise.
 */
import { performAction } from '@/services/assistant';
import { reviewTransaction } from '@/services/bank-sync';
import { createSharedExpense } from '@/services/friends';
import { saveTransaction } from '@/services/transactions';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'new-id' }));
jest.mock('@/lib/supabase', () => ({ supabase: {}, unwrap: (x: unknown) => x }));
jest.mock('@/services/transactions', () => ({ saveTransaction: jest.fn(async () => ({})) }));
jest.mock('@/services/bank-sync', () => ({ reviewTransaction: jest.fn(async () => undefined) }));
jest.mock('@/services/friends', () => ({
  createSharedExpense: jest.fn(async () => 'se-1'),
  fetchMyGroupPositions: jest.fn(),
}));
jest.mock('@/services/core', () => ({ fetchAccounts: jest.fn(), fetchCategories: jest.fn() }));
jest.mock('@/services/reports', () => ({}));

beforeEach(() => jest.clearAllMocks());

it('records a confirmed expense through save_transaction', async () => {
  await performAction(
    {
      kind: 'create_transaction',
      type: 'expense',
      amount: 50000 as never,
      accountId: 'a-sbi',
      accountName: 'SBI Savings',
      categoryId: 'c-food',
      categoryName: 'Food',
      merchantName: 'Starbucks',
      occurredOn: '2026-09-30',
      summary: 'Expense ₹500 · Starbucks',
    },
    'u-me',
  );
  expect(saveTransaction).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: 'create',
      id: 'new-id',
      type: 'expense',
      amount: 50000,
      accountId: 'a-sbi',
      categoryId: 'c-food',
      merchantName: 'Starbucks',
      occurredAt: new Date(2026, 8, 30, 12).toISOString(),
    }),
  );
});

it('a category change goes through review_transaction (works for bank-message rows too)', async () => {
  await performAction(
    {
      kind: 'update_transaction',
      transactionId: 't1',
      categoryId: 'c-shop',
      categoryName: 'Shopping',
      summary: 'Amazon → Shopping',
    },
    'u-me',
  );
  expect(reviewTransaction).toHaveBeenCalledWith({ id: 't1', categoryId: 'c-shop', subcategoryId: null });
  expect(saveTransaction).not.toHaveBeenCalled();
});

it('a confirmed split creates the shared expense, ₹2,000 → ₹1,000 each', async () => {
  await performAction(
    {
      kind: 'split_with_friend',
      friendId: 'u-rahul',
      friendName: 'Rahul',
      total: 200000 as never,
      title: 'Dinner',
      occurredOn: '2026-10-08',
      accountId: 'a-sbi',
      accountName: 'SBI Savings',
      summary: 'Dinner',
    },
    'u-me',
  );
  expect(createSharedExpense).toHaveBeenCalledWith({
    groupId: null,
    paidBy: 'u-me',
    title: 'Dinner',
    total: 200000,
    occurredOn: '2026-10-08',
    splitMethod: 'equal',
    shares: [
      { userId: 'u-me', amount: 100000, input: null },
      { userId: 'u-rahul', amount: 100000, input: null },
    ],
    payerAccountId: 'a-sbi',
  });
});
