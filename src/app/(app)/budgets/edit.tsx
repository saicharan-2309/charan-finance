import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Button, SegmentedControl, SwitchRow, TextField } from '@/components/ui/controls';
import { SkeletonList, useToast } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { DateTimeField } from '@/components/ui/pickers';
import { Card, Divider, IconBadge, Row, Text } from '@/components/ui/primitives';
import { useAppMutation, useBudgets, useCategoryIndex, useCurrency, useCycle } from '@/hooks/data';
import type { BudgetPeriod } from '@/lib/budget';
import { fromISODate, toISODate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { currencySymbol, minorToInput, parseAmountInput, sanitizeAmountKeystrokes } from '@/lib/money';
import { invalidateFinancialData } from '@/lib/query';
import { deleteBudget, saveBudget } from '@/services/planning';
import { spacing } from '@/theme/tokens';
import type { Budget } from '@/types/domain';

export default function BudgetEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const budgets = useBudgets();
  const cats = useCategoryIndex();
  if ((id && !budgets.data) || !cats.data)
    return (
      <Screen>
        <SkeletonList rows={5} />
      </Screen>
    );
  const existing = id ? (budgets.data?.find((b) => b.id === id) ?? null) : null;
  return <BudgetForm existing={existing} />;
}

function BudgetForm({ existing }: { existing: Budget | null }) {
  const toast = useToast();
  const currency = useCurrency();
  const { index } = useCategoryIndex();
  const categories = index.top('expense');
  // A new monthly budget starts on the user's payday, so its months line up
  // with the money month on Home.
  const cycle = useCycle();
  const startOfMonth = () => fromISODate(cycle.start);

  const [name, setName] = useState(existing?.name ?? 'Monthly budget');
  const [period, setPeriod] = useState<BudgetPeriod>(existing?.period ?? 'monthly');
  const [start, setStart] = useState<Date>(() =>
    existing ? fromISODate(existing.startDate) : startOfMonth(),
  );
  const [end, setEnd] = useState<Date>(() =>
    existing?.endDate ? fromISODate(existing.endDate) : new Date(Date.now() + 30 * 86400000),
  );
  const [isActive, setActive] = useState(existing?.isActive ?? true);
  const [overall, setOverall] = useState(() => {
    const o = existing?.items.find((i) => i.categoryId === null);
    return o ? minorToInput(o.amount) : '';
  });
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (existing?.items ?? []).filter((i) => i.categoryId).map((i) => [i.categoryId!, minorToInput(i.amount)]),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const save = useAppMutation(
    () => {
      const items = [
        ...(overall ? [{ categoryId: null, amount: parseAmountInput(overall)! }] : []),
        ...Object.entries(amounts)
          .filter(([, v]) => v && parseAmountInput(v))
          .map(([categoryId, v]) => ({ categoryId, amount: parseAmountInput(v)! })),
      ];
      return saveBudget(existing?.id ?? null, {
        name,
        period,
        startDate: toISODate(start),
        endDate: period === 'custom' ? toISODate(end) : null,
        currency,
        isActive,
        items,
      });
    },
    {
      invalidate: 'financial',
      success: 'Budget saved',
      onSuccess: () => router.back(),
      context: 'save-budget',
    },
  );

  const submit = () => {
    if (!name.trim()) return setError('Give the budget a name.');
    const hasItem = !!parseAmountInput(overall) || Object.values(amounts).some((v) => !!parseAmountInput(v));
    if (!hasItem) return setError('Set at least one limit — an overall limit or a category.');
    if (period === 'custom' && end < start) return setError('End date must be after the start date.');
    setError(null);
    save.mutate(undefined);
  };

  const remove = () =>
    Alert.alert('Delete budget?', 'Your transactions are not affected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteBudget(existing!.id);
            await invalidateFinancialData();
            toast.show('Budget deleted');
            router.back();
          } catch (e) {
            toast.show(describeError(e).message, 'error');
          }
        },
      },
    ]);

  const total = Object.values(amounts).reduce((s, v) => s + (parseAmountInput(v) ?? 0), 0);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: existing ? 'Edit budget' : 'New budget',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Text tone="secondary">Cancel</Text>
            </Pressable>
          ),
        }}
      />
      <TextField label="Name" value={name} onChangeText={setName} maxLength={60} />
      <Section title="Period" style={{ marginTop: spacing.xxl }}>
        <SegmentedControl<BudgetPeriod>
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
            { value: 'yearly', label: 'Yearly' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        <Card style={{ marginTop: spacing.md, paddingVertical: spacing.xs }}>
          <DateTimeField
            label={period === 'custom' ? 'Start' : 'Periods start on'}
            value={start}
            onChange={setStart}
          />
          {period === 'custom' ? (
            <>
              <Divider />
              <DateTimeField label="End" value={end} onChange={setEnd} minimumDate={start} />
            </>
          ) : null}
        </Card>
        <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
          {period === 'monthly'
            ? `Each period starts on day ${start.getDate()} of the month (e.g. set the 25th for a salary-to-salary budget).`
            : period === 'weekly'
              ? `Each week starts on ${start.toLocaleDateString('en-IN', { weekday: 'long' })}.`
              : period === 'yearly'
                ? 'Each year starts on this date (e.g. 1 April for a financial year).'
                : 'A one-off budget for the dates above.'}
        </Text>
      </Section>

      <Section title="Overall limit (optional)">
        <TextField
          value={overall}
          onChangeText={(t) => setOverall(sanitizeAmountKeystrokes(t))}
          keyboardType="decimal-pad"
          placeholder="No overall limit"
          leading={<Text tone="secondary">{currencySymbol(currency)}</Text>}
        />
      </Section>

      <Section title="Category limits">
        <Card style={{ paddingVertical: spacing.xs }}>
          {categories.map((c, i) => (
            <View key={c.id}>
              {i > 0 ? <Divider inset={46} /> : null}
              <Row gap={spacing.md} style={{ paddingVertical: spacing.sm }}>
                <IconBadge icon={c.icon} color={c.color} size={34} />
                <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
                  {c.name}
                </Text>
                <TextField
                  containerStyle={{ width: 130 }}
                  value={amounts[c.id] ?? ''}
                  onChangeText={(t) => setAmounts((a) => ({ ...a, [c.id]: sanitizeAmountKeystrokes(t) }))}
                  keyboardType="decimal-pad"
                  placeholder="—"
                  accessibilityLabel={`${c.name} limit`}
                  style={{ textAlign: 'right' }}
                />
              </Row>
            </View>
          ))}
        </Card>
        {total > 0 ? (
          <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
            Category limits add up to {currencySymbol(currency)}
            {minorToInput(total)}.
          </Text>
        ) : null}
      </Section>

      <Card style={{ paddingVertical: spacing.xs, marginBottom: spacing.xl }}>
        <SwitchRow
          title="Active"
          subtitle="Paused budgets are hidden from Home and alerts."
          value={isActive}
          onValueChange={setActive}
        />
      </Card>

      {error ? (
        <Text variant="footnote" tone="negative" style={{ marginBottom: spacing.md }}>
          {error}
        </Text>
      ) : null}
      <View style={{ gap: spacing.md }}>
        <Button title="Save budget" onPress={submit} loading={save.isPending} />
        {existing ? <Button title="Delete budget" variant="destructive" onPress={remove} /> : null}
      </View>
    </Screen>
  );
}
