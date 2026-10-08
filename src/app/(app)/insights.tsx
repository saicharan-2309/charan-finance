/**
 * Insights — plain sentences worked out from your own transactions this
 * money month: what grew, what shrank, where it went, what repeats, and how
 * close you are to your limit. Facts and arithmetic only; no advice.
 */
import { router } from 'expo-router';
import { View } from 'react-native';

import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Card, Row, Text } from '@/components/ui/primitives';
import { CategoryAvatar } from '@/components/CategoryAvatar';
import { useInsights } from '@/features/insights/useInsights';
import { fromISODate } from '@/lib/dates';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

export default function InsightsScreen() {
  const { colors } = useTheme();
  const { insights, basis, error } = useInsights();
  const day = (iso: string) =>
    fromISODate(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  return (
    <Screen>
      <Text variant="callout" tone="secondary" style={{ marginBottom: spacing.xl }}>
        Worked out from your own transactions this money month. They describe what happened — they aren’t
        financial advice.
      </Text>
      {basis ? (
        <Text variant="footnote" tone="tertiary" style={{ marginTop: -spacing.md, marginBottom: spacing.xl }}>
          Based on {basis.transactions} {basis.transactions === 1 ? 'transaction' : 'transactions'} from{' '}
          {day(basis.from)} to {day(basis.to)}.
        </Text>
      ) : null}
      {error && insights === null ? (
        <ErrorState error={error} />
      ) : insights === null ? (
        <SkeletonList rows={5} />
      ) : insights.length === 0 ? (
        <EmptyState
          icon="sparkles-outline"
          title="Not enough to go on yet"
          message={
            basis && basis.transactions > 0
              ? `BUD has ${basis.transactions} ${basis.transactions === 1 ? 'transaction' : 'transactions'} for this month so far — not enough to compare or rank anything yet. Insights appear as more come in, from your bank messages or as you add them.`
              : 'There are no transactions this month yet. Insights appear as income and spending come in — from your bank messages or as you add them.'
          }
          actionLabel="Set up bank sync"
          onAction={() => router.push('/bank-sync')}
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {insights.map((i) => {
            const tint =
              i.tone === 'positive' ? colors.positive : i.tone === 'negative' ? colors.expense : colors.brand;
            return (
              <Card key={i.id}>
                <Row gap={spacing.md} align="flex-start">
                  <CategoryAvatar icon={i.icon} color={tint} size={40} />
                  <Text variant="callout" style={{ flex: 1, lineHeight: 22 }}>
                    {i.text}
                  </Text>
                </Row>
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
