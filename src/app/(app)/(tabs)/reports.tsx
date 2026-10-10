/**
 * Insights (the Reports tab), in the reference design: period pill in the
 * header, Spending · Income · Savings · Net worth pills, a total card with
 * month bars, and top categories with an Amount / % share switch. Everything
 * the screen showed before is still here — merchants, payment methods,
 * spending mix, largest expenses, budget performance, year-on-year — under
 * Spending. All aggregation happens in PostgreSQL.
 */
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { LineChart } from '@/components/charts';
import { ErrorState } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Icon, Row, Text } from '@/components/ui/primitives';
import { PageHeader, Pill } from '@/components/ui/ref';
import { BudgetRow } from '@/features/dashboard/widgets';
import { AccountRings, MerchantRings, MoneyRings, PaidWith, SpendingMix } from '@/features/reports/overview';
import { CategoryBars, monthShort, TotalCard } from '@/features/reports/reference';
import { defaultRange, RangePicker, type RangeValue } from '@/features/reports/RangePicker';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { useBudgetStatus, useCurrency, useSettings, useSnapshots } from '@/hooks/data';
import {
  formatShortDate,
  previousRange,
  RANGE_PRESET_LABELS,
  rangeForPreset,
  yearAgoRange,
} from '@/lib/dates';
import { formatMoney, percentOf } from '@/lib/money';
import { invalidateFinancialData, qk } from '@/lib/query';
import {
  fetchAccountBreakdown,
  fetchCategoryBreakdown,
  fetchMerchantBreakdown,
  fetchSummary,
  fetchTimeSeries,
} from '@/services/reports';
import { fetchLargestExpenses } from '@/services/transactions';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import type { PeriodSummary } from '@/types/domain';

type Tab = 'spending' | 'income' | 'savings' | 'networth';

/** "Oct 2026" for a month, otherwise the preset's name or the dates. */
function periodLabel(v: RangeValue): string {
  if (v.preset === 'this_month' || v.preset === 'last_month') {
    const [y] = v.range.end.split('-').map(Number);
    return `${monthShort(v.range.end)} ${y}`;
  }
  if (v.preset === 'custom') return `${formatShortDate(v.range.start)} – ${formatShortDate(v.range.end)}`;
  return RANGE_PRESET_LABELS[v.preset];
}

