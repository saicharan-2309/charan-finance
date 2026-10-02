import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/controls';
import { useToast } from '@/components/ui/feedback';
import { IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { AmountPrompt } from '@/features/shared/AmountPrompt';
import { useCategoryIndex } from '@/hooks/data';
import { diffDays, formatDayLabel, todayISO } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { minorToInput, type Minor } from '@/lib/money';
import { invalidateFinancialData } from '@/lib/query';
import { describeFrequency } from '@/lib/recurrence';
import { postRecurringOccurrence, skipRecurringOccurrence } from '@/services/planning';
import { spacing } from '@/theme/tokens';
import type { RecurringItem } from '@/types/domain';

/** A recurring template with its next due date and Record / Skip actions. */
export function RecurringCard({ item }: { item: RecurringItem }) {
  const toast = useToast();
  const { index } = useCategoryIndex();
  const [busy, setBusy] = useState(false);
  const [amountPrompt, setAmountPrompt] = useState(false);
  const cat = item.categoryId ? index.byId.get(item.categoryId) : null;
  const today = todayISO();
  const due = item.nextDueDate;
  const daysUntil = due ? diffDays(today, due) : null;
  const actionable = item.isActive && due !== null && daysUntil !== null && daysUntil <= 7;

  const post = async (amount?: Minor) => {
    if (!due) return;
    setBusy(true);
    try {
      await postRecurringOccurrence(item.id, due, amount, randomUUID());
      await invalidateFinancialData();
      toast.show(`${item.name} recorded`);
      setAmountPrompt(false);
    } catch (e) {
      toast.show(describeError(e).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const skip = () =>
    Alert.alert(
      `Skip ${item.name} on ${formatDayLabel(due!)}?`,
      'No transaction will be recorded for this occurrence.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip',
          onPress: async () => {
            try {
              await skipRecurringOccurrence(item.id, due!);
              await invalidateFinancialData();
              toast.show('Skipped');
            } catch (e) {
              toast.show(describeError(e).message, 'error');
            }
          },
        },
      ],
    );

  return (
    <View style={{ paddingVertical: spacing.md, gap: spacing.md, opacity: item.isActive ? 1 : 0.55 }}>
      <Pressable
        onPress={() => router.push({ pathname: '/recurring/edit', params: { id: item.id } })}
        accessibilityRole="button"
      >
        <Row gap={spacing.md}>
          <IconBadge
            icon={item.type === 'transfer' ? 'swap-horizontal' : (cat?.icon ?? 'repeat')}
            color={cat?.color}
            size={42}
          />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {item.name}
            </Text>
            <Text
              variant="footnote"
              tone={daysUntil !== null && daysUntil < 0 ? 'negative' : 'secondary'}
              numberOfLines={1}
            >
              {describeFrequency(item.frequency, item.intervalCount)} ·{' '}
              {!item.isActive
                ? 'Paused'
                : due
                  ? daysUntil! < 0
                    ? `Overdue since ${formatDayLabel(due)}`
                    : `Next ${formatDayLabel(due)}`
                  : 'Ended'}
              {item.autoPost ? ' · Auto' : ''}
            </Text>
          </View>
          <MoneyText
            minor={item.type === 'income' ? item.amount : -item.amount}
            currency={item.currency}
            tone={item.type === 'income' ? 'positive' : item.type === 'transfer' ? 'transfer' : 'primary'}
            options={{ signed: item.type === 'income', decimals: 'auto' }}
          />
        </Row>
      </Pressable>
      {actionable ? (
        <Row gap={spacing.sm}>
          <Button
            title={item.type === 'income' ? 'Mark received' : 'Mark paid'}
            size="sm"
            icon="checkmark"
            onPress={() => void post()}
            loading={busy}
            style={{ flex: 1 }}
          />
          <Button
            title="Different amount"
            size="sm"
            variant="secondary"
            onPress={() => setAmountPrompt(true)}
            style={{ flex: 1 }}
          />
          <Button title="Skip" size="sm" variant="ghost" onPress={skip} />
        </Row>
      ) : null}
      <AmountPrompt
        visible={amountPrompt}
        title={`Record ${item.name}`}
        message="Enter the actual amount for this occurrence."
        initial={minorToInput(item.amount)}
        confirmLabel="Record"
        loading={busy}
        onClose={() => setAmountPrompt(false)}
        onSubmit={(a) => (a > 0 ? void post(a) : toast.show('Enter an amount greater than zero.', 'error'))}
      />
    </View>
  );
}
