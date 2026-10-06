import { router, Stack } from 'expo-router';
import { Pressable, View } from 'react-native';

import { EmptyState, QueryState } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Icon, Row, Text } from '@/components/ui/primitives';
import { BudgetGauge, BudgetRow } from '@/features/dashboard/widgets';
import { useBudgets, useBudgetStatus, useCurrency, useSettings } from '@/hooks/data';
import { BUDGET_PERIOD_LABELS } from '@/lib/budget';
import { formatShortDate } from '@/lib/dates';
import { type Minor } from '@/lib/money';
import { spacing } from '@/theme/tokens';
import type { BudgetStatusRow } from '@/types/domain';

export default function BudgetsScreen() {
  const currency = useCurrency();
  const budgets = useBudgets();
  const status = useBudgetStatus();
  const settings = useSettings();
  const warn = settings.data?.budgetWarningPercent ?? 80;

  return (
    <Screen>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/budgets/edit')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="New budget"
            >
              <Text variant="bodyStrong" tone="brand">
                New
              </Text>
            </Pressable>
          ),
        }}
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
              <Section key={b.id}>
                <Card style={{ gap: spacing.lg, opacity: b.isActive ? 1 : 0.6 }}>
                  <Pressable
                    onPress={() => router.push({ pathname: '/budgets/edit', params: { id: b.id } })}
                    accessibilityRole="button"
                  >
                    <Row justify="space-between">
                      <View style={{ flex: 1 }}>
                        <Text variant="headline">{b.name}</Text>
                        <Text variant="footnote" tone="secondary">
                          {BUDGET_PERIOD_LABELS[b.period]}
                          {first
                            ? ` · ${formatShortDate(first.periodStart)} – ${formatShortDate(first.periodEnd)}`
                            : ''}
                          {b.isActive ? '' : ' · Paused'}
                        </Text>
                      </View>
                      <Icon name="create-outline" size={20} tone="secondary" />
                    </Row>
                  </Pressable>
                  {/* The whole budget as a gauge; its category limits follow as rows. */}
                  {first ? (
                    <BudgetGauge
                      row={{
                        ...first,
                        categoryId: null,
                        amount: totalBudget as Minor,
                        spent: totalSpent as Minor,
                      }}
                      currency={currency}
                      warningPercent={warn}
                    />
                  ) : null}
                  {categoryRows.map((r) => (
                    <BudgetRow key={r.itemId} row={r} currency={currency} warningPercent={warn} />
                  ))}
                </Card>
              </Section>
            );
          });
        }}
      </QueryState>
      <Text variant="footnote" tone="secondary">
        The tick on each bar marks how much of the period has passed — a bar ahead of its tick is spending
        faster than planned.
      </Text>
    </Screen>
  );
}
