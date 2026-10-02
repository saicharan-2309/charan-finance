import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/controls';
import { EmptyState, ProgressBar, SkeletonList, useToast } from '@/components/ui/feedback';
import { Screen, Section, Stat } from '@/components/ui/layout';
import { Card, Divider, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { AmountPrompt } from '@/features/shared/AmountPrompt';
import { progressFor } from '@/features/goals/useGoalProgress';
import { useAppMutation, useContributions, useGoals } from '@/hooks/data';
import { formatShortDate, todayISO } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatMoney, type Minor } from '@/lib/money';
import { invalidateFinancialData } from '@/lib/query';
import { addContribution, deleteContribution, deleteGoal, setGoalArchived } from '@/services/planning';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

export default function GoalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const toast = useToast();
  const goals = useGoals();
  const contributions = useContributions(id);
  const [prompt, setPrompt] = useState(false);
  const goal = goals.data?.find((g) => g.id === id);

  const contribute = useAppMutation(
    ({ amount, note }: { amount: Minor; note: string | null }) =>
      addContribution(id, amount, todayISO(), note),
    {
      invalidate: 'financial',
      success: 'Goal updated',
      onSuccess: () => setPrompt(false),
      context: 'contribute',
    },
  );

  if (!goal)
    return (
      <Screen>{goals.isPending ? <SkeletonList rows={4} /> : <EmptyState title="Goal not found" />}</Screen>
    );
  const p = progressFor(goal, contributions.data ?? []);
  const tint = goal.color ?? colors.positive;

  const remove = () =>
    Alert.alert(
      'Delete goal?',
      'This deletes the goal and its contribution history. Your accounts and transactions are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteGoal(goal.id);
              await invalidateFinancialData();
              toast.show('Goal deleted');
              router.back();
            } catch (e) {
              toast.show(describeError(e).message, 'error');
            }
          },
        },
      ],
    );

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: goal.name,
          headerRight: () => (
            <Pressable
              onPress={() => router.push({ pathname: '/goals/edit', params: { id: goal.id } })}
              hitSlop={10}
            >
              <Text variant="bodyStrong" tone="brand">
                Edit
              </Text>
            </Pressable>
          ),
        }}
      />
      <Card variant="elevated" style={{ padding: spacing.xl, gap: spacing.lg, marginBottom: spacing.xl }}>
        <Row gap={spacing.md}>
          <IconBadge icon={goal.icon ?? 'flag-outline'} color={tint} size={48} />
          <View style={{ flex: 1 }}>
            <Text variant="headline">{goal.name}</Text>
            {goal.description ? (
              <Text variant="footnote" tone="secondary">
                {goal.description}
              </Text>
            ) : null}
          </View>
        </Row>
        <View style={{ gap: spacing.xs }}>
          <Row justify="space-between" align="flex-end">
            <MoneyText
              minor={goal.currentAmount}
              currency={goal.currency}
              variant="display"
              options={{ decimals: 'never' }}
            />
            <Text variant="headline" tone="secondary">
              {Math.round(p.percent)}%
            </Text>
          </Row>
          <ProgressBar progress={p.percent / 100} color={tint} height={10} />
          <Text variant="footnote" tone="secondary">
            Target {formatMoney(goal.targetAmount, goal.currency, { decimals: 'never' })}
            {goal.targetDate ? ` by ${formatShortDate(goal.targetDate)}` : ''}
          </Text>
        </View>
      </Card>

      <Card style={{ gap: spacing.lg, marginBottom: spacing.xl }}>
        <Row align="flex-start">
          <Stat label="Remaining">
            <MoneyText
              minor={p.remaining}
              currency={goal.currency}
              variant="bodyStrong"
              options={{ decimals: 'never' }}
            />
          </Stat>
          <Stat label="Per month needed">
            <Text variant="bodyStrong">
              {p.requiredMonthly !== null
                ? formatMoney(p.requiredMonthly, goal.currency, { decimals: 'never' })
                : '—'}
            </Text>
          </Stat>
          <Stat label="Per week needed">
            <Text variant="bodyStrong">
              {p.requiredWeekly !== null
                ? formatMoney(p.requiredWeekly, goal.currency, { decimals: 'never' })
                : '—'}
            </Text>
          </Stat>
        </Row>
        <Divider />
        <Row align="flex-start">
          <Stat label="Your recent pace">
            <Text variant="bodyStrong">
              {formatMoney(p.monthlyPace, goal.currency, { decimals: 'never' })}/mo
            </Text>
          </Stat>
          <Stat label="Projected completion">
            <Text variant="bodyStrong" tone={p.onTrack === false ? 'warning' : 'primary'}>
              {p.isComplete
                ? 'Reached'
                : p.projectedCompletion
                  ? formatShortDate(p.projectedCompletion)
                  : 'Add contributions to project'}
            </Text>
          </Stat>
        </Row>
        {p.daysLeft !== null && !p.isComplete ? (
          <Text variant="footnote" tone={p.onTrack === false ? 'warning' : 'secondary'}>
            {p.daysLeft < 0
              ? 'The target date has passed.'
              : p.onTrack
                ? `On track — ${p.daysLeft} days left.`
                : `At your recent pace you'd finish after the target date. Saving ${formatMoney(p.requiredMonthly ?? 0, goal.currency, { decimals: 'never' })} a month would get you there.`}
          </Text>
        ) : null}
        <Text variant="caption" tone="tertiary">
          Projections use your contributions over the last 90 days. They are estimates, not guarantees.
        </Text>
      </Card>

      {!goal.isArchived ? (
        <Button title="Add or withdraw" icon="swap-vertical" onPress={() => setPrompt(true)} />
      ) : null}

      <Section title="History" style={{ marginTop: spacing.xxl }}>
        {(contributions.data ?? []).length === 0 ? (
          <Text variant="footnote" tone="secondary">
            No contributions yet. Started with {formatMoney(goal.initialAmount, goal.currency)}.
          </Text>
        ) : (
          <Card style={{ paddingVertical: spacing.xs }}>
            {(contributions.data ?? []).map((c, i) => (
              <View key={c.id}>
                {i > 0 ? <Divider /> : null}
                <Pressable
                  onLongPress={() =>
                    Alert.alert('Remove this entry?', undefined, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: async () => {
                          try {
                            await deleteContribution(c.id);
                            await invalidateFinancialData();
                          } catch (e) {
                            toast.show(describeError(e).message, 'error');
                          }
                        },
                      },
                    ])
                  }
                  style={{ paddingVertical: spacing.md }}
                  accessibilityHint="Long press to remove"
                >
                  <Row justify="space-between">
                    <View>
                      <Text variant="body">{c.amount >= 0 ? 'Added' : 'Withdrawn'}</Text>
                      <Text variant="footnote" tone="secondary">
                        {formatShortDate(c.contributedOn)}
                        {c.note ? ` · ${c.note}` : ''}
                      </Text>
                    </View>
                    <MoneyText
                      minor={c.amount}
                      currency={goal.currency}
                      colorBySign
                      options={{ signed: true }}
                    />
                  </Row>
                </Pressable>
              </View>
            ))}
          </Card>
        )}
      </Section>

      <View style={{ gap: spacing.md }}>
        <Button
          title={goal.isArchived ? 'Restore goal' : 'Archive goal'}
          variant="secondary"
          onPress={async () => {
            try {
              await setGoalArchived(goal.id, !goal.isArchived);
              await invalidateFinancialData();
              toast.show(goal.isArchived ? 'Goal restored' : 'Goal archived');
            } catch (e) {
              toast.show(describeError(e).message, 'error');
            }
          }}
        />
        <Button title="Delete goal" variant="destructive" onPress={remove} />
      </View>

      <AmountPrompt
        visible={prompt}
        title="Update savings"
        message="Record money you've put aside for this goal (or taken out). This doesn't move money between accounts."
        signOptions={['Add', 'Withdraw']}
        withNote
        confirmLabel="Save"
        loading={contribute.isPending}
        onClose={() => setPrompt(false)}
        onSubmit={(amount, note) => contribute.mutate({ amount, note })}
      />
    </Screen>
  );
}
