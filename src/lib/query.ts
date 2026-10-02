/**
 * React Query setup: caching, offline-first reads and a persisted cache so the
 * app opens instantly and stays useful without a connection.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { isNetworkError } from './errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24 * 7,
      // Serve cached data first; fetch when possible; pause (not fail) offline.
      networkMode: 'offlineFirst',
      retry: (count, error) => (isNetworkError(error) ? count < 3 : count < 1),
      refetchOnReconnect: true,
    },
    mutations: {
      networkMode: 'always',
      retry: false,
    },
  },
});

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'cf.query-cache.v1',
  throttleTime: 1500,
});

/** Bump to invalidate persisted caches after incompatible data-shape changes. */
export const CACHE_BUSTER = '2026-10-01';

let wired = false;
export function wireReactQueryToPlatform(): void {
  if (wired) return;
  wired = true;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(!!state.isConnected && state.isInternetReachable !== false);
    }),
  );
  if (Platform.OS !== 'web') {
    AppState.addEventListener('change', (status) => focusManager.setFocused(status === 'active'));
  }
}

export const qk = {
  profile: ['profile'] as const,
  settings: ['settings'] as const,
  accounts: ['accounts'] as const,
  categories: ['categories'] as const,
  merchants: ['merchants'] as const,
  recurring: ['recurring'] as const,
  budgets: ['budgets'] as const,
  budgetStatus: (ref: string) => ['budget-status', ref] as const,
  goals: ['goals'] as const,
  contributions: (goalId?: string) => ['contributions', goalId ?? 'all'] as const,
  snapshots: ['net-worth-snapshots'] as const,
  dashboard: (start: string) => ['dashboard', start] as const,
  transactions: (filters: unknown) => ['transactions', filters] as const,
  transaction: (id: string) => ['transaction', id] as const,
  recentTransactions: ['transactions', 'recent'] as const,
  recentUsage: (type: string) => ['recent-usage', type] as const,
  attachments: (txId: string) => ['attachments', txId] as const,
  report: (name: string, ...args: unknown[]) => ['report', name, ...args] as const,
  merchantStats: (id: string) => ['merchant-stats', id] as const,
};

/** Everything derived from transactions (balances, reports, budgets…). */
export const FINANCIAL_QUERY_ROOTS = [
  'transactions',
  'transaction',
  'accounts',
  'dashboard',
  'budget-status',
  'report',
  'merchant-stats',
  'recent-usage',
  'recurring',
  'merchants',
  'net-worth-snapshots',
  'goals',
  'contributions',
  'profile',
];

export function invalidateFinancialData(): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (q) => FINANCIAL_QUERY_ROOTS.includes(String(q.queryKey[0])),
  });
}
