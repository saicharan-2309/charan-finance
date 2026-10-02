import { router, Stack } from 'expo-router';
import { Pressable, View } from 'react-native';

import { EmptyState, QueryState } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, MoneyText, Row, Text } from '@/components/ui/primitives';
import { RecurringCard } from '@/features/recurring/RecurringCard';
import { useCurrency, useRecurring } from '@/hooks/data';
import { monthlyEquivalent } from '@/lib/recurrence';
import { spacing } from '@/theme/tokens';
import type { RecurringItem } from '@/types/domain';

const GROUPS: { title: string; filter: (r: RecurringItem) => boolean }[] = [
  { title: 'Income', filter: (r) => r.type === 'income' },
  { title: 'Bills', filter: (r) => r.type === 'expense' && r.kind === 'bill' },
  { title: 'Subscriptions', filter: (r) => r.type === 'expense' && r.kind === 'subscription' },
  { title: 'Other expenses', filter: (r) => r.type === 'expense' && r.kind === 'general' },
  { title: 'Transfers & investments', filter: (r) => r.type === 'transfer' },
];

export default function RecurringScreen() {
  const q = useRecurring();
  const currency = useCurrency();
  return (
    <Screen>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/recurring/edit')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Add recurring item"
            >
              <Text variant="bodyStrong" tone="brand">
                Add
              </Text>
            </Pressable>
          ),
        }}
      />
      <QueryState query={q}>
        {(items) => {
          if (items.length === 0) {
            return (
              <EmptyState
                icon="repeat"
                title="No recurring items"
                message="Add salary, rent, bills, subscriptions or SIPs. They power your calendar, reminders and cash-flow projections."
                actionLabel="Add recurring item"
                onAction={() => router.push('/recurring/edit')}
              />
            );
          }
          const active = items.filter((r) => r.isActive && r.currency === currency);
          const monthlyOut = active
            .filter((r) => r.type === 'expense')
            .reduce((s, r) => s + monthlyEquivalent(r.amount, r.frequency, r.intervalCount), 0);
          const monthlyIn = active
            .filter((r) => r.type === 'income')
            .reduce((s, r) => s + monthlyEquivalent(r.amount, r.frequency, r.intervalCount), 0);
          return (
            <>
              <Card variant="muted" style={{ marginBottom: spacing.xxl }}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Text variant="caption" tone="secondary">
                      Recurring income / month
                    </Text>
                    <MoneyText
                      minor={monthlyIn}
                      currency={currency}
                      variant="headline"
                      tone="positive"
                      options={{ decimals: 'never' }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="caption" tone="secondary">
                      Recurring expenses / month
                    </Text>
                    <MoneyText
                      minor={monthlyOut}
                      currency={currency}
                      variant="headline"
                      options={{ decimals: 'never' }}
                    />
                  </View>
                </Row>
                <Text variant="caption" tone="tertiary" style={{ marginTop: spacing.sm }}>
                  Monthly equivalents (yearly items ÷ 12, weekly × 52 ÷ 12).
                </Text>
              </Card>
              {GROUPS.map((g) => {
                const list = items.filter(g.filter);
                if (!list.length) return null;
                return (
                  <Section key={g.title} title={g.title}>
                    <Card style={{ paddingVertical: spacing.xs }}>
                      {list.map((r, i) => (
                        <View key={r.id}>
                          {i > 0 ? <Divider /> : null}
                          <RecurringCard item={r} />
                        </View>
                      ))}
                    </Card>
                  </Section>
                );
              })}
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}
