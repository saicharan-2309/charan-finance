/**
 * Reports: overview, categories, merchants and accounts for any date range,
 * with month-over-month and year-over-year comparison and drill-downs.
 * All aggregation happens in PostgreSQL.
 */
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { BarChart, LineChart, ShareBar } from '@/components/charts';
import { SegmentedControl } from '@/components/ui/controls';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Screen, Section, Stat } from '@/components/ui/layout';
import { Card, Divider, Icon, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { BudgetRow, CategoryBreakdown } from '@/features/dashboard/widgets';
import { defaultRange, RangePicker, type RangeValue } from '@/features/reports/RangePicker';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { useBudgetStatus, useCurrency, useSettings, useSnapshots } from '@/hooks/data';
import { ACCOUNT_TYPE_LABELS } from '@/lib/accounts';
import { METHOD_ICONS } from '@/lib/payment-methods';
import {
  daysBetweenInclusive,
  elapsedDays,
  formatDayLabel,
  formatMonthLabel,
  formatShortDate,
  monthDiff,
  previousRange,
  todayISO,
  yearAgoRange,
} from '@/lib/dates';
import { savingsRate } from '@/lib/insights';
import { formatMoney, percentOf } from '@/lib/money';
import { invalidateFinancialData, qk } from '@/lib/query';
import {
  fetchAccountBreakdown,
  fetchCategoryBreakdown,
  fetchMerchantBreakdown,
  fetchSummary,
  fetchTimeSeries,
  type Bucket,
} from '@/services/reports';
import { fetchLargestExpenses } from '@/services/transactions';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import type { PeriodSummary } from '@/types/domain';

type Tab = 'overview' | 'categories' | 'merchants' | 'accounts';

function bucketFor(start: string, end: string): Bucket {
  const days = daysBetweenInclusive(start, end);
  return days <= 31 ? 'day' : days <= 120 ? 'week' : 'month';
}

function bucketLabel(bucket: Bucket, iso: string) {
  if (bucket === 'month') return formatMonthLabel(iso, true);
  const d = new Date(iso);
  return bucket === 'day' ? String(Number(iso.slice(8, 10))) : `${d.getDate()}/${d.getMonth() + 1}`;
}

export default function ReportsScreen() {
  const { colors } = useTheme();
  const currency = useCurrency();
  const [range, setRange] = useState<RangeValue>(defaultRange);
  const [tab, setTab] = useState<Tab>('overview');
  const [refreshing, setRefreshing] = useState(false);
  const { start, end } = range.range;
  const prev = useMemo(() => previousRange(range.range), [range.range]);
  const yoy = useMemo(() => yearAgoRange(range.range), [range.range]);
  const bucket = bucketFor(start, end);

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
  const series = useQuery({
    queryKey: qk.report('series', start, end, bucket),
    queryFn: () => fetchTimeSeries(start, end, bucket),
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
    enabled: tab === 'accounts',
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
  const elapsed = Math.max(1, elapsedDays(range.range, todayISO()));
  const months = Math.max(1, monthDiff(start, end > todayISO() ? todayISO() : end) + 1);

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
      <RangePicker value={range} onChange={setRange} />
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
          <Card
            variant="elevated"
            style={{ padding: spacing.xl, gap: spacing.lg, marginBottom: spacing.xxl }}
          >
            <Row align="flex-start">
              <Stat label="Income">
                {s ? (
                  <MoneyText
                    minor={s.income}
                    currency={currency}
                    variant="headline"
                    tone="positive"
                    options={{ decimals: 'never' }}
                  />
                ) : (
                  <Skeleton width={80} height={22} />
                )}
              </Stat>
              <Stat label="Expenses">
                {s ? (
                  <MoneyText
                    minor={s.expense}
                    currency={currency}
                    variant="headline"
                    options={{ decimals: 'never' }}
                  />
                ) : (
                  <Skeleton width={80} height={22} />
                )}
              </Stat>
              <Stat label="Net">
                {s ? (
                  <MoneyText
                    minor={s.net}
                    currency={currency}
                    variant="headline"
                    colorBySign
                    options={{ decimals: 'never' }}
                  />
                ) : (
                  <Skeleton width={80} height={22} />
                )}
              </Stat>
            </Row>
            <Divider />
            <Row align="flex-start">
              <Stat label="Savings rate">
                <Text variant="bodyStrong">{s && savingsRate(s) !== null ? `${savingsRate(s)}%` : '—'}</Text>
              </Stat>
              <Stat label="Avg / day">
                {s ? (
                  <MoneyText
                    minor={Math.round(s.expense / elapsed)}
                    currency={currency}
                    variant="bodyStrong"
                    options={{ decimals: 'never' }}
                  />
                ) : (
                  <Text>—</Text>
                )}
              </Stat>
              <Stat label="Avg / month">
                {s ? (
                  <MoneyText
                    minor={Math.round(s.expense / months)}
                    currency={currency}
                    variant="bodyStrong"
                    options={{ decimals: 'never' }}
                  />
                ) : (
                  <Text>—</Text>
                )}
              </Stat>
            </Row>
            <Divider />
            <Comparison label="vs previous period" current={s} other={prevSummary.data} currency={currency} />
            <Comparison
              label="vs same period last year"
              current={s}
              other={yoySummary.data}
              currency={currency}
            />
          </Card>

          <Section title="Income vs expenses">
            <Card>
              {series.data ? (
                <BarChart
                  currency={currency}
                  series={[
                    { name: 'Income', color: colors.positive },
                    { name: 'Expenses', color: colors.brand },
                  ]}
                  data={series.data.map((p) => ({
                    label: bucketLabel(bucket, p.bucket),
                    values: [p.income, p.expense],
                  }))}
                />
              ) : (
                <Skeleton height={200} />
              )}
            </Card>
          </Section>

          <Section title="Cash flow">
            <Card>
              {series.data ? (
                <LineChart
                  currency={currency}
                  color={colors.info}
                  title="Cumulative net (income − expenses)"
                  points={series.data.reduce<{ label: string; value: number }[]>((acc, p) => {
                    const prevVal = acc.length ? acc[acc.length - 1].value : 0;
                    acc.push({
                      label: bucket === 'month' ? formatMonthLabel(p.bucket) : formatDayLabel(p.bucket),
                      value: prevVal + p.income - p.expense,
                    });
                    return acc;
                  }, [])}
                />
              ) : (
                <Skeleton height={180} />
              )}
            </Card>
          </Section>

          {s && s.expense > 0 ? (
            <Section title="Spending mix">
              <Card style={{ gap: spacing.lg }}>
                <MixRow
                  label="Essential"
                  value={s.essentialExpense}
                  total={s.expense}
                  color={colors.info}
                  currency={currency}
                />
                <MixRow
                  label="Discretionary"
                  value={s.discretionaryExpense}
                  total={s.expense}
                  color={colors.brand}
                  currency={currency}
                />
                <MixRow
                  label="Unclassified"
                  value={s.expense - s.essentialExpense - s.discretionaryExpense}
                  total={s.expense}
                  color={colors.textTertiary}
                  currency={currency}
                />
                <Divider />
                <MixRow
                  label="Recurring expenses"
                  value={s.recurringExpense}
                  total={s.expense}
                  color={colors.transfer}
                  currency={currency}
                />
                <MixRow
                  label="Subscriptions"
                  value={s.subscriptionExpense}
                  total={s.expense}
                  color={colors.transfer}
                  currency={currency}
                />
                <Text variant="caption" tone="tertiary">
                  Essential/discretionary follows how you classify categories (More → Categories).
                </Text>
              </Card>
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
            <Card>
              {categories.data === undefined ? (
                <Skeleton height={260} />
              ) : categories.data.length === 0 ? (
                <EmptyState compact icon="pie-chart-outline" title="No spending in this period" />
              ) : (
                <CategoryBreakdown
                  categories={categories.data}
                  currency={currency}
                  max={8}
                  onPressCategory={(c) =>
                    router.push({
                      pathname: '/report-detail',
                      params: { categoryId: c.categoryId!, start, end },
                    })
                  }
                />
              )}
            </Card>
          </Section>
          {incomeCats.data?.length ? (
            <Section title="Income by category">
              <Card>
                <CategoryBreakdown categories={incomeCats.data} currency={currency} max={6} />
              </Card>
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
            <Card style={{ gap: spacing.lg }}>
              {merchants.data.map((m) => (
                <Pressable
                  key={m.merchantId}
                  onPress={() => router.push({ pathname: '/merchants/[id]', params: { id: m.merchantId } })}
                  accessibilityRole="button"
                  style={{ gap: 6 }}
                >
                  <Row justify="space-between">
                    <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                      {m.name}
                    </Text>
                    <MoneyText
                      minor={m.total}
                      currency={currency}
                      variant="subhead"
                      options={{ decimals: 'never' }}
                    />
                  </Row>
                  <ShareBar
                    fraction={merchants.data[0].total ? m.total / merchants.data[0].total : 0}
                    color={colors.brand}
                  />
                  <Text variant="caption" tone="secondary">
                    {m.count} × · avg {formatMoney(m.average, currency, { decimals: 'never' })} · largest{' '}
                    {formatMoney(m.largest, currency, { decimals: 'never' })}
                  </Text>
                </Pressable>
              ))}
            </Card>
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
            <Card style={{ gap: spacing.lg }}>
              {accounts.data.map((a) => {
                const max = Math.max(...accounts.data.map((x) => x.expense), 1);
                return (
                  <Pressable
                    key={a.accountId}
                    onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: a.accountId } })}
                    accessibilityRole="button"
                    style={{ gap: 6 }}
                  >
                    <Row gap={spacing.md}>
                      <IconBadge icon={METHOD_ICONS[a.type]} size={32} />
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyStrong">{a.name}</Text>
                        <Text variant="caption" tone="secondary">
                          {ACCOUNT_TYPE_LABELS[a.type]} · {a.count} transactions
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <MoneyText
                          minor={a.expense}
                          currency={currency}
                          variant="subhead"
                          options={{ decimals: 'never' }}
                        />
                        {a.income ? (
                          <MoneyText
                            minor={a.income}
                            currency={currency}
                            variant="caption"
                            tone="positive"
                            options={{ signed: true, decimals: 'never' }}
                          />
                        ) : null}
                      </View>
                    </Row>
                    <ShareBar fraction={a.expense / max} color={colors.brand} />
                  </Pressable>
                );
              })}
            </Card>
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

function MixRow({
  label,
  value,
  total,
  color,
  currency,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  currency: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Row justify="space-between">
        <Text variant="callout">{label}</Text>
        <Text variant="subhead" tone="secondary">
          {formatMoney(value, currency, { decimals: 'never' })} · {Math.round(percentOf(value, total))}%
        </Text>
      </Row>
      <ShareBar fraction={total ? value / total : 0} color={color} />
    </View>
  );
}
