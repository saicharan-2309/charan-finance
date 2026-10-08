/**
 * What happens when the user taps Confirm on a BUD AI card: each proposal is
 * carried out by the app's existing functions, with exact paise.
 */
import { performAction } from '@/services/assistant';
import { reviewTransaction } from '@/services/bank-sync';
import { createSharedExpense } from '@/services/friends';
import { fetchTransaction, saveTransaction } from '@/services/transactions';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'new-id' }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/services/transactions', () => ({
  saveTransaction: jest.fn(async () => ({})),
  fetchTransaction: jest.fn(),
}));
jest.mock('@/services/bank-sync', () => ({ reviewTransaction: jest.fn(async () => undefined) }));
jest.mock('@/services/friends', () => ({ createSharedExpense: jest.fn(async () => 'se-1') }));

beforeEach(() => jest.clearAllMocks());

it('records a confirmed expense through save_transaction, in paise', async () => {
  await performAction(
    {
      kind: 'create_transaction',
      type: 'expense',
      amount: '500.00',
      accountId: 'a-sav',
      accountName: 'SBI Savings',
      categoryId: 'c-food',
      categoryName: 'Food',
      merchantName: 'Starbucks',
      occurredOn: '2026-09-30',
      notes: null,
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
      accountId: 'a-sav',
      categoryId: 'c-food',
      merchantName: 'Starbucks',
      occurredAt: new Date(2026, 8, 30, 12).toISOString(),
    }),
  );
});

it('a category change goes through review_transaction (works for bank-message rows too)', async () => {
  (fetchTransaction as jest.Mock).mockResolvedValue({ id: 't1', type: 'expense' });
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

it('other changes keep every other field and the row-version check', async () => {
  (fetchTransaction as jest.Mock).mockResolvedValue({
    id: 't1',
    type: 'expense',
    amount: 125000,
    accountId: 'a-hdfc',
    occurredAt: '2026-10-07T09:00:00.000Z',
    toAccountId: null,
    categoryId: 'c-food',
    subcategoryId: 'c-cafe',
    merchantId: 'm-1',
    merchantName: 'AMZN',
    notes: 'old',
    updatedAt: '2026-10-07T09:00:01.000Z',
  });
  await performAction(
    { kind: 'update_transaction', transactionId: 't1', merchantName: 'Amazon', summary: 'AMZN → Amazon' },
    'u-me',
  );
  expect(saveTransaction).toHaveBeenCalledWith({
    mode: 'update',
    id: 't1',
    type: 'expense',
    amount: 125000,
    accountId: 'a-hdfc',
    occurredAt: '2026-10-07T09:00:00.000Z',
    toAccountId: null,
    categoryId: 'c-food',
    subcategoryId: 'c-cafe',
    merchantId: null,
    merchantName: 'Amazon',
    notes: 'old',
    tags: null,
    expectedUpdatedAt: '2026-10-07T09:00:01.000Z',
  });
});

it('a confirmed split creates the shared expense, ₹2,000 → ₹1,000 each', async () => {
  await performAction(
    {
      kind: 'split_with_friend',
      friendId: 'u-rahul',
      friendName: 'Rahul',
      total: '2000.00',
      title: 'Dinner',
      occurredOn: '2026-10-08',
      accountId: 'a-sav',
      accountName: 'SBI Savings',
      categoryName: null,
      summary: 'Dinner',
    },
    'u-me',
  );
  expect(createSharedExpense).toHaveBeenCalledWith({
    groupId: null,
    paidBy: 'u-me',
    title: 'Dinner',
    categoryName: null,
    total: 200000,
    occurredOn: '2026-10-08',
    splitMethod: 'equal',
    shares: [
      { userId: 'u-me', amount: 100000, input: null },
      { userId: 'u-rahul', amount: 100000, input: null },
    ],
    payerAccountId: 'a-sav',
  });
});
