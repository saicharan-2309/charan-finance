import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { CategoryAvatar } from '@/components/CategoryAvatar';
import { Icon, MoneyText, Text } from '@/components/ui/primitives';
import { formatTime } from '@/lib/dates';
import { FLOW_ICONS, FLOW_LABELS, transactionFlow } from '@/lib/payment-methods';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { Transaction } from '@/types/domain';

export function transactionTitle(
  t: Pick<
    Transaction,
    'type' | 'merchantName' | 'categoryName' | 'notes' | 'accountName' | 'toAccountName' | 'toAccountType'
  >,
): string {
  if (t.type === 'transfer') {
    return transactionFlow(t) === 'card_payment'
      ? `${t.toAccountName ?? 'Card'} payment`
      : `${t.accountName} → ${t.toAccountName ?? ''}`;
  }
  if (t.type === 'adjustment') return 'Balance adjustment';
  return t.merchantName ?? t.categoryName ?? t.notes ?? 'Transaction';
}

export function signedAmount(t: Pick<Transaction, 'type' | 'amount'>): number {
  if (t.type === 'expense') return -t.amount;
  if (t.type === 'income') return t.amount;
  return t.amount; // transfers shown unsigned; adjustments carry their own sign
}

export const TransactionRow = memo(function TransactionRow({
  t,
  showDate,
  onPress,
}: {
  t: Transaction;
  showDate?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const title = transactionTitle(t);
  const flow = transactionFlow(t);
  const subtitleParts =
    t.type === 'transfer'
      ? // Where the money came from matters most on a card payment.
        [FLOW_LABELS[flow], t.accountName]
      : t.type === 'adjustment'
        ? [t.accountName]
        : [t.subcategoryName ? `${t.categoryName} › ${t.subcategoryName}` : t.categoryName, t.accountName];
  // Like the reference: the category under the name, the time under the amount.
  const subtitle = subtitleParts.filter(Boolean).join(' · ');
  const when = showDate
    ? new Date(t.occurredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : formatTime(t.occurredAt);

  const icon = t.type === 'transfer' || t.type === 'adjustment' ? FLOW_ICONS[flow] : t.categoryIcon;
  const color = t.type === 'transfer' || t.type === 'adjustment' ? colors.transfer : t.categoryColor;
  const amount = signedAmount(t);
  const tone = t.type === 'income' ? 'positive' : t.type === 'transfer' ? 'transfer' : 'primary';

  return (
    <Pressable
      onPress={onPress ?? (() => router.push({ pathname: '/transaction/[id]', params: { id: t.id } }))}
      disabled={t.pending}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}, ${when}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.md,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
        opacity: t.pending ? 0.7 : 1,
      })}
    >
      <CategoryAvatar icon={icon} color={color} size={44} animateOnMount />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {title}
          </Text>
          {t.needsReview ? (
            <View
              accessibilityLabel="New from your bank, not reviewed yet"
              style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.highlight }}
            />
          ) : t.source === 'sms' ? (
            <Icon name="chatbox-ellipses-outline" size={13} tone="tertiary" />
          ) : null}
          {t.hasReceipt ? <Icon name="receipt-outline" size={14} tone="tertiary" /> : null}
          {t.recurringId ? <Icon name="repeat" size={14} tone="tertiary" /> : null}
        </View>
        <Text variant="footnote" tone="secondary" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <MoneyText
          minor={amount}
          currency={t.currency}
          tone={tone}
          options={{ signed: t.type === 'income' || t.type === 'expense', decimals: 'auto' }}
        />
        {t.pending ? null : (
          <Text variant="caption" tone="tertiary">
            {when}
          </Text>
        )}
        {t.pending ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="cloud-upload-outline" size={12} tone="warning" />
            <Text variant="caption" tone="warning">
              Pending sync
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});
