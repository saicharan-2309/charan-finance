import { router } from 'expo-router';
import { memo } from 'react';
import { Pressable, View } from 'react-native';

import { Icon, IconBadge, MoneyText, Text } from '@/components/ui/primitives';
import { formatTime } from '@/lib/dates';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { Transaction } from '@/types/domain';

export function transactionTitle(
  t: Pick<Transaction, 'type' | 'merchantName' | 'categoryName' | 'notes' | 'accountName' | 'toAccountName'>,
): string {
  if (t.type === 'transfer') return `${t.accountName} → ${t.toAccountName ?? ''}`;
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
  const subtitleParts =
    t.type === 'transfer'
      ? ['Transfer']
      : t.type === 'adjustment'
        ? [t.accountName]
        : [t.subcategoryName ? `${t.categoryName} · ${t.subcategoryName}` : t.categoryName, t.accountName];
  const subtitle = [
    ...subtitleParts,
    showDate
      ? new Date(t.occurredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      : formatTime(t.occurredAt),
  ]
    .filter(Boolean)
    .join(' · ');

  const icon =
    t.type === 'transfer'
      ? 'swap-horizontal'
      : t.type === 'adjustment'
        ? 'construct-outline'
        : t.categoryIcon;
  const color = t.type === 'transfer' || t.type === 'adjustment' ? colors.transfer : t.categoryColor;
  const amount = signedAmount(t);
  const tone = t.type === 'income' ? 'positive' : t.type === 'transfer' ? 'transfer' : 'primary';

  return (
    <Pressable
      onPress={onPress ?? (() => router.push({ pathname: '/transaction/[id]', params: { id: t.id } }))}
      disabled={t.pending}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
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
      <IconBadge icon={icon} color={color} size={42} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {title}
          </Text>
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
          options={{ signed: t.type === 'income', decimals: 'auto' }}
        />
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
