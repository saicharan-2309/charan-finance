/**
 * One shared expense in a list, written from your side:
 *   "Dinner · You paid ₹2,400 · you lent ₹1,600"
 *   "Cab · Rahul paid ₹900 · you owe ₹450"
 * plus whether your part is settled. Tapping opens the full breakdown.
 */
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { CategoryAvatar } from '@/components/CategoryAvatar';
import { Card, Row, Text } from '@/components/ui/primitives';
import { usePeople } from '@/hooks/data';
import { formatMoney } from '@/lib/money';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, typography } from '@/theme/tokens';
import type { SharedExpense } from '@/types/domain';

export function myPosition(e: SharedExpense, me: string) {
  const mine = e.shares.find((s) => s.userId === me);
  if (e.paidBy === me) {
    const lent = e.shares.filter((s) => s.userId !== me).reduce((t, s) => t + s.amount, 0);
    const repaid = e.shares.filter((s) => s.userId !== me).reduce((t, s) => t + s.settled, 0);
    return { kind: 'lent' as const, amount: lent, open: lent - repaid };
  }
  const owe = mine?.amount ?? 0;
  return { kind: 'owe' as const, amount: owe, open: owe - (mine?.settled ?? 0) };
}

export function SharedExpenseRow({
  expense: e,
  me,
  currency,
}: {
  expense: SharedExpense;
  me: string;
  currency: string;
}) {
  const { colors } = useTheme();
  const people = usePeople([e.paidBy]);
  const payer = e.paidBy === me ? 'You' : (people.data?.get(e.paidBy)?.name ?? 'Someone');
  const pos = myPosition(e, me);
  const money = (v: number) => formatMoney(v, currency, { decimals: 'auto' });
  const cancelled = e.status === 'cancelled';
  const settled = !cancelled && pos.open <= 0;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/shared/[id]', params: { id: e.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${e.title}, ${payer} paid ${money(e.total)}, ${
        pos.kind === 'lent' ? `you lent ${money(pos.amount)}` : `you owe ${money(pos.amount)}`
      }${settled ? ', settled' : ''}`}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }], opacity: cancelled ? 0.5 : 1 })}
    >
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <CategoryAvatar icon={e.icon ?? 'receipt-outline'} color={colors.brand} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {e.title}
          </Text>
          <Text variant="footnote" tone="secondary" numberOfLines={1}>
            {payer} paid {money(e.total)} ·{' '}
            {new Date(e.occurredOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="caption" tone="secondary">
            {cancelled ? 'cancelled' : settled ? 'settled' : pos.kind === 'lent' ? 'you lent' : 'you owe'}
          </Text>
          <Text
            style={[
              typography.amount,
              {
                fontWeight: '700',
                color:
                  cancelled || settled
                    ? colors.textTertiary
                    : pos.kind === 'lent'
                      ? colors.positive
                      : colors.negative,
              },
            ]}
          >
            {money(cancelled || settled ? pos.amount : pos.open)}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

/** Row helper for headers: "You owe ₹800 · settled ₹200". */
export function PositionLine({ e, me, currency }: { e: SharedExpense; me: string; currency: string }) {
  const pos = myPosition(e, me);
  return (
    <Row gap={spacing.xs}>
      <Text variant="footnote" tone="secondary">
        {pos.kind === 'lent' ? 'You lent' : 'You owe'} {formatMoney(pos.amount, currency)}
        {pos.amount !== pos.open ? ` · ${formatMoney(pos.amount - pos.open, currency)} paid back` : ''}
      </Text>
    </Row>
  );
}
