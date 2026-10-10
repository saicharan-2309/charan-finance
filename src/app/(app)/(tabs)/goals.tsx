/**
 * Goals, in the reference design: centred header with "+", filter pills, then
 * one card per goal — a big coloured tile with its icon, the name, saved /
 * target, a coloured progress bar with the percentage, and the pace hint.
 * The pills filter by what goals have: in progress, reached, archived.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { EmptyState, QueryState } from '@/components/ui/feedback';
import { GradientFill } from '@/components/ui/gradient';
import { Screen } from '@/components/ui/layout';
import { Icon, Row, Text } from '@/components/ui/primitives';
import { PageHeader, Pill, RoundButton } from '@/components/ui/ref';
import { useGoalProgressMap } from '@/features/goals/useGoalProgress';
import { useCurrency, useGoals } from '@/hooks/data';
import { formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { invalidateFinancialData } from '@/lib/query';
import { useTheme } from '@/theme/ThemeProvider';
import { cardGradientFor, continuous, radius, spacing } from '@/theme/tokens';

type Filter = 'all' | 'active' | 'reached' | 'archived';

export default function GoalsScreen() {
  const { colors, elevation, scheme } = useTheme();
  const currency = useCurrency();
  const goals = useGoals();
  const progress = useGoalProgressMap(goals.data);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  return (
    <Screen
      safeTop
      tabBarInset
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await invalidateFinancialData();
        setRefreshing(false);
      }}
    >
      <PageHeader
        title="Goals"
        left={
          router.canGoBack() ? (
            <RoundButton icon="chevron-back" label="Back" onPress={() => router.back()} />
          ) : undefined
        }
        right={<RoundButton icon="add" label="New goal" onPress={() => router.push('/goals/edit')} />}
      />
      <QueryState query={goals}>
        {(list) => {
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
          const active = list.filter((g) => !g.isArchived);
          const reached = (id: string) => !!progress.get(id)?.isComplete;
          const shown = list.filter((g) =>
            filter === 'archived'
              ? g.isArchived
              : g.isArchived
                ? false
                : filter === 'reached'
                  ? reached(g.id)
                  : filter === 'active'
                    ? !reached(g.id)
                    : true,
          );
          const saved = active
            .filter((g) => g.currency === currency)
            .reduce((s, g) => s + g.currentAmount, 0);
          const target = active
            .filter((g) => g.currency === currency)
            .reduce((s, g) => s + g.targetAmount, 0);
          return (
            <>
              <Row gap={spacing.sm} style={{ marginBottom: spacing.md }}>
                <Pill label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
                <Pill
                  label="In progress"
                  selected={filter === 'active'}
                  onPress={() => setFilter('active')}
                />
                <Pill label="Reached" selected={filter === 'reached'} onPress={() => setFilter('reached')} />
                {list.some((g) => g.isArchived) ? (
                  <Pill
                    label="Archived"
                    selected={filter === 'archived'}
                    onPress={() => setFilter('archived')}
                  />
                ) : null}
              </Row>
              <Text variant="footnote" tone="secondary" style={{ marginBottom: spacing.lg }}>
                Saved {formatMoney(saved, currency, { decimals: 'never' })} of{' '}
                {formatMoney(target, currency, { decimals: 'never' })} across {active.length}{' '}
                {active.length === 1 ? 'goal' : 'goals'}
              </Text>

              {shown.length === 0 ? (
                <Text variant="callout" tone="secondary" align="center" style={{ marginTop: spacing.xl }}>
                  No goals here.
                </Text>
              ) : null}

              {shown.map((g) => {
                const p = progress.get(g.id);
                const pct = p ? Math.round(p.percent) : 0;
                const color = g.color ?? colors.brand;
                return (
                  <Pressable
                    key={g.id}
                    onPress={() => router.push({ pathname: '/goals/[id]', params: { id: g.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={`${g.name}, ${pct} percent`}
                    style={({ pressed }) => [
                      {
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: spacing.lg,
                        padding: spacing.lg,
                        marginBottom: spacing.md,
                        borderRadius: radius.xl,
                        ...continuous,
                        backgroundColor: colors.surface,
                        opacity: g.isArchived ? 0.7 : pressed ? 0.85 : 1,
                      },
                      scheme === 'light' ? elevation.card : null,
                    ]}
                  >
                    {/* The goal's tile, in its colour */}
                    <View
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: radius.lg,
                        ...continuous,
                        overflow: 'hidden',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <GradientFill colors={cardGradientFor(color, colors.cardGradient)} sheen />
                      <Icon name={g.icon ?? 'flag'} size={30} color={colors.heroText} />
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text variant="bodyStrong" numberOfLines={1} style={{ fontSize: 15 }}>
                        {g.name}
                      </Text>
                      <Text variant="footnote" tone="secondary" numberOfLines={1}>
                        <Text variant="footnote" style={{ fontWeight: '700' }}>
                          {formatMoney(g.currentAmount, g.currency, { decimals: 'never' })}
                        </Text>{' '}
                        / {formatMoney(g.targetAmount, g.currency, { decimals: 'never' })}
                      </Text>
                      <Row gap={spacing.md}>
                        <View
                          style={{
                            flex: 1,
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
                              backgroundColor: p?.isComplete ? colors.positive : color,
                            }}
                          />
                        </View>
                        <Text variant="caption" tone="secondary" style={{ minWidth: 32, textAlign: 'right' }}>
                          {pct}%
                        </Text>
                      </Row>
                      {p && !g.isArchived ? (
                        <Text
                          variant="caption"
                          tone={p.isComplete ? 'positive' : p.onTrack === false ? 'warning' : 'tertiary'}
                          numberOfLines={1}
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
                    <Icon name="chevron-forward" size={18} tone="tertiary" />
                  </Pressable>
                );
              })}
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}
