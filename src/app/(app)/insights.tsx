/**
 * Insights — plain sentences worked out from your own transactions this
 * money month: what grew, what shrank, where it went, what repeats, and how
 * close you are to your limit. Facts and arithmetic only; no advice.
 */
import { View } from 'react-native';

import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Card, Row, Text } from '@/components/ui/primitives';
import { CategoryAvatar } from '@/components/CategoryAvatar';
import { useInsights } from '@/features/insights/useInsights';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

export default function InsightsScreen() {
  const { colors } = useTheme();
  const { insights, error } = useInsights();

  return (
    <Screen>
      <Text variant="callout" tone="secondary" style={{ marginBottom: spacing.xl }}>
        Worked out from your own transactions this money month. They describe what happened — they aren’t
        financial advice.
      </Text>
      {error && insights === null ? (
        <ErrorState error={error} />
      ) : insights === null ? (
        <SkeletonList rows={5} />
      ) : insights.length === 0 ? (
        <EmptyState
          icon="sparkles-outline"
          title="Not enough to go on yet"
          message="Insights appear as income and spending come in — from your bank messages or as you add them."
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
