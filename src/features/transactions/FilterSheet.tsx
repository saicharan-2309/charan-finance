/**
 * Full filter panel for the Transactions screen: type, date range, category,
 * payment method, merchant, amount range and sort order.
 */
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, SegmentedControl, TextField } from '@/components/ui/controls';
import { SelectSheet } from '@/components/ui/pickers';
import { Text } from '@/components/ui/primitives';
import { useAccounts, useCategoryIndex, useMerchants } from '@/hooks/data';
import { RANGE_PRESET_LABELS, rangeForPreset, type RangePreset } from '@/lib/dates';
import { minorToInput, parseAmountInput, sanitizeAmountKeystrokes } from '@/lib/money';
import { accountVisual, GROUP_LABELS, groupAccounts } from '@/lib/payment-methods';
import type { TransactionFilters, TransactionSort } from '@/services/transactions';
import { useTheme } from '@/theme/ThemeProvider';
import { GUTTER, spacing } from '@/theme/tokens';
import type { TxnType } from '@/types/domain';

export interface FilterState extends TransactionFilters {
  rangePreset?: Exclude<RangePreset, 'custom'> | null;
}

export function countActiveFilters(f: FilterState): number {
  return (
    (f.types?.length ? 1 : 0) +
    (f.categoryIds?.length ? 1 : 0) +
    (f.accountIds?.length ? 1 : 0) +
    (f.merchantIds?.length ? 1 : 0) +
    (f.minAmount != null || f.maxAmount != null ? 1 : 0) +
    (f.rangePreset ? 1 : 0) +
    (f.sort && f.sort !== 'date_desc' ? 1 : 0)
  );
}

/** Converts the UI state into service filters (date preset → instants). */
export function toServiceFilters(f: FilterState, search: string): TransactionFilters {
  const out: TransactionFilters = { ...f, search: search.trim() || undefined };
  delete (out as FilterState).rangePreset;
  if (f.rangePreset) {
    const r = rangeForPreset(f.rangePreset);
    const [sy, sm, sd] = r.start.split('-').map(Number);
    const [ey, em, ed] = r.end.split('-').map(Number);
    out.from = new Date(sy, sm - 1, sd).toISOString();
    out.to = new Date(ey, em - 1, ed, 23, 59, 59, 999).toISOString();
  }
  return out;
}

const toggle = <T,>(list: T[] | undefined, v: T): T[] => {
  const l = list ?? [];
  return l.includes(v) ? l.filter((x) => x !== v) : [...l, v];
};

