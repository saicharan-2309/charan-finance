import { useMemo } from 'react';
import { View } from 'react-native';

import { EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Text } from '@/components/ui/primitives';
import { InsightCard } from '@/features/dashboard/widgets';
import { useDashboard, useRecurring } from '@/hooks/data';
import { upcomingItems } from '@/lib/cashflow';
import { addDaysISO, monthRange, todayISO } from '@/lib/dates';
import { generateInsights } from '@/lib/insights';
import type { Minor } from '@/lib/money';
import { spacing } from '@/theme/tokens';

export default function InsightsScreen() {
  const dashboard = useDashboard();
  const recurring = useRecurring();
  const today = todayISO();
  const insights = useMemo(() => {
    const d = dashboard.data;
    if (!d) return null;
    const items = upcomingItems(recurring.data ?? [], today, addDaysISO(today, 30)).filter(
      (i) => i.type !== 'income',
    );
    return generateInsights(
      {
        currency: d.currency,
        month: monthRange(),
        today,
        current: d.current,
        previous: d.previous,
        categories: d.categories,
        previousCategories: d.previousCategories,
        upcomingOutflow30d: items.reduce((s, i) => s + i.amount, 0) as Minor,
        upcomingCount30d: items.length,
      },
      12,
    );
  }, [dashboard.data, recurring.data, today]);

  return (
    <Screen>
      <Text variant="callout" tone="secondary" style={{ marginBottom: spacing.xl }}>
        Observations calculated from your own transactions. They describe what happened — they are not
        financial advice.
      </Text>
      {insights === null ? (
        <SkeletonList rows={4} />
      ) : insights.length === 0 ? (
        <EmptyState
          icon="sparkles-outline"
          title="Not enough data yet"
          message="Insights appear as you record income and expenses across a couple of months."
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {insights.map((i) => (
            <InsightCard key={i.id} insight={i} />
          ))}
        </View>
      )}
    </Screen>
  );
}
