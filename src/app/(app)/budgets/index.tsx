/**
 * Budgets, laid out after the reference: each budget opens with its arc gauge
 * (spent of limit, left today, spent today) and an Edit pill; its category
 * limits follow as rows; spending by category sits in the Expenses panel.
 */
import { router, Stack } from 'expo-router';
import { Pressable, View } from 'react-native';

import { EmptyState, QueryState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Card, Row, Text } from '@/components/ui/primitives';
import { ExpenseTiles } from '@/features/dashboard/home-cards';
import { BudgetGauge, BudgetRow } from '@/features/dashboard/widgets';
import { useBudgets, useBudgetStatus, useCurrency, useSettings, useWeekSeries } from '@/hooks/data';
import { BUDGET_PERIOD_LABELS } from '@/lib/budget';
import { formatShortDate } from '@/lib/dates';
import { type Minor } from '@/lib/money';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { BudgetStatusRow } from '@/types/domain';

export default function BudgetsScreen() {
  const { colors } = useTheme();
  const currency = useCurrency();
  const budgets = useBudgets();
  const status = useBudgetStatus();
  const settings = useSettings();
  const week = useWeekSeries();
  const warn = settings.data?.budgetWarningPercent ?? 80;
  const spentToday = week.data ? (week.days.find((d) => d.date === week.today)?.expense ?? 0) : null;

  const pill = (label: string, onPress: () => void, a11y: string) => (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: radius.pill,
        backgroundColor: colors.brandSoft,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text variant="subhead" tone="brand" style={{ fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Screen>
      <Stack.Screen
        options={{ headerRight: () => pill('New', () => router.push('/budgets/edit'), 'New budget') }}
      />
      <QueryState query={budgets}>
        {(list) => {
          if (list.length === 0) {
            return (
              <EmptyState
                icon="speedometer-outline"
                title="No budgets yet"
                message="Create a monthly budget with limits for categories like Food, Shopping and Transport."
                actionLabel="Create budget"
                onAction={() => router.push('/budgets/edit')}
              />
            );
          }
          const rowsByBudget = new Map<string, BudgetStatusRow[]>();
          for (const r of status.data ?? [])
            rowsByBudget.set(r.budgetId, [...(rowsByBudget.get(r.budgetId) ?? []), r]);
          return list.map((b) => {
            const rows = rowsByBudget.get(b.id) ?? [];
            const overall = rows.find((r) => r.categoryId === null);
            const categoryRows = rows.filter((r) => r.categoryId !== null);
            const totalBudget = overall?.amount ?? categoryRows.reduce((s, r) => s + r.amount, 0);
            const totalSpent = overall?.spent ?? categoryRows.reduce((s, r) => s + r.spent, 0);
            const first = rows[0];
            return (
              <View key={b.id} style={{ marginBottom: spacing.xxl, opacity: b.isActive ? 1 : 0.6 }}>
                <Row justify="space-between" style={{ marginBottom: spacing.lg }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="title">{b.name}</Text>
                    <Text variant="footnote" tone="secondary">
                      {BUDGET_PERIOD_LABELS[b.period]}
                      {first
                        ? ` · ${formatShortDate(first.periodStart)} – ${formatShortDate(first.periodEnd)}`
                        : ''}
                      {b.isActive ? '' : ' · Paused'}
                    </Text>
                  </View>
                  {pill(
                    'Edit',
                    () => router.push({ pathname: '/budgets/edit', params: { id: b.id } }),
                    `Edit ${b.name}`,
                  )}
                </Row>
                {first ? (
                  <View style={{ marginBottom: spacing.xl }}>
                    <BudgetGauge
                      size={260}
                      row={{
                        ...first,
                        categoryId: null,
                        amount: totalBudget as Minor,
                        spent: totalSpent as Minor,
                      }}
                      currency={currency}
                      warningPercent={warn}
                      spentToday={spentToday}
                    />
                  </View>
                ) : null}
                {categoryRows.length ? (
                  <Card style={{ gap: spacing.xl }}>
                    {categoryRows.map((r) => (
                      <BudgetRow key={r.itemId} row={r} currency={currency} warningPercent={warn} />
                    ))}
                  </Card>
                ) : null}
              </View>
            );
          });
        }}
      </QueryState>

      <Card style={{ paddingTop: spacing.xl, marginBottom: spacing.xl }}>
        <ExpenseTiles currency={currency} bleed={spacing.lg} />
      </Card>

      <Text variant="footnote" tone="secondary">
        The tick on each bar marks how much of the period has passed — a bar ahead of its tick is spending
        faster than planned.
      </Text>
    </Screen>
  );
}
