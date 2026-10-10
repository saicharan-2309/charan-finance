/**
 * React Query hooks — the only way screens read server data.
 */
import { fetchIous } from '@/services/lending';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';

import { useToast } from '@/components/ui/feedback';
import { haptic } from '@/components/ui/controls';
import { addDaysISO, cycleRange, fromISODate, todayISO, type DateRange, type ISODate } from '@/lib/dates';
import type { Minor } from '@/lib/money';
import { describeError, logError } from '@/lib/errors';
import { offlineQueue } from '@/lib/offline-queue';
import { invalidateFinancialData, qk } from '@/lib/query';
import { fetchAccounts, fetchCategories, fetchMerchants, fetchProfile, fetchSettings } from '@/services/core';
import {
  fetchBudgets,
  fetchBudgetStatus,
  fetchContributions,
  fetchGoals,
  fetchNetWorthSnapshots,
  fetchRecurring,
} from '@/services/planning';
import { fetchCardCycle, fetchLoans } from '@/services/loans';
import {
  fetchBankSyncStatus,
  fetchDetectedRecurring,
  fetchPendingMessages,
  fetchDiscoveredAccounts,
  fetchRecentMessages,
  fetchReviewQueue,
  fetchRules,
} from '@/services/bank-sync';
import { fetchCategoryBreakdown, fetchDashboard, fetchTimeSeries } from '@/services/reports';
import {
  fetchRecentTransactions,
  fetchRecentUsage,
  fetchTransaction,
  fetchTransactionsPage,
  type TransactionFilters,
} from '@/services/transactions';
import { useUserId } from '@/providers/AuthProvider';
import { fetchBalanceGroups } from '@/services/balance-groups';
import {
  fetchConversations,
  fetchFriendBalances,
  fetchFriendships,
  fetchGroupBalances,
  fetchMessages,
  fetchMyGroupPositions,
  fetchNotifications,
  fetchSettlements,
  fetchSharedExpense,
  fetchSharedExpenses,
  fetchSplitGroups,
  personCards,
} from '@/services/friends';
import type { Category } from '@/types/domain';

export const useProfile = () =>
  useQuery({ queryKey: qk.profile, queryFn: fetchProfile, staleTime: 5 * 60_000 });
export const useSettings = () =>
  useQuery({ queryKey: qk.settings, queryFn: fetchSettings, staleTime: 5 * 60_000 });
export const useAccounts = () => useQuery({ queryKey: qk.accounts, queryFn: fetchAccounts });
export const useCategories = () =>
  useQuery({ queryKey: qk.categories, queryFn: fetchCategories, staleTime: 5 * 60_000 });
export const useMerchants = () => useQuery({ queryKey: qk.merchants, queryFn: fetchMerchants });
export const useRecurring = () => useQuery({ queryKey: qk.recurring, queryFn: fetchRecurring });
export const useLoans = () => useQuery({ queryKey: qk.loans, queryFn: fetchLoans });
export const useBudgets = () => useQuery({ queryKey: qk.budgets, queryFn: fetchBudgets });
export const useGoals = () => useQuery({ queryKey: qk.goals, queryFn: fetchGoals });
export const useSnapshots = () => useQuery({ queryKey: qk.snapshots, queryFn: fetchNetWorthSnapshots });

export const useBankSyncStatus = () => useQuery({ queryKey: qk.bankSync, queryFn: fetchBankSyncStatus });
export const usePendingMessages = () =>
  useQuery({ queryKey: qk.bankMessages('pending'), queryFn: fetchPendingMessages });
export const useDiscoveredAccounts = () =>
  useQuery({ queryKey: qk.bankMessages('discovered'), queryFn: fetchDiscoveredAccounts });
export const useRecentMessages = () =>
  useQuery({ queryKey: qk.bankMessages('recent'), queryFn: () => fetchRecentMessages(60) });
export const useReviewQueue = () => useQuery({ queryKey: qk.reviewQueue, queryFn: fetchReviewQueue });
export const useRules = () => useQuery({ queryKey: qk.rules, queryFn: fetchRules });
export const useDetectedRecurring = () =>
  useQuery({ queryKey: qk.detectedRecurring, queryFn: fetchDetectedRecurring, staleTime: 10 * 60_000 });

export const useContributions = (goalId?: string) =>
  useQuery({ queryKey: qk.contributions(goalId), queryFn: () => fetchContributions(goalId) });

