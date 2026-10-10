/**
 * All transactions: global search, filters, sort, day-grouped list with
 * incremental loading (40 rows per page — never the whole history in memory).
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { TAB_BAR_HEIGHT } from '@/components/ui/layout';
import { SelectSheet } from '@/components/ui/pickers';
import { Divider, Icon, MoneyText, Row, Text } from '@/components/ui/primitives';
import { PageHeader, Pill, RoundButton } from '@/components/ui/ref';
import {
  countActiveFilters,
  FilterSheet,
  toServiceFilters,
  type FilterState,
} from '@/features/transactions/FilterSheet';
import { PendingTransactions, SyncBanner } from '@/features/transactions/SyncStatus';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { useCurrency, useTransactionsInfinite } from '@/hooks/data';
import { formatDayLabel, RANGE_PRESET_LABELS, toISODate } from '@/lib/dates';
import { invalidateFinancialData } from '@/lib/query';
import { AuroraBackground } from '@/components/ui/gradient';
import { useTheme } from '@/theme/ThemeProvider';
import { continuous, GUTTER, radius, spacing } from '@/theme/tokens';
import type { Transaction } from '@/types/domain';

const PRESETS = [
  'this_month',
  'last_month',
  'last_3_months',
  'last_6_months',
  'this_year',
  'last_year',
] as const;

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
  const [presetOpen, setPresetOpen] = useState(false);
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

  const type = filters.types?.length === 1 ? filters.types[0] : null;
  const setType = (t: 'income' | 'expense' | 'transfer' | null) =>
    setFilters((f) => ({ ...f, types: t ? [t] : undefined }));
  const presetLabel = filters.rangePreset ? RANGE_PRESET_LABELS[filters.rangePreset] : 'All time';
  // The category pill shows how many category/account/amount filters are set.
  const extra = active - (filters.types?.length ? 1 : 0) - (filters.rangePreset ? 1 : 0);

  const header = (
    <View style={{ paddingTop: insets.top + spacing.sm }}>
      <PageHeader
        title="Transactions"
        right={
          <RoundButton
            icon="options-outline"
            label="Filters"
            badge={active || undefined}
            onPress={() => setSheet(true)}
          />
        }
      />
      <SyncBanner />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          height: 48,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.pill,
          backgroundColor: colors.surface,
          marginBottom: spacing.lg,
          ...(scheme === 'light' ? elevation.card : null),
        }}
      >
        <Icon name="search" size={18} tone="tertiary" />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search transactions, merchants…"
          placeholderTextColor={colors.textTertiary}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
          accessibilityLabel="Search transactions"
          style={{ flex: 1, color: colors.text, fontSize: 15, height: 48 }}
        />
      </View>
      <Row gap={spacing.sm} style={{ marginBottom: spacing.md }}>
        <Pill label="All" selected={!type} onPress={() => setType(null)} />
        <Pill label="Income" selected={type === 'income'} onPress={() => setType('income')} />
        <Pill label="Expenses" selected={type === 'expense'} onPress={() => setType('expense')} />
        <Pill label="Transfers" selected={type === 'transfer'} onPress={() => setType('transfer')} />
      </Row>
      <Row justify="space-between" style={{ marginBottom: spacing.lg }}>
        <Pill
          label={presetLabel}
          trailingIcon="chevron-down"
          onPress={() => setPresetOpen(true)}
          accessibilityLabel={`Period: ${presetLabel}. Change`}
        />
        <Pill
          label={extra > 0 ? `Category · ${extra}` : 'Category'}
          icon="settings-outline"
          selected={extra > 0}
          onPress={() => setSheet(true)}
        />
      </Row>
      {!active && !debounced ? <PendingTransactions /> : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AuroraBackground />
      <SectionList
        sections={sections}
        keyExtractor={(t) => t.id}
        stickySectionHeadersEnabled={false}
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
              alignItems: 'center',
              paddingTop: spacing.md,
              paddingBottom: spacing.sm,
              paddingHorizontal: 4,
            }}
          >
            <Text variant="bodyStrong" style={{ fontSize: 16 }}>
              {section.title}
            </Text>
            {byDate && section.net !== 0 ? (
              <MoneyText
                minor={section.net}
                currency={currency}
                variant="bodyStrong"
                tone={section.net > 0 ? 'positive' : 'primary'}
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
      <SelectSheet
        visible={presetOpen}
        title="Period"
        noneLabel="All time"
        options={PRESETS.map((p) => ({ value: p, label: RANGE_PRESET_LABELS[p] }))}
        selected={filters.rangePreset ?? null}
        onSelect={(p) => {
          setFilters((f) => ({ ...f, rangePreset: (p as FilterState['rangePreset']) ?? null }));
          setPresetOpen(false);
        }}
        onClose={() => setPresetOpen(false)}
      />
    </View>
  );
}
