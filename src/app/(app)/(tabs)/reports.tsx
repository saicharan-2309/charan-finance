/**
 * Reports: overview, categories, merchants and accounts for any date range,
 * with month-over-month and year-over-year comparison and drill-downs.
 * All aggregation happens in PostgreSQL.
 */
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { LineChart } from '@/components/charts';
import { SegmentedControl } from '@/components/ui/controls';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Icon, Row, Text } from '@/components/ui/primitives';
import { BudgetRow } from '@/features/dashboard/widgets';
import {
  AccountRings,
  CategoryDonut,
  MerchantRings,
  MoneyRings,
  PaidWith,
  SpendHero,
  SpendingMix,
  TopMerchants,
} from '@/features/reports/overview';
import { defaultRange, RangePicker, type RangeValue } from '@/features/reports/RangePicker';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { useBudgetStatus, useCurrency, useSettings, useSnapshots } from '@/hooks/data';
import { formatShortDate, previousRange, rangeForPreset, yearAgoRange } from '@/lib/dates';
import { formatMoney, percentOf } from '@/lib/money';
import { invalidateFinancialData, qk } from '@/lib/query';
import {
  fetchAccountBreakdown,
  fetchCategoryBreakdown,
  fetchMerchantBreakdown,
  fetchSummary,
} from '@/services/reports';
import { fetchLargestExpenses } from '@/services/transactions';
import { spacing } from '@/theme/tokens';
import type { PeriodSummary } from '@/types/domain';

type Tab = 'overview' | 'categories' | 'merchants' | 'accounts';