export default function ReportsScreen() {
  const { colors } = useTheme();
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
  const [tab, setTab] = useState<Tab>('spending');
  const [periodOpen, setPeriodOpen] = useState(false);
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
    enabled: tab === 'income',
  });
  // Six months of bars ending with the selected period's month.
  const seriesStart = useMemo(() => {
    const [y, m] = end.split('-').map(Number);
    const d = new Date(Date.UTC(y!, m! - 1 - 5, 1));
    return d.toISOString().slice(0, 10);
  }, [end]);
  const series = useQuery({
    queryKey: qk.report('series', seriesStart, end, 'month'),
    queryFn: () => fetchTimeSeries(seriesStart, end, 'month'),
  });
  const bars = (pick: (p: { income: number; expense: number }) => number) =>
    series.data?.map((p) => ({ label: monthShort(p.bucket), value: pick(p) }));
  const merchants = useQuery({
    queryKey: qk.report('merchants', start, end),
    queryFn: () => fetchMerchantBreakdown(start, end, 30),
    enabled: tab === 'spending',
  });
  const accounts = useQuery({
    queryKey: qk.report('accounts', start, end),
    queryFn: () => fetchAccountBreakdown(start, end),
    enabled: tab === 'spending',
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
    enabled: tab === 'spending',
  });
  const budgets = useBudgetStatus();
  const settings = useSettings();
  const snapshots = useSnapshots();

  const s = summary.data;

  return (
    <Screen
      safeTop
      tabBarInset
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await invalidateFinancialData();
        setRefreshing(false);
      }}
    >
      <PageHeader
        title="Insights"
        right={
          <Pill
            label={periodLabel(range)}
            trailingIcon="chevron-down"
            onPress={() => setPeriodOpen(true)}
            accessibilityLabel={`Period: ${periodLabel(range)}. Change`}
          />
        }
      />
      <Row gap={spacing.sm} style={{ marginBottom: spacing.xl }}>
        {(
          [
            ['spending', 'Spending'],
            ['income', 'Income'],
            ['savings', 'Savings'],
            ['networth', 'Net worth'],
          ] as const
        ).map(([t, label]) => (
          <Pill key={t} label={label} selected={tab === t} onPress={() => setTab(t)} />
        ))}
      </Row>
      <Modal
        visible={periodOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPeriodOpen(false)}
      >
        <View style={{ flex: 1, padding: spacing.xl, backgroundColor: colors.background, gap: spacing.lg }}>
          <Row justify="space-between">
            <Text variant="headline">Period</Text>
            <Pressable onPress={() => setPeriodOpen(false)} accessibilityRole="button" hitSlop={10}>
              <Text variant="bodyStrong" tone="brand">
                Done
              </Text>
            </Pressable>
          </Row>
          <RangePicker
            value={range}
            onChange={(v) => {
              setRange(v);
              if (v.preset !== 'custom') setPeriodOpen(false);
            }}
            startDay={startDay}
          />
        </View>
      </Modal>

      {summary.error && !s ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : null}

      {tab === 'spending' ? (
        <>
          <TotalCard
            title="Total spending"
            amount={s?.expense}
            previous={prevSummary.data?.expense}
            upIsGood={false}
            currency={currency}
            bars={bars((p) => p.expense)}
          />

          <CategoryBars
            title="Top categories"
            categories={categories.data}
            currency={currency}
            range={{ start, end }}
          />

          <Section title="Compared with">
            <Comparison
              label="vs the previous period"
              current={s}
              other={prevSummary.data}
              currency={currency}
            />
            <Comparison
              label="vs the same time last year"
              current={s}
              other={yoySummary.data}
              currency={currency}
            />
          </Section>

          {(merchants.data ?? []).length ? (
            <Section title="Top merchants">
              <MerchantRings merchants={merchants.data!} currency={currency} detailed />
            </Section>
          ) : null}

          {(accounts.data ?? []).some((a) => a.expense > 0) ? (
            <Section title="Paid with">
              <View style={{ gap: spacing.lg }}>
                <PaidWith accounts={accounts.data} currency={currency} />
                <AccountRings accounts={accounts.data!} currency={currency} />
              </View>
            </Section>
          ) : null}

          <Section title="Largest expenses">
            {largest.data?.length ? (
              <Card padded={false} style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.xs }}>
                {largest.data.map((t) => (
                  <TransactionRow key={t.id} t={t} showDate />
                ))}
              </Card>
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
        </>
      ) : null}

      {tab === 'income' ? (
        <>
          <TotalCard
            title="Total income"
            amount={s?.income}
            previous={prevSummary.data?.income}
            upIsGood
            currency={currency}
            bars={bars((p) => p.income)}
          />
          <CategoryBars
            title="Income by category"
            categories={incomeCats.data}
            currency={currency}
            range={{ start, end }}
          />
        </>
      ) : null}

      {tab === 'savings' ? (
        <>
          <TotalCard
            title="Saved this period"
            amount={s ? s.income - s.expense : undefined}
            previous={prevSummary.data ? prevSummary.data.income - prevSummary.data.expense : undefined}
            upIsGood
            currency={currency}
            bars={bars((p) => p.income - p.expense)}
          />
          <Section title="Money in vs spent">
            <MoneyRings current={s} previous={prevSummary.data} currency={currency} />
          </Section>
          {s && s.expense > 0 ? (
            <Section title="Spending mix">
              <SpendingMix s={s} currency={currency} />
            </Section>
          ) : null}
        </>
      ) : null}

      {tab === 'networth' ? (
        <>
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