/** The open billing cycle of a credit card. Only queried for card accounts. */
export function useCardCycle(accountId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.cardCycle(accountId ?? 'none'),
    queryFn: () => fetchCardCycle(accountId!),
    enabled: !!accountId && enabled,
  });
}

export function useBudgetStatus(ref: ISODate = todayISO()) {
  return useQuery({ queryKey: qk.budgetStatus(ref), queryFn: () => fetchBudgetStatus(ref) });
}

/** The current money month — payday to payday, or the calendar month. */
export function useCycle(): DateRange {
  const startDay = useSettings().data?.cycleStartDay ?? 1;
  const today = todayISO();
  return useMemo(() => cycleRange(new Date(), startDay), [startDay, today]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useDashboard() {
  const month = useCycle();
  return useQuery({
    queryKey: qk.dashboard(month.start),
    queryFn: () => fetchDashboard(month.start, month.end),
  });
}

export function useRecentTransactions(limit = 8) {
  return useQuery({
    queryKey: [...qk.recentTransactions, limit],
    queryFn: () => fetchRecentTransactions(limit),
  });
}

export function useTransaction(id: string | undefined) {
  return useQuery({
    queryKey: qk.transaction(id ?? 'none'),
    queryFn: () => fetchTransaction(id!),
    enabled: !!id,
  });
}

export function useRecentUsage(type: 'expense' | 'income') {
  return useQuery({
    queryKey: qk.recentUsage(type),
    queryFn: () => fetchRecentUsage(type),
    staleTime: 5 * 60_000,
  });
}

export function useTransactionsInfinite(filters: TransactionFilters) {
  return useInfiniteQuery({
    queryKey: qk.transactions(filters),
    queryFn: ({ pageParam }) => fetchTransactionsPage(filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
  });
}

/** Category helpers: lookup map plus ordered top-level/subcategory trees. */
export function useCategoryIndex() {
  const q = useCategories();
  const index = useMemo(() => {
    const all = q.data ?? [];
    const byId = new Map(all.map((c) => [c.id, c]));
    const children = new Map<string, Category[]>();
    for (const c of all) {
      if (c.parentId) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
    }
    const top = (kind: 'expense' | 'income', includeArchived = false) =>
      all.filter((c) => c.parentId === null && c.kind === kind && (includeArchived || !c.isArchived));
    return { all, byId, children, top };
  }, [q.data]);
  return { ...q, index };
}

/** Pending/failed offline writes (re-renders on change). */
export function useOfflineQueue() {
  return useSyncExternalStore(offlineQueue.subscribe, offlineQueue.getSnapshot, offlineQueue.getSnapshot);
}

/**
 * Mutation wrapper: friendly error toasts, haptics, and cache invalidation.
 * `invalidate: 'financial'` refreshes everything derived from transactions.
 */
export function useAppMutation<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  options: {
    invalidate?: 'financial' | QueryKey[];
    success?: string | ((r: TResult) => string | null);
    onSuccess?: (r: TResult, vars: TVars) => void;
    context: string;
  },
) {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result, vars) => {
      haptic.success();
      if (options.invalidate === 'financial') await invalidateFinancialData();
      else if (options.invalidate)
        await Promise.all(options.invalidate.map((k) => client.invalidateQueries({ queryKey: k })));
      const msg = typeof options.success === 'function' ? options.success(result) : options.success;
      if (msg) toast.show(msg, 'success');
      options.onSuccess?.(result, vars);
    },
    onError: (err) => {
      haptic.error();
      logError(options.context, err);
      toast.show(describeError(err).message, 'error');
    },
  });
}

/** The user's display currency (profile default, INR until loaded). */
export function useCurrency(): string {
  return useProfile().data?.defaultCurrency ?? 'INR';
}

/**
 * The current week, day by day (income and spending), for Home's "This week"
 * chart. The week starts on the user's chosen day (0 = Sunday … 6 = Saturday;
 * Monday by default). Days with nothing recorded come back as zero.
 */
