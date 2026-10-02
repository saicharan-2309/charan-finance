/** Category drill-down: subcategories, trend, merchants and transactions. */
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { BarChart } from '@/components/charts';
import { Button } from '@/components/ui/controls';
import { Skeleton, SkeletonList } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, MoneyText, Row, Text } from '@/components/ui/primitives';
import { CategoryBreakdown } from '@/features/dashboard/widgets';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { useCategoryIndex, useCurrency, useTransactionsInfinite } from '@/hooks/data';
import { daysBetweenInclusive, formatMonthLabel, formatShortDate } from '@/lib/dates';
import { qk } from '@/lib/query';
import { fetchCategoryBreakdown, fetchMerchantBreakdown, fetchTimeSeries } from '@/services/reports';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

export default function ReportDetail() {
  const { categoryId, start, end } = useLocalSearchParams<{
    categoryId: string;
    start: string;
    end: string;
  }>();
  const { colors } = useTheme();
  const currency = useCurrency();
  const { index } = useCategoryIndex();
  const category = index.byId.get(categoryId);
  const bucket = daysBetweenInclusive(start, end) <= 62 ? 'week' : 'month';

  const subs = useQuery({
    queryKey: qk.report('subcats', categoryId, start, end),
    queryFn: () => fetchCategoryBreakdown(start, end, { parentId: categoryId }),
  });
  const series = useQuery({
    queryKey: qk.report('cat-series', categoryId, start, end, bucket),
    queryFn: () => fetchTimeSeries(start, end, bucket, { categoryId }),
  });
  const merchants = useQuery({
    queryKey: qk.report('cat-merchants', categoryId, start, end),
    queryFn: () => fetchMerchantBreakdown(start, end, 5, categoryId),
  });
  const filters = useMemo(() => {
    const [sy, sm, sd] = start.split('-').map(Number);
    const [ey, em, ed] = end.split('-').map(Number);
    return {
      categoryIds: [categoryId],
      from: new Date(sy, sm - 1, sd).toISOString(),
      to: new Date(ey, em - 1, ed, 23, 59, 59, 999).toISOString(),
    };
  }, [categoryId, start, end]);
  const tx = useTransactionsInfinite(filters);
  const items = tx.data?.pages.flatMap((p) => p.items) ?? [];
  const total = (subs.data ?? []).reduce((s, c) => s + c.total, 0);

  return (
    <Screen>
      <Stack.Screen options={{ title: category?.name ?? 'Category' }} />
      <Text variant="footnote" tone="secondary">
        {formatShortDate(start)} – {formatShortDate(end)}
      </Text>
      <MoneyText
        minor={total}
        currency={currency}
        variant="display"
        options={{ decimals: 'never' }}
        style={{ marginBottom: spacing.xl }}
      />

      {subs.data && subs.data.length > 1 ? (
        <Section title="Subcategories">
          <Card>
            <CategoryBreakdown
              categories={subs.data.map((c) => ({ ...c, color: c.color ?? category?.color ?? null }))}
              currency={currency}
            />
          </Card>
        </Section>
      ) : null}

      <Section title="Trend">
        <Card>
          {series.data ? (
            <BarChart
              currency={currency}
              series={[{ name: category?.name ?? 'Spent', color: category?.color ?? colors.brand }]}
              data={series.data.map((p) => ({
                label:
                  bucket === 'month'
                    ? formatMonthLabel(p.bucket, true)
                    : `${Number(p.bucket.slice(8, 10))}/${Number(p.bucket.slice(5, 7))}`,
                values: [p.expense],
              }))}
            />
          ) : (
            <Skeleton height={200} />
          )}
        </Card>
      </Section>

      {merchants.data?.length ? (
        <Section title="Top merchants">
          <Card style={{ gap: spacing.md }}>
            {merchants.data.map((m) => (
              <Row key={m.merchantId} justify="space-between">
                <Text
                  variant="body"
                  tone="brand"
                  onPress={() => router.push({ pathname: '/merchants/[id]', params: { id: m.merchantId } })}
                >
                  {m.name}
                </Text>
                <MoneyText
                  minor={m.total}
                  currency={currency}
                  variant="subhead"
                  options={{ decimals: 'never' }}
                />
              </Row>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Transactions">
        {tx.isPending ? (
          <SkeletonList rows={5} />
        ) : (
          items.map((t) => <TransactionRow key={t.id} t={t} showDate />)
        )}
        {tx.hasNextPage ? (
          <Button
            title="Load more"
            variant="ghost"
            size="md"
            onPress={() => void tx.fetchNextPage()}
            loading={tx.isFetchingNextPage}
          />
        ) : null}
      </Section>
    </Screen>
  );
}