export function FilterSheet({
  visible,
  value,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: FilterState;
  onApply: (f: FilterState) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<FilterState>(value);
  const [minText, setMinText] = useState(value.minAmount != null ? minorToInput(value.minAmount) : '');
  const [maxText, setMaxText] = useState(value.maxAmount != null ? minorToInput(value.maxAmount) : '');
  const [merchantPicker, setMerchantPicker] = useState(false);
  const accounts = useAccounts().data ?? [];
  const merchants = useMerchants().data ?? [];
  const { index } = useCategoryIndex();
  const categories = [...index.top('expense', true), ...index.top('income', true)];

  const presets: Exclude<RangePreset, 'custom'>[] = [
    'this_month',
    'last_month',
    'last_3_months',
    'last_6_months',
    'this_year',
    'last_year',
  ];

  const apply = () => {
    onApply({ ...draft, minAmount: parseAmountInput(minText), maxAmount: parseAmountInput(maxText) });
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onShow={() => setDraft(value)}
    >
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: GUTTER,
            paddingTop: spacing.xl,
            paddingBottom: spacing.md,
          }}
        >
          <Pressable
            onPress={() => {
              setDraft({});
              setMinText('');
              setMaxText('');
            }}
            hitSlop={10}
            accessibilityRole="button"
          >
            <Text variant="body" tone="secondary">
              Reset
            </Text>
          </Pressable>
          <Text variant="headline">Filters</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text variant="body" tone="secondary">
              Cancel
            </Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: spacing.xxl, gap: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <FilterGroup title="Sort by">
            <SegmentedControl<TransactionSort>
              value={draft.sort ?? 'date_desc'}
              onChange={(sort) => setDraft((d) => ({ ...d, sort }))}
              options={[
                { value: 'date_desc', label: 'Newest' },
                { value: 'date_asc', label: 'Oldest' },
                { value: 'amount_desc', label: 'Highest' },
                { value: 'amount_asc', label: 'Lowest' },
              ]}
            />
          </FilterGroup>

          <FilterGroup title="Type">
            {(['expense', 'income', 'transfer', 'adjustment'] as TxnType[]).map((t) => (
              <Chip
                key={t}
                label={t === 'transfer' ? 'Transfer & card payment' : t[0].toUpperCase() + t.slice(1)}
                selected={draft.types?.includes(t)}
                onPress={() => setDraft((d) => ({ ...d, types: toggle(d.types, t) }))}
              />
            ))}
          </FilterGroup>

          <FilterGroup title="Date">
            <Chip
              label="All time"
              selected={!draft.rangePreset}
              onPress={() => setDraft((d) => ({ ...d, rangePreset: null }))}
            />
            {presets.map((p) => (
              <Chip
                key={p}
                label={RANGE_PRESET_LABELS[p]}
                selected={draft.rangePreset === p}
                onPress={() => setDraft((d) => ({ ...d, rangePreset: p }))}
              />
            ))}
          </FilterGroup>

          <FilterGroup title="Category">
            {categories.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                icon={c.icon}
                color={c.color}
                selected={draft.categoryIds?.includes(c.id)}
                onPress={() => setDraft((d) => ({ ...d, categoryIds: toggle(d.categoryIds, c.id) }))}
              />
            ))}
          </FilterGroup>

          {/* Payment method — grouped so cards, cash and banks are easy to spot. */}
          {groupAccounts(accounts).map(({ group, items }) => (
            <FilterGroup key={group} title={GROUP_LABELS[group]}>
              {items.map((a) => {
                const visual = accountVisual(a);
                return (
                  <Chip
                    key={a.id}
                    label={a.name}
                    icon={visual.icon}
                    color={visual.color}
                    selected={draft.accountIds?.includes(a.id)}
                    onPress={() => setDraft((d) => ({ ...d, accountIds: toggle(d.accountIds, a.id) }))}
                  />
                );
              })}
            </FilterGroup>
          ))}

          <FilterGroup title="Merchant">
            {(draft.merchantIds ?? []).map((id) => (
              <Chip
                key={id}
                label={merchants.find((m) => m.id === id)?.name ?? 'Merchant'}
                selected
                onPress={() => setDraft((d) => ({ ...d, merchantIds: toggle(d.merchantIds, id) }))}
              />
            ))}
            <Chip label="+ Add merchant" onPress={() => setMerchantPicker(true)} />
          </FilterGroup>

          <View style={{ gap: spacing.md }}>
            <Text variant="overline" tone="secondary">
              Amount
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <TextField
                containerStyle={{ flex: 1 }}
                placeholder="Min"
                keyboardType="decimal-pad"
                value={minText}
                onChangeText={(t) => setMinText(sanitizeAmountKeystrokes(t))}
              />
              <TextField
                containerStyle={{ flex: 1 }}
                placeholder="Max"
                keyboardType="decimal-pad"
                value={maxText}
                onChangeText={(t) => setMaxText(sanitizeAmountKeystrokes(t))}
              />
            </View>
          </View>
        </ScrollView>
        <View
          style={{
            paddingHorizontal: GUTTER,
            paddingTop: spacing.md,
            paddingBottom: insets.bottom + spacing.md,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Button title="Show results" onPress={apply} />
        </View>
      </View>
      <SelectSheet
        visible={merchantPicker}
        title="Merchant"
        searchable
        options={merchants.map((m) => ({ value: m.id, label: m.name }))}
        onClose={() => setMerchantPicker(false)}
        onSelect={(id) =>
          id && setDraft((d) => ({ ...d, merchantIds: [...new Set([...(d.merchantIds ?? []), id])] }))
        }
      />
    </Modal>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: spacing.md }}>
      <Text variant="overline" tone="secondary">
        {title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>{children}</View>
    </View>
  );
}
