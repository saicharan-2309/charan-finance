/**
 * Budgets, in the reference design: a centred header with back and "+", a
 * period switch when there's more than one kind of budget, then for each
 * budget a card with its ring (spent of limit, remaining, days left), one card
 * per category limit (spent / limit, %, coloured bar) and "Manage budget".
 * Spending by category stays in the Expenses panel below. Figures are the
 * same budget-status query as before.
 */
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { RingStack } from '@/components/charts';
import { EmptyState, QueryState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Card, Icon, Row, Text } from '@/components/ui/primitives';
import { PageHeader, Pill, RoundButton } from '@/components/ui/ref';
import { ExpenseTiles } from '@/features/dashboard/home-cards';
import { SquareIcon } from '@/features/reports/reference';
import { useBudgets, useBudgetStatus, useCurrency, useSettings } from '@/hooks/data';
import { BUDGET_PERIOD_LABELS } from '@/lib/budget';
import { daysLeft, formatShortDate, todayISO } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { useTheme } from '@/theme/ThemeProvider';
import { continuous, radius, spacing, typography } from '@/theme/tokens';
import type { BudgetStatusRow } from '@/types/domain';

export default function BudgetsScreen() {
  const { colors } = useTheme();
  const currency = useCurrency();
  const budgets = useBudgets();
  const status = useBudgetStatus();
  const settings = useSettings();
  const warn = settings.data?.budgetWarningPercent ?? 80;
  const [period, setPeriod] = useState<string | null>(null);
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });
  const today = todayISO();

  return (
    <Screen safeTop>
      <Stack.Screen options={{ headerShown: false }} />
      <PageHeader
        title="Budgets"
        left={<RoundButton icon="chevron-back" label="Back" onPress={() => router.back()} />}
        right={<RoundButton icon="add" label="New budget" onPress={() => router.push('/budgets/edit')} />}
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
          const periods = [...new Set(list.map((b) => b.period))];
          const shown = periods.length > 1 ? (period ?? periods[0]!) : null;
          const rowsByBudget = new Map<string, BudgetStatusRow[]>();
          for (const r of status.data ?? [])
            rowsByBudget.set(r.budgetId, [...(rowsByBudget.get(r.budgetId) ?? []), r]);
          return (
            <>
              {periods.length > 1 ? (
                <Row
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: radius.pill,
                    padding: 4,
                    marginBottom: spacing.xl,
                  }}
                >
                  {periods.map((p) => (
                    <View key={p} style={{ flex: 1 }}>
                      <Pill
                        label={p === 'monthly' ? 'This month' : BUDGET_PERIOD_LABELS[p]}
                        selected={shown === p}
                        onPress={() => setPeriod(p)}
                      />
                    </View>
                  ))}
                </Row>
              ) : null}
              {list
                .filter((b) => !shown || b.period === shown)
                .map((b) => {
                  const rows = rowsByBudget.get(b.id) ?? [];
                  const overall = rows.find((r) => r.categoryId === null);
                  const categoryRows = rows.filter((r) => r.categoryId !== null);
                  const total = overall?.amount ?? categoryRows.reduce((s, r) => s + r.amount, 0);
                  const spent = overall?.spent ?? categoryRows.reduce((s, r) => s + r.spent, 0);
                  const first = rows[0];
                  const left = first
                    ? daysLeft({ start: first.periodStart, end: first.periodEnd }, today)
                    : null;
                  const over = spent > total;
                  return (
                    <View key={b.id} style={{ marginBottom: spacing.xxl, opacity: b.isActive ? 1 : 0.6 }}>
                      {list.length > 1 ? (
                        <Text variant="headline" style={{ marginBottom: spacing.sm }}>
                          {b.name}
                          {b.isActive ? '' : ' · Paused'}
                        </Text>
                      ) : null}

                      {/* The ring card */}
                      <Card
                        style={{ padding: spacing.xl, borderRadius: radius.xxl, marginBottom: spacing.md }}
                      >
                        <Row gap={spacing.xl}>
                          <RingStack
                            size={150}
                            thickness={14}
                            rings={[
                              {
                                key: 'spent',
                                label: 'Spent of budget',
                                fraction: total ? spent / total : 0,
                                color: over ? colors.negative : colors.brand,
                              },
                            ]}
                            center={
                              <View style={{ alignItems: 'center' }}>
                                <Text style={[typography.headline, { fontWeight: '800' }]} numberOfLines={1}>
                                  {money(spent)}
                                </Text>
                                <Text variant="caption" tone="secondary">
                                  of {money(total)}
                                </Text>
                              </View>
                            }
                          />
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text
                              style={[typography.title, { fontSize: 22 }]}
                              tone={over ? 'negative' : 'primary'}
                              numberOfLines={1}
                              adjustsFontSizeToFit
                            >
                              {money(Math.abs(total - spent))}
                            </Text>
                            <Text variant="footnote" tone="secondary">
                              {over ? 'Over budget' : 'Remaining'}
                            </Text>
                            {left !== null ? (
                              <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
                                {left === 0 ? 'Last day' : `${left} ${left === 1 ? 'day' : 'days'} left`}
                              </Text>
                            ) : null}
                            {first ? (
                              <Text variant="caption" tone="tertiary">
                                {formatShortDate(first.periodStart)} – {formatShortDate(first.periodEnd)}
                              </Text>
                            ) : null}
                          </View>
                        </Row>
                      </Card>

                      {/* One card per category limit */}
                      {categoryRows.map((r) => {
                        const pct = r.amount ? Math.round((r.spent / r.amount) * 100) : 0;
                        const color = r.categoryColor ?? colors.brand;
                        const bar = pct >= 100 ? colors.negative : pct >= warn ? colors.warning : color;
                        return (
                          <Card
                            key={r.itemId}
                            style={{ marginBottom: spacing.sm, paddingVertical: spacing.md }}
                          >
                            <Row gap={spacing.md}>
                              <SquareIcon icon={r.categoryIcon ?? 'pricetag-outline'} color={color} />
                              <View style={{ flex: 1, gap: 6 }}>
                                <Row justify="space-between">
                                  <Text
                                    variant="bodyStrong"
                                    numberOfLines={1}
                                    style={{ flex: 1, fontSize: 15 }}
                                  >
                                    {r.categoryName ?? 'Category'}
                                  </Text>
                                  <Text variant="footnote" tone={pct >= 100 ? 'negative' : 'secondary'}>
                                    {pct}%
                                  </Text>
                                </Row>
                                <Text variant="footnote" tone="secondary">
                                  <Text variant="footnote" style={{ fontWeight: '700' }}>
                                    {money(r.spent)}
                                  </Text>{' '}
                                  / {money(r.amount)}
                                </Text>
                                <View
                                  style={{
                                    height: 6,
                                    borderRadius: 3,
                                    backgroundColor: colors.fill,
                                    overflow: 'hidden',
                                  }}
                                >
                                  <View
                                    style={{
                                      width: `${Math.min(100, Math.max(2, pct))}%`,
                                      height: 6,
                                      borderRadius: 3,
                                      backgroundColor: bar,
                                    }}
                                  />
                                </View>
                              </View>
                            </Row>
                          </Card>
                        );
                      })}

                      {/* Manage */}
                      <Pressable
                        onPress={() => router.push({ pathname: '/budgets/edit', params: { id: b.id } })}
                        accessibilityRole="button"
                        accessibilityLabel={`Manage ${b.name}`}
                        style={({ pressed }) => ({
                          marginTop: spacing.sm,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: spacing.md,
                          padding: spacing.lg,
                          borderRadius: radius.xl,
                          ...continuous,
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Icon name="settings-outline" size={20} tone="primary" />
                        <Text variant="bodyStrong" style={{ flex: 1 }}>
                          Manage budget{list.length > 1 ? ` · ${b.name}` : 's'}
                        </Text>
                        <Icon name="chevron-forward" size={18} tone="tertiary" />
                      </Pressable>
                    </View>
                  );
                })}
            </>
          );
        }}
      </QueryState>

      <Card style={{ paddingTop: spacing.xl, marginBottom: spacing.xl }}>
        <ExpenseTiles currency={currency} bleed={spacing.lg} />
      </Card>
    </Screen>
  );
}
