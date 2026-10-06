import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { HeaderButton } from '@/components/ui/controls';
import { EmptyState, ProgressRing, QueryState } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { useGoalProgressMap } from '@/features/goals/useGoalProgress';
import { useCurrency, useGoals } from '@/hooks/data';
import { formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { invalidateFinancialData } from '@/lib/query';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

export default function GoalsScreen() {
  const { colors } = useTheme();
  const currency = useCurrency();
  const goals = useGoals();
  const progress = useGoalProgressMap(goals.data);
  const [refreshing, setRefreshing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  return (
    <Screen
      safeTop
      tabBarInset
      title="Goals"
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await invalidateFinancialData();
        setRefreshing(false);
      }}
      headerRight={<HeaderButton icon="add" label="New goal" onPress={() => router.push('/goals/edit')} />}
    >
      <QueryState query={goals}>
        {(list) => {
          const active = list.filter((g) => !g.isArchived);
          const archived = list.filter((g) => g.isArchived);
          if (list.length === 0) {
            return (
              <EmptyState
                icon="flag-outline"
                title="Save for what matters"
                message="Create a goal — a MacBook, a trip, an emergency fund — and see exactly how much to put aside each month."
                actionLabel="Create a goal"
                onAction={() => router.push('/goals/edit')}
              />
            );
          }
          const saved = active
            .filter((g) => g.currency === currency)
            .reduce((s, g) => s + g.currentAmount, 0);
          const target = active
            .filter((g) => g.currency === currency)
            .reduce((s, g) => s + g.targetAmount, 0);
          return (
            <>
              <Card variant="elevated" style={{ padding: spacing.xl, marginBottom: spacing.xxl }}>
                <Row gap={spacing.xl}>
                  <ProgressRing
                    progress={target ? saved / target : 0}
                    size={84}
                    stroke={9}
                    color={colors.positive}
                  >
                    <Text variant="subhead">{target ? Math.round((saved / target) * 100) : 0}%</Text>
                  </ProgressRing>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="caption" tone="secondary">
                      Saved across {active.length} {active.length === 1 ? 'goal' : 'goals'}
                    </Text>
                    <MoneyText
                      minor={saved}
                      currency={currency}
                      variant="amountLarge"
                      options={{ decimals: 'never' }}
                    />
                    <Text variant="footnote" tone="secondary">
                      of {formatMoney(target, currency, { decimals: 'never' })}
                    </Text>
                  </View>
                </Row>
              </Card>

              {active.map((g) => {
                const p = progress.get(g.id);
                return (
                  <Card
                    key={g.id}
                    style={{ marginBottom: spacing.md }}
                    onPress={() => router.push({ pathname: '/goals/[id]', params: { id: g.id } })}
                    accessibilityLabel={`${g.name}, ${p ? Math.round(p.percent) : 0} percent`}
                  >
                    <Row gap={spacing.lg}>
                      <ProgressRing
                        progress={p ? p.percent / 100 : 0}
                        size={60}
                        stroke={6}
                        color={g.color ?? colors.positive}
                      >
                        <IconBadge icon={g.icon ?? 'flag-outline'} color={g.color} size={34} />
                      </ProgressRing>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="bodyStrong">{g.name}</Text>
                        <Text variant="footnote" tone="secondary">
                          {formatMoney(g.currentAmount, g.currency, { decimals: 'never' })} of{' '}
                          {formatMoney(g.targetAmount, g.currency, { decimals: 'never' })}
                        </Text>
                        {p ? (
                          <Text
                            variant="caption"
                            tone={p.isComplete ? 'positive' : p.onTrack === false ? 'warning' : 'secondary'}
                          >
                            {p.isComplete
                              ? 'Goal reached'
                              : p.requiredMonthly !== null && g.targetDate
                                ? `${formatMoney(p.requiredMonthly, g.currency, { decimals: 'never' })}/month to reach by ${formatShortDate(g.targetDate)}`
                                : p.projectedCompletion
                                  ? `At your pace: ${formatShortDate(p.projectedCompletion)}`
                                  : `${formatMoney(p.remaining, g.currency, { decimals: 'never' })} to go`}
                          </Text>
                        ) : null}
                      </View>
                      <Text variant="headline">{p ? Math.round(p.percent) : 0}%</Text>
                    </Row>
                  </Card>
                );
              })}

              {archived.length ? (
                <Section style={{ marginTop: spacing.xl }}>
                  <Pressable onPress={() => setShowArchived((v) => !v)} accessibilityRole="button">
                    <Text variant="subhead" tone="brand">
                      {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
                    </Text>
                  </Pressable>
                  {showArchived
                    ? archived.map((g) => (
                        <Card
                          key={g.id}
                          style={{ marginTop: spacing.md, opacity: 0.7 }}
                          onPress={() => router.push({ pathname: '/goals/[id]', params: { id: g.id } })}
                        >
                          <Text variant="bodyStrong">{g.name}</Text>
                          <Text variant="footnote" tone="secondary">
                            {formatMoney(g.currentAmount, g.currency, { decimals: 'never' })} saved
                          </Text>
                        </Card>
                      ))
                    : null}
                </Section>
              ) : null}
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}