export function useWeekSeries() {
  const startsOn = useSettings().data?.weekStartsOn ?? 1;
  const today = todayISO();
  const start = useMemo(() => {
    const d = fromISODate(today);
    const back = (d.getDay() - startsOn + 7) % 7;
    return addDaysISO(today, -back);
  }, [today, startsOn]);
  const end = addDaysISO(start, 6);
  const q = useQuery({
    queryKey: qk.report('series', start, end, 'day'),
    queryFn: () => fetchTimeSeries(start, end, 'day'),
  });
  const days = useMemo(() => {
    const byDay = new Map((q.data ?? []).map((p) => [p.bucket.slice(0, 10), p]));
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDaysISO(start, i);
      const p = byDay.get(date);
      return { date, income: (p?.income ?? 0) as Minor, expense: (p?.expense ?? 0) as Minor };
    });
  }, [q.data, start]);
  return { ...q, days, start, end, today };
}

export type SpendPeriod = 'today' | '1w' | '1m' | '1y';

/** Spending by category for a period ending today (today, 7 days, this money month, 12 months). */
export function useCategorySpend(period: SpendPeriod) {
  const cycle = useCycle();
  const today = todayISO();
  const start =
    period === 'today'
      ? today
      : period === '1w'
        ? addDaysISO(today, -6)
        : period === '1m'
          ? cycle.start
          : addDaysISO(today, -364);
  const q = useQuery({
    queryKey: qk.report('categories', start, today),
    queryFn: () => fetchCategoryBreakdown(start, today),
  });
  return { ...q, start, end: today };
}

// ---------------------------------------------------------------------------
// Balance groups and Friends
// ---------------------------------------------------------------------------
export const useBalanceGroups = () => useQuery({ queryKey: qk.balanceGroups, queryFn: fetchBalanceGroups });

export function useFriendships() {
  const me = useUserId();
  return useQuery({ queryKey: qk.friendships, queryFn: () => fetchFriendships(me!), enabled: !!me });
}
export const useFriendBalances = () =>
  useQuery({ queryKey: qk.friendBalances, queryFn: fetchFriendBalances });
export const useConversations = () =>
  useQuery({ queryKey: qk.conversations, queryFn: fetchConversations, refetchInterval: 30_000 });
export const useMessages = (conversationId: string | undefined) =>
  useQuery({
    queryKey: qk.messages(conversationId ?? 'none'),
    queryFn: () => fetchMessages(conversationId!),
    enabled: !!conversationId,
  });
export const useSplitGroups = () => useQuery({ queryKey: qk.splitGroups, queryFn: fetchSplitGroups });
export const useGroupBalances = (groupId: string | undefined) =>
  useQuery({
    queryKey: qk.groupBalances(groupId ?? 'none'),
    queryFn: () => fetchGroupBalances(groupId!),
    enabled: !!groupId,
  });
export const useSharedExpenses = (filter: { groupId?: string; withUser?: string } = {}) =>
  useQuery({ queryKey: qk.sharedExpenses(filter), queryFn: () => fetchSharedExpenses(filter) });
export const useSharedExpense = (id: string | undefined) =>
  useQuery({
    queryKey: qk.sharedExpense(id ?? 'none'),
    queryFn: () => fetchSharedExpense(id!),
    enabled: !!id,
  });
export const useSettlements = (withUser?: string) =>
  useQuery({ queryKey: qk.settlements(withUser), queryFn: () => fetchSettlements(withUser) });
export const useNotifications = () => useQuery({ queryKey: qk.notifications, queryFn: fetchNotifications });
export const useIous = () => useQuery({ queryKey: qk.ious, queryFn: fetchIous });

/** Public cards (name, username, status) for a set of user ids. */
export function usePeople(ids: string[]) {
  const key = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ['people', ...key],
    queryFn: () => personCards(key),
    enabled: key.length > 0,
    staleTime: 10 * 60_000,
  });
}

export const useMyGroupPositions = () =>
  useQuery({ queryKey: ['group-balances', 'mine'], queryFn: fetchMyGroupPositions });

/** You owe / owed to you, across friends (outside groups) and your groups. */
export function useFriendsTotals() {
  const balances = useFriendBalances();
  const groups = useMyGroupPositions();
  const lines = [...(balances.data ?? []).map((b) => b.net), ...(groups.data ?? []).map((g) => g.net)];
  return {
    loading: balances.data === undefined || groups.data === undefined,
    owe: lines.filter((n) => n < 0).reduce((s, n) => s - n, 0) as Minor,
    owed: lines.filter((n) => n > 0).reduce((s, n) => s + n, 0) as Minor,
  };
}
