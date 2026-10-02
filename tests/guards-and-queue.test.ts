import { allowedGroups } from '@/lib/route-guard';

// ---------------------------------------------------------------------------
// Mocks for the offline queue's platform dependencies
// ---------------------------------------------------------------------------
const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
    removeItem: jest.fn(async (k: string) => void mockStore.delete(k)),
  },
}));

let mockOnline = true;
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(async () => ({ isConnected: mockOnline, isInternetReachable: mockOnline })),
    addEventListener: jest.fn(() => () => undefined),
  },
}));

let mockCounter = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `op-${++mockCounter}` }));

const mockSave = jest.fn();
const mockDelete = jest.fn();
jest.mock('@/services/transactions', () => ({
  saveTransaction: (...a: unknown[]) => mockSave(...a),
  deleteTransaction: (...a: unknown[]) => mockDelete(...a),
}));

// eslint-disable-next-line import/first
import { offlineQueue, submitDelete, submitTransaction } from '@/lib/offline-queue';
// eslint-disable-next-line import/first
import type { SaveTransactionInput } from '@/services/transactions';

const netErr = () => Object.assign(new Error('Network request failed'), {});
const input = (id: string): SaveTransactionInput => ({
  mode: 'create',
  id,
  type: 'expense',
  amount: 45000 as never,
  accountId: 'acc',
  occurredAt: '2026-09-15T10:00:00.000Z',
  toAccountId: null,
  categoryId: 'food',
  subcategoryId: null,
  merchantId: null,
  merchantName: 'Swiggy',
  notes: null,
  tags: null,
  expectedUpdatedAt: null,
});
const display = {
  type: 'expense' as const,
  amount: 45000 as never,
  currency: 'INR',
  title: 'Swiggy',
  subtitle: 'Food',
  occurredAt: '2026-09-15T10:00:00.000Z',
};

describe('authentication route guard', () => {
  it('shows setup screen when the build is not configured', () => {
    expect([...allowedGroups({ isConfigured: false, hasSession: true, recovering: false })].sort()).toEqual([
      'reset-password',
      'setup-required',
    ]);
  });
  it('only allows auth screens when signed out', () => {
    const g = allowedGroups({ isConfigured: true, hasSession: false, recovering: false });
    expect(g.has('(auth)')).toBe(true);
    expect(g.has('(app)')).toBe(false);
  });
  it('only allows the app when signed in', () => {
    const g = allowedGroups({ isConfigured: true, hasSession: true, recovering: false });
    expect(g.has('(app)')).toBe(true);
    expect(g.has('(auth)')).toBe(false);
  });
  it('blocks financial screens during password recovery', () => {
    const g = allowedGroups({ isConfigured: true, hasSession: true, recovering: true });
    expect(g.has('(app)')).toBe(false);
    expect(g.has('reset-password')).toBe(true);
  });
});

describe('offline write queue', () => {
  beforeEach(async () => {
    mockStore.clear();
    mockOnline = true;
    mockSave.mockReset();
    mockDelete.mockReset();
    await offlineQueue.load('user-1');
  });

  it('saves directly when mockOnline', async () => {
    mockSave.mockResolvedValue({});
    expect(await submitTransaction(input('t1'), display)).toEqual({ status: 'saved' });
    expect(offlineQueue.getSnapshot()).toHaveLength(0);
  });

  it('queues durably when offline and survives a restart', async () => {
    mockOnline = false;
    expect(await submitTransaction(input('t1'), display)).toEqual({ status: 'queued' });
    expect(mockSave).not.toHaveBeenCalled();
    await offlineQueue.load('user-1'); // simulate app relaunch
    expect(offlineQueue.getSnapshot()).toHaveLength(1);
    expect(offlineQueue.getSnapshot()[0]).toMatchObject({ kind: 'save', status: 'pending' });
  });

  it('queues when the request fails for network reasons, then flushes in order', async () => {
    mockSave.mockRejectedValueOnce(netErr());
    expect(await submitTransaction(input('t1'), display)).toEqual({ status: 'queued' });
    mockOnline = false;
    await submitTransaction(input('t2'), display);
    mockSave.mockReset().mockResolvedValue({});
    await offlineQueue.flush();
    expect(mockSave.mock.calls.map((c) => (c[0] as SaveTransactionInput).id)).toEqual(['t1', 't2']);
    expect(offlineQueue.getSnapshot()).toHaveLength(0);
  });

  it('keeps items on network failure during flush (nothing is lost)', async () => {
    mockOnline = false;
    await submitTransaction(input('t1'), display);
    mockSave.mockRejectedValue(netErr());
    await offlineQueue.flush();
    expect(offlineQueue.getSnapshot()).toHaveLength(1);
    expect(offlineQueue.getSnapshot()[0].status).toBe('pending');
  });

  it('marks server-rejected writes as failed instead of dropping them', async () => {
    mockOnline = false;
    await submitTransaction(input('t1'), display);
    mockSave.mockRejectedValue({ message: 'CF409: changed elsewhere' });
    await offlineQueue.flush();
    const [item] = offlineQueue.getSnapshot();
    expect(item.status).toBe('failed');
    expect(item.error).toMatch(/another device/);
    // Retry succeeds later.
    mockSave.mockReset().mockResolvedValue({});
    await offlineQueue.retry(item.opId);
    expect(offlineQueue.getSnapshot()).toHaveLength(0);
  });

  it('throws validation errors to the form when mockOnline', async () => {
    mockSave.mockRejectedValue({ message: 'CF303: Category type does not match' });
    await expect(submitTransaction(input('t1'), display)).rejects.toMatchObject({
      message: expect.stringContaining('CF303'),
    });
    expect(offlineQueue.getSnapshot()).toHaveLength(0);
  });

  it('cancels an offline create when it is deleted before syncing', async () => {
    mockOnline = false;
    await submitTransaction(input('t1'), display);
    await submitDelete('t1', display);
    expect(offlineQueue.getSnapshot()).toHaveLength(0);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('isolates queues per user', async () => {
    mockOnline = false;
    await submitTransaction(input('t1'), display);
    await offlineQueue.load('user-2');
    expect(offlineQueue.getSnapshot()).toHaveLength(0);
    await offlineQueue.load('user-1');
    expect(offlineQueue.getSnapshot()).toHaveLength(1);
  });
});
