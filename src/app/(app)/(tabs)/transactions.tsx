/**
 * All transactions: global search, filters, sort, day-grouped list with
 * incremental loading (40 rows per page — never the whole history in memory).
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TextField } from '@/components/ui/controls';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { TAB_BAR_HEIGHT } from '@/components/ui/layout';
import { Divider, Icon, MoneyText, Text } from '@/components/ui/primitives';
import {
  countActiveFilters,
  FilterSheet,
  toServiceFilters,
  type FilterState,
} from '@/features/transactions/FilterSheet';
import { PendingTransactions, SyncBanner } from '@/features/transactions/SyncStatus';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { useCurrency, useTransactionsInfinite } from '@/hooks/data';
import { formatDayLabel, toISODate } from '@/lib/dates';
import { invalidateFinancialData } from '@/lib/query';
import { useTheme } from '@/theme/ThemeProvider';
import { continuous, GUTTER, radius, spacing } from '@/theme/tokens';
import type { Transaction } from '@/types/domain';

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function TransactionsScreen() {
  const { colors, scheme, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const currency = useCurrency();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterState>({});
  const [sheet, setSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const debounced = useDebounced(search);

  const serviceFilters = useMemo(() => toServiceFilters(filters, debounced), [filters, debounced]);
  const query = useTransactionsInfinite(serviceFilters);
  const byDate = !filters.sort || filters.sort.startsWith('date');

  const sections = useMemo(() => {
    const seen = new Set<string>();
    const items: Transaction[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const t of page.items) {
        if (!seen.has(t.id)) {
          seen.add(t.id);
          items.push(t);
        }
      }
    }
    if (!byDate) return items.length ? [{ title: 'Results', key: 'all', net: 0, data: items }] : [];
    const groups = new Map<string, Transaction[]>();
    for (const t of items) {
      const day = toISODate(new Date(t.occurredAt));
      groups.set(day, [...(groups.get(day) ?? []), t]);
    }
    return [...groups.entries()].map(([day, data]) => ({
      title: formatDayLabel(day),
      key: day,
      net: data.reduce(
        (s, t) => s + (t.type === 'expense' ? -t.amount : t.type === 'income' ? t.amount : 0),
        0,
      ),
      data,
    }));
  }, [query.data, byDate]);

  const active = countActiveFilters(filters);

  const header = (
    <View style={{ paddingTop: insets.top + spacing.md }}>
      <Text variant="largeTitle" accessibilityRole="header" style={{ marginBottom: spacing.lg }}>
        Transactions
      </Text>
      <SyncBanner />
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
        <TextField
          containerStyle={{ flex: 1 }}
          value={search}
          onChangeText={setSearch}
          placeholder="Search merchant, note, tag, amount…"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
          leading={<Icon name="search" size={18} tone="tertiary" />}
          accessibilityLabel="Search transactions"
        />
        <Pressable
          onPress={() => setSheet(true)}
          accessibilityRole="button"
          accessibilityLabel={`Filters${active ? `, ${active} active` : ''}`}
          style={{
            width: 52,
            height: 52,
            borderRadius: radius.md,
            ...continuous,
            backgroundColor: active ? colors.text : colors.surface,
            ...(scheme === 'light' ? elevation.card : null),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="options-outline" size={22} color={active ? colors.background : colors.text} />
          {active ? (
            <View
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                minWidth: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: colors.brand,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="caption" style={{ color: colors.onBrand, fontSize: 10 }}>
                {active}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      {!active && !debounced ? <PendingTransactions /> : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SectionList
        sections={sections}
        keyExtractor={(t) => t.id}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          paddingHorizontal: GUTTER,
          paddingBottom: TAB_BAR_HEIGHT + insets.bottom + spacing.xxl,
        }}
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => (
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              paddingTop: spacing.md,
              paddingBottom: spacing.sm,
              paddingHorizontal: 4,
              backgroundColor: colors.background,
            }}
          >
            <Text variant="subhead" tone="secondary">
              {section.title}
            </Text>
            {byDate && section.net !== 0 ? (
              <MoneyText
                minor={section.net}
                currency={currency}
                variant="subhead"
                tone="secondary"
                options={{ signed: true, decimals: 'never' }}
              />
            ) : null}
          </View>
        )}
        renderItem={({ item, index, section }) => {
          // Each day is an inset grouped list: one white card, rows split by hairlines.
          const first = index === 0;
          const last = index === section.data.length - 1;
          return (
            <View
              style={{
                backgroundColor: colors.surface,
                paddingHorizontal: spacing.lg,
                borderTopLeftRadius: first ? radius.xl : 0,
                borderTopRightRadius: first ? radius.xl : 0,
                borderBottomLeftRadius: last ? radius.xl : 0,
                borderBottomRightRadius: last ? radius.xl : 0,
                ...continuous,
                paddingTop: first ? spacing.xs : 0,
                paddingBottom: last ? spacing.xs : 0,
                marginBottom: last ? spacing.sm : 0,
              }}
            >
              {first ? null : <Divider inset={54} />}
              <TransactionRow t={item} showDate={!byDate} />
            </View>
          );
        }}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await invalidateFinancialData();
              setRefreshing(false);
            }}
            tintColor={colors.textSecondary}
          />
        }
        ListEmptyComponent={
          query.isPending ? (
            <SkeletonList rows={8} />
          ) : query.error ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : debounced || active ? (
            <EmptyState
              icon="search-outline"
              title="No matching transactions"
              message="Try a different search or clear the filters."
              actionLabel={active ? 'Clear filters' : undefined}
              onAction={() => setFilters({})}
            />
          ) : (
            <EmptyState
              icon="receipt-outline"
              title="No transactions yet"
              message="Tap the + button to add your first expense."
            />
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: spacing.xl }} /> : null
        }
        initialNumToRender={14}
        windowSize={11}
        removeClippedSubviews
      />
      <FilterSheet visible={sheet} value={filters} onApply={setFilters} onClose={() => setSheet(false)} />
    </View>
  );
}
