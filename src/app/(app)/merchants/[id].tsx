/**
 * Merchant analytics: lifetime totals, monthly spending, category mix,
 * history — plus rename, merge and archive.
 */
import { useQuery } from '@tanstack/react-query';
import { addMonths, startOfMonth } from 'date-fns';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';

import { BarChart } from '@/components/charts';
import { Button, TextField } from '@/components/ui/controls';
import { EmptyState, Skeleton, SkeletonList, useToast } from '@/components/ui/feedback';
import { Screen, Section, Stat } from '@/components/ui/layout';
import { SelectSheet } from '@/components/ui/pickers';
import { Card, MoneyText, Row, Text } from '@/components/ui/primitives';
import { CategoryBreakdown } from '@/features/dashboard/widgets';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { useAppMutation, useCurrency, useMerchants, useTransactionsInfinite } from '@/hooks/data';
import { formatMonthLabel, formatShortDate, todayISO, toISODate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { invalidateFinancialData, qk } from '@/lib/query';
import { mergeMerchants, updateMerchant } from '@/services/core';
import { fetchCategoryBreakdown, fetchMerchantStats, fetchTimeSeries } from '@/services/reports';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

export default function MerchantDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const toast = useToast();
  const currency = useCurrency();
  const merchants = useMerchants();
  const merchant = merchants.data?.find((m) => m.id === id);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [merging, setMerging] = useState(false);

  const stats = useQuery({ queryKey: qk.merchantStats(id), queryFn: () => fetchMerchantStats(id) });
  const start = toISODate(startOfMonth(addMonths(new Date(), -11)));
  const end = todayISO();
  const series = useQuery({
    queryKey: qk.report('merchant-series', id, start),
    queryFn: () => fetchTimeSeries(start, end, 'month', { merchantId: id }),
  });
  const cats = useQuery({
    queryKey: qk.report('merchant-cats', id),
    queryFn: () => fetchCategoryBreakdown('2000-01-01', end, { merchantId: id }),
  });
  const filters = useMemo(() => ({ merchantIds: [id] }), [id]);
  const history = useTransactionsInfinite(filters);

  const rename = useAppMutation((n: string) => updateMerchant(id, { name: n }), {
    invalidate: 'financial',
    success: 'Merchant renamed',
    onSuccess: () => setRenaming(false),
    context: 'rename-merchant',
  });

  if (!merchant)
    return (
      <Screen>
        {merchants.isPending ? <SkeletonList rows={4} /> : <EmptyState title="Merchant not found" />}
      </Screen>
    );

  const confirmMerge = (targetId: string) => {
    const target = merchants.data?.find((m) => m.id === targetId);
    if (!target) return;
    Alert.alert(
      `Merge into “${target.name}”?`,
      `All transactions from “${merchant.name}” move to “${target.name}”, and “${merchant.name}” is removed. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Merge',
          style: 'destructive',
          onPress: async () => {
            try {
              const moved = await mergeMerchants(merchant.id, target.id);
              await invalidateFinancialData();
              toast.show(`Merged ${moved} transaction${moved === 1 ? '' : 's'}`);
              router.replace({ pathname: '/merchants/[id]', params: { id: target.id } });
            } catch (e) {
              toast.show(describeError(e).message, 'error');
            }
          },
        },
      ],
    );
  };

  const s = stats.data;
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: merchant.name }} />
      <Card variant="elevated" style={{ padding: spacing.xl, gap: spacing.lg, marginBottom: spacing.xxl }}>
        <View>
          <Text variant="overline" tone="secondary">
            Total spent
          </Text>
          {s ? (
            <MoneyText
              minor={s.total}
              currency={currency}
              variant="display"
              options={{ decimals: 'never' }}
            />
          ) : (
            <Skeleton width={160} height={40} />
          )}
          {s?.firstAt ? (
            <Text variant="footnote" tone="secondary">
              Since {formatShortDate(new Date(s.firstAt))}
            </Text>
          ) : null}
        </View>
        <Row>
          <Stat label="Transactions">
            <Text variant="bodyStrong">{s?.count ?? '–'}</Text>
          </Stat>
          <Stat label="Average">
            {s ? (
              <MoneyText
                minor={s.average}
                currency={currency}
                variant="bodyStrong"
                options={{ decimals: 'never' }}
              />
            ) : (
              <Text>–</Text>
            )}
          </Stat>
          <Stat label="Largest">
            {s ? (
              <MoneyText
                minor={s.largest}
                currency={currency}
                variant="bodyStrong"
                options={{ decimals: 'never' }}
              />
            ) : (
              <Text>–</Text>
            )}
          </Stat>
        </Row>
      </Card>

      <Section title="Monthly spending">
        <Card>
          {series.data ? (
            <BarChart
              currency={currency}
              series={[{ name: 'Spent', color: colors.brand }]}
              data={series.data.map((p) => ({
                label: formatMonthLabel(p.bucket, true),
                values: [p.expense],
              }))}
            />
          ) : (
            <Skeleton height={200} />
          )}
        </Card>
      </Section>

      {cats.data && cats.data.length > 1 ? (
        <Section title="Category mix">
          <Card>
            <CategoryBreakdown categories={cats.data} currency={currency} />
          </Card>
        </Section>
      ) : null}

      <Section title="History">
        {items.length === 0 && history.isPending ? <SkeletonList rows={4} /> : null}
        {items.map((t) => (
          <TransactionRow key={t.id} t={t} showDate />
        ))}
        {history.hasNextPage ? (
          <Button
            title="Load more"
            variant="ghost"
            size="md"
            onPress={() => void history.fetchNextPage()}
            loading={history.isFetchingNextPage}
          />
        ) : null}
      </Section>

      <Section title="Manage">
        {renaming ? (
          <View style={{ gap: spacing.md }}>
            <TextField
              value={name}
              onChangeText={setName}
              autoFocus
              maxLength={80}
              placeholder="Merchant name"
            />
            <Row gap={spacing.md}>
              <Button
                title="Cancel"
                variant="secondary"
                size="md"
                style={{ flex: 1 }}
                onPress={() => setRenaming(false)}
              />
              <Button
                title="Save"
                size="md"
                style={{ flex: 1 }}
                loading={rename.isPending}
                onPress={() => name.trim() && rename.mutate(name)}
              />
            </Row>
          </View>
        ) : (
          <View style={{ gap: spacing.md }}>
            <Button
              title="Rename"
              icon="create-outline"
              variant="secondary"
              onPress={() => {
                setName(merchant.name);
                setRenaming(true);
              }}
            />
            <Button
              title="Merge into another merchant"
              icon="git-merge-outline"
              variant="secondary"
              onPress={() => setMerging(true)}
            />
            <Button
              title="Archive"
              icon="archive-outline"
              variant="destructive"
              onPress={async () => {
                try {
                  await updateMerchant(merchant.id, { isArchived: true });
                  await invalidateFinancialData();
                  toast.show('Merchant archived');
                  router.back();
                } catch (e) {
                  toast.show(describeError(e).message, 'error');
                }
              }}
            />
          </View>
        )}
      </Section>

      <SelectSheet
        visible={merging}
        title="Merge into"
        searchable
        options={(merchants.data ?? [])
          .filter((m) => m.id !== merchant.id && !m.isArchived)
          .map((m) => ({ value: m.id, label: m.name }))}
        onClose={() => setMerging(false)}
        onSelect={(v) => v && setTimeout(() => confirmMerge(v), 450)}
      />
    </Screen>
  );
}