export default function ReportsScreen() {
  const currency = useCurrency();
  const startDay = useSettings().data?.cycleStartDay ?? 1;
  const [range, setRange] = useState<RangeValue>(() => defaultRange(startDay));
  // Once the payday setting arrives (or changes), re-resolve a preset range.
  const [rangeDay, setRangeDay] = useState(startDay);
  if (rangeDay !== startDay) {
    setRangeDay(startDay);
    if (range.preset !== 'custom') {
      setRange({ preset: range.preset, range: rangeForPreset(range.preset, new Date(), startDay) });
    }
  }
  const [tab, setTab] = useState<Tab>('overview');
  const [refreshing, setRefreshing] = useState(false);
  const { start, end } = range.range;
  const prev = useMemo(() => previousRange(range.range, startDay), [range.range, startDay]);
  const yoy = useMemo(() => yearAgoRange(range.range), [range.range]);

  const summary = useQuery({
    queryKey: qk.report('summary', start, end),
    queryFn: () => fetchSummary(start, end),
  });
  const prevSummary = useQuery({
    queryKey: qk.report('summary', prev.start, prev.end),
    queryFn: () => fetchSummary(prev.start, prev.end),
  });
  const yoySummary = useQuery({
    queryKey: qk.report('summary', yoy.start, yoy.end),
    queryFn: () => fetchSummary(yoy.start, yoy.end),
  });
  const categories = useQuery({
    queryKey: qk.report('categories', start, end),
    queryFn: () => fetchCategoryBreakdown(start, end),
  });
  const incomeCats = useQuery({
    queryKey: qk.report('income-categories', start, end),
    queryFn: () => fetchCategoryBreakdown(start, end, { kind: 'income' }),
    enabled: tab === 'categories',
  });
  const merchants = useQuery({
    queryKey: qk.report('merchants', start, end),
    queryFn: () => fetchMerchantBreakdown(start, end, 30),
    enabled: tab === 'merchants' || tab === 'overview',
  });
  const accounts = useQuery({
    queryKey: qk.report('accounts', start, end),
    queryFn: () => fetchAccountBreakdown(start, end),
    enabled: tab === 'accounts' || tab === 'overview',
  });
  const largest = useQuery({
    queryKey: qk.report('largest', start, end),
    queryFn: () => {
      const [sy, sm, sd] = start.split('-').map(Number);
      const [ey, em, ed] = end.split('-').map(Number);
      return fetchLargestExpenses(
        new Date(sy, sm - 1, sd).toISOString(),
        new Date(ey, em - 1, ed, 23, 59, 59, 999).toISOString(),
        5,
      );
    },
    enabled: tab === 'overview',
  });
  const budgets = useBudgetStatus();
  const settings = useSettings();
  const snapshots = useSnapshots();

  const s = summary.data;

  return (
    <Screen
      safeTop
      tabBarInset
      title="Reports"
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await invalidateFinancialData();
        setRefreshing(false);
      }}
    >
      <RangePicker value={range} onChange={setRange} startDay={startDay} />
      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        style={{ marginVertical: spacing.xl }}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'categories', label: 'Categories' },
          { value: 'merchants', label: 'Merchants' },
          { value: 'accounts', label: 'Accounts' },
        ]}
      />

      {summary.error && !s ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : null}

      {tab === 'overview' ? (
        <>
          <SpendHero current={s} previous={prevSummary.data} currency={currency} />

          <Section title="Where it went">
            <CategoryDonut categories={categories.data} currency={currency} range={{ start, end }} />
          </Section>

          <Section title="This period vs last">
            <MoneyRings current={s} previous={prevSummary.data} currency={currency} />
            <Comparison
              label="vs the same time last year"
              current={s}
              other={yoySummary.data}
              currency={currency}
            />
          </Section>

          {(merchants.data ?? []).length ? (
            <Section title="Top merchants" action="All" onAction={() => setTab('merchants')}>
              <TopMerchants merchants={merchants.data} currency={currency} />
            </Section>
          ) : null}

          {(accounts.data ?? []).some((a) => a.expense > 0) ? (
            <Section title="Paid with">
              <PaidWith accounts={accounts.data} currency={currency} />
            </Section>
          ) : null}

          {s && s.expense > 0 ? (
            <Section title="Spending mix">
              <SpendingMix s={s} currency={currency} />
            </Section>
          ) : null}

          <Section title="Largest expenses">
            {largest.data?.length ? (
              largest.data.map((t) => <TransactionRow key={t.id} t={t} showDate />)
            ) : (
              <Text variant="footnote" tone="secondary">
                No expenses in this period.
              </Text>
            )}
          </Section>

          {budgets.data?.length ? (
            <Section title="Budget performance" action="Budgets" onAction={() => router.push('/budgets')}>
              <Card style={{ gap: spacing.lg }}>
                {budgets.data.map((r) => (
                  <BudgetRow
                    key={r.itemId}
                    row={r}
                    currency={currency}
                    warningPercent={settings.data?.budgetWarningPercent ?? 80}
                  />
                ))}
              </Card>
            </Section>
          ) : null}

          <Section title="Net worth" action="Details" onAction={() => router.push('/net-worth')}>
            <Card>
              {snapshots.data && snapshots.data.length > 1 ? (
                <LineChart
                  currency={currency}
                  points={snapshots.data.map((n) => ({
                    label: formatShortDate(n.snapshotDate),
                    value: n.netWorth,
                  }))}
                />
              ) : (
                <Text variant="footnote" tone="secondary">
                  A net-worth snapshot is saved each day you open the app — the trend appears after a few
                  days.
                </Text>
              )}
            </Card>
          </Section>
        </>
      ) : null}

      {tab === 'categories' ? (
        <>
          <Section title="Spending by category">
            <CategoryDonut categories={categories.data} currency={currency} range={{ start, end }} />
          </Section>
          {incomeCats.data?.length ? (
            <Section title="Income by category">
              <CategoryDonut categories={incomeCats.data} currency={currency} range={{ start, end }} />
            </Section>
          ) : null}
        </>
      ) : null}

      {tab === 'merchants' ? (
        <Section title="Top merchants">
          {merchants.data === undefined ? (
            <Skeleton height={300} />
          ) : merchants.data.length === 0 ? (
            <EmptyState compact icon="storefront-outline" title="No merchant spending in this period" />
          ) : (
            <MerchantRings merchants={merchants.data} currency={currency} detailed />
          )}
        </Section>
      ) : null}

      {tab === 'accounts' ? (
        <Section title="Spending by account / payment method">
          {accounts.data === undefined ? (
            <Skeleton height={200} />
          ) : accounts.data.length === 0 ? (
            <EmptyState compact icon="card-outline" title="No activity in this period" />
          ) : (
            <View style={{ gap: spacing.lg }}>
              <PaidWith accounts={accounts.data} currency={currency} />
              <AccountRings accounts={accounts.data} currency={currency} />
            </View>
          )}
        </Section>
      ) : null}
    </Screen>
  );
}

function Comparison({
  label,
  current,
  other,
  currency,
}: {
  label: string;
  current?: PeriodSummary;
  other?: PeriodSummary;
  currency: string;
}) {
  if (!current || !other || other.expense === 0) {
    return (
      <Row justify="space-between">
        <Text variant="footnote" tone="secondary">
          Spending {label}
        </Text>
        <Text variant="footnote" tone="tertiary">
          No data
        </Text>
      </Row>
    );
  }
  const diff = current.expense - other.expense;
  const pct = Math.round(percentOf(Math.abs(diff), other.expense));
  return (
    <Row justify="space-between">
      <Text variant="footnote" tone="secondary">
        Spending {label}
      </Text>
      <Row gap={4}>
        <Icon
          name={diff > 0 ? 'arrow-up' : diff < 0 ? 'arrow-down' : 'remove'}
          size={14}
          tone={diff > 0 ? 'negative' : 'positive'}
        />
        <Text variant="footnote" tone={diff > 0 ? 'negative' : 'positive'}>
          {pct}% ({formatMoney(Math.abs(diff), currency, { decimals: 'never' })} {diff > 0 ? 'more' : 'less'})
        </Text>
      </Row>
    </Row>
  );
}
