/**
 * Every insight, from your own data, for both Home (the top one) and the
 * Insights screen (all of them). Uses the payday "money month", the same
 * period as Home and budgets.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useBudgetStatus, useCycle, useDashboard, useRecurring, useSettings } from '@/hooks/data';
import { upcomingItems } from '@/lib/cashflow';
import { addDaysISO, cycleRange, elapsedDays, fromISODate, todayISO } from '@/lib/dates';
import { generateExtraInsights, generateInsights, monthlyCost, type Insight } from '@/lib/insights';
import type { Minor } from '@/lib/money';
import { qk } from '@/lib/query';
import { fetchAccountBreakdown, fetchTimeSeries } from '@/services/reports';
import type { AccountTotal } from '@/types/domain';

export interface InsightsBasis {
  /** Transactions this money month the insights were worked out from. */
  transactions: number;
  from: string;
  to: string;
}

export function useInsights(): {
  insights: Insight[] | null;
  basis: InsightsBasis | null;
  loading: boolean;
  error: unknown;
} {
  const dashboard = useDashboard();
  const recurring = useRecurring();
  const budgets = useBudgetStatus();
  const month = useCycle();
  const today = todayISO();

  // Same number of days into last month, for a fair card-spend comparison.
  const elapsed = Math.max(elapsedDays(month, today), 1);
  const startDay = useSettings().data?.cycleStartDay ?? 1;
  const prevStart = cycleRange(fromISODate(addDaysISO(month.start, -1)), startDay).start;
  const prevEnd = addDaysISO(prevStart, elapsed - 1);

  const days = useQuery({
    queryKey: qk.report('series', month.start, today, 'day'),
    queryFn: () => fetchTimeSeries(month.start, today, 'day'),
  });
  // Last month up to the same day, for "more / less than by this day last month".
  const prevDays = useQuery({
    queryKey: qk.report('series', prevStart, prevEnd, 'day'),
    queryFn: () => fetchTimeSeries(prevStart, prevEnd, 'day'),
  });
  const cardsNow = useQuery({
    queryKey: qk.report('accounts', month.start, today),
    queryFn: () => fetchAccountBreakdown(month.start, today),
  });
  const cardsBefore = useQuery({
    queryKey: qk.report('accounts', prevStart, prevEnd),
    queryFn: () => fetchAccountBreakdown(prevStart, prevEnd),
  });

  const insights = useMemo(() => {
    const d = dashboard.data;
    if (!d) return null;
    const items = upcomingItems(recurring.data ?? [], today, addDaysISO(today, 30)).filter(
      (i) => i.type !== 'income',
    );
    const base = generateInsights(
      {
        currency: d.currency,
        month,
        today,
        current: d.current,
        previous: d.previous,
        categories: d.categories,
        previousCategories: d.previousCategories,
        upcomingOutflow30d: items.reduce((s, i) => s + i.amount, 0) as Minor,
        upcomingCount30d: items.length,
      },
      12,
    );
    const cardSum = (rows: AccountTotal[] | undefined) =>
      (rows ?? []).filter((r) => r.type === 'credit_card').reduce((s, r) => s + r.expense, 0) as Minor;
    const overall = (budgets.data ?? []).find((b) => b.categoryId === null);
    const extra = generateExtraInsights({
      currency: d.currency,
      month,
      today,
      categories: d.categories,
      previousCategories: d.previousCategories,
      merchants: d.merchants.map((m) => ({ name: m.name, total: m.total, count: m.count })),
      days: (days.data ?? []).map((p) => ({ date: p.bucket.slice(0, 10), expense: p.expense })),
      cardSpend:
        cardsNow.data && cardsBefore.data
          ? { current: cardSum(cardsNow.data), previous: cardSum(cardsBefore.data) }
          : null,
      recurringMonthly: (recurring.data ?? [])
        .filter((r) => r.isActive && r.type === 'expense')
        .map((r) => ({
          name: r.name,
          monthly: monthlyCost(r.amount, r.frequency, r.intervalCount),
          subscription: r.kind === 'subscription',
        })),
      budget: overall ? { amount: overall.amount, spent: overall.spent } : null,
      soFar: prevDays.data
        ? {
            current: d.current.expense,
            previous: prevDays.data.reduce((s, p) => s + p.expense, 0) as Minor,
          }
        : null,
    });
    // One insight per id; highest priority first.
    const seen = new Set<string>();
    return [...extra, ...base]
      .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
      .sort((a, b) => b.priority - a.priority);
  }, [
    dashboard.data,
    recurring.data,
    budgets.data,
    days.data,
    prevDays.data,
    cardsNow.data,
    cardsBefore.data,
    month,
    today,
  ]);

  const basis = dashboard.data
    ? { transactions: dashboard.data.current.transactionCount, from: month.start, to: today }
    : null;
  return { insights, basis, loading: dashboard.isPending, error: dashboard.error };
}
