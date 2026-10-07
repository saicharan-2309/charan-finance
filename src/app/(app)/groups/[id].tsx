/**
 * A group: where everyone stands, the fewest payments that would settle it,
 * the expenses, and the group chat.
 *
 * "Settle in the fewest payments" is a suggestion worked out from everyone's
 * net position (lib/splits → minimiseTransfers). It never changes the
 * expenses; each payment, when made, is recorded as a normal settlement.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';

import { Button, HeaderButton } from '@/components/ui/controls';
import { EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, Icon, Row, Text } from '@/components/ui/primitives';
import { Avatar } from '@/features/friends/Avatar';
import { SettleUpSheet } from '@/features/friends/SettleUpSheet';
import { SharedExpenseRow } from '@/features/friends/SharedExpenseRow';
import {
  useAppMutation,
  useConversations,
  useGroupBalances,
  useProfile,
  useSharedExpenses,
  useSplitGroups,
} from '@/hooks/data';
import { formatMoney, type Minor } from '@/lib/money';
import { qk } from '@/lib/query';
import { minimiseTransfers } from '@/lib/splits';
import { useUserId } from '@/providers/AuthProvider';
import { leaveGroup } from '@/services/friends';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, typography } from '@/theme/tokens';

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useUserId()!;
  const { colors } = useTheme();
  const profile = useProfile();
  const groups = useSplitGroups();
  const balances = useGroupBalances(id);
  const expenses = useSharedExpenses({ groupId: id });
  const conversations = useConversations();
  const group = (groups.data ?? []).find((g) => g.id === id);
  const currency = profile.data?.defaultCurrency ?? 'INR';
  const money = (v: number) => formatMoney(v, currency);
  const [settle, setSettle] = useState<{ userId: string; name: string; net: Minor } | null>(null);
  const names = new Map((balances.data ?? []).map((b) => [b.userId, b.userId === me ? 'You' : b.name]));

  const plan = useMemo(
    () => minimiseTransfers(Object.fromEntries((balances.data ?? []).map((b) => [b.userId, b.net]))),
    [balances.data],
  );
  const chat = (conversations.data ?? []).find((c) => c.groupId === id);

  const leave = useAppMutation(() => leaveGroup(id!), {
    context: 'groups.leave',
    invalidate: [qk.splitGroups, qk.conversations],
    success: 'You left the group',
    onSuccess: () => router.back(),
  });

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: group?.name ?? 'Group',
          headerRight: () =>
            chat ? (
              <HeaderButton
                icon="chatbubbles-outline"
                label="Group chat"
                onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.id } })}
              />
            ) : null,
        }}
      />

      <Button
        title="Add an expense"
        icon="add"
        style={{ marginBottom: spacing.xl }}
        onPress={() => router.push({ pathname: '/split/new', params: { groupId: id } })}
      />

      <Section title="Balances">
        {balances.data === undefined ? (
          <SkeletonList rows={3} />
        ) : (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {balances.data
              .slice()
              .sort((a, b) => b.net - a.net)
              .map((b, i) => (
                <View key={b.userId}>
                  {i > 0 ? <Divider inset={52} /> : null}
                  <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                    <Avatar
                      name={b.userId === me ? (profile.data?.displayName ?? 'You') : b.name}
                      size={40}
                    />
                    <Text variant="bodyStrong" style={{ flex: 1 }}>
                      {names.get(b.userId)}
                    </Text>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text variant="caption" tone="secondary">
                        {b.net > 0 ? 'is owed' : b.net < 0 ? 'owes' : 'settled'}
                      </Text>
                      {b.net !== 0 ? (
                        <Text
                          style={[
                            typography.amount,
                            { fontWeight: '700', color: b.net > 0 ? colors.positive : colors.negative },
                          ]}
                        >
                          {money(Math.abs(b.net))}
                        </Text>
                      ) : null}
                    </View>
                  </Row>
                </View>
              ))}
          </Card>
        )}
      </Section>

      {plan.length ? (
        <Section title="Settle in the fewest payments">
          <Card style={{ gap: spacing.md }}>
            {plan.map((t) => {
              const mineToPay = t.from === me;
              const mineToGet = t.to === me;
              return (
                <Row key={`${t.from}-${t.to}`} gap={spacing.sm}>
                  <Text variant="callout" style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{names.get(t.from)}</Text> {mineToPay ? 'pay' : 'pays'}{' '}
                    <Text variant="bodyStrong">{names.get(t.to)}</Text>
                  </Text>
                  <Text style={[typography.amount, { fontWeight: '700' }]}>{money(t.amount)}</Text>
                  {mineToPay || mineToGet ? (
                    <Button
                      title="Settle"
                      size="sm"
                      variant="secondary"
                      onPress={() => {
                        const other = mineToPay ? t.to : t.from;
                        setSettle({
                          userId: other,
                          name: names.get(other) ?? 'Friend',
                          net: (mineToPay ? -t.amount : t.amount) as Minor,
                        });
                      }}
                    />
                  ) : null}
                </Row>
              );
            })}
            <Row gap={6}>
              <Icon name="information-circle-outline" size={14} tone="tertiary" />
              <Text variant="caption" tone="tertiary" style={{ flex: 1 }}>
                Worked out from everyone’s balance — the expenses themselves don’t change.
              </Text>
            </Row>
          </Card>
        </Section>
      ) : null}

      <Section title="Expenses">
        {expenses.data === undefined ? (
          <SkeletonList rows={3} />
        ) : expenses.data.length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon="receipt-outline"
              title="No expenses yet"
              message="Add the first one — hotel, dinner, cab…"
            />
          </Card>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {expenses.data.map((e) => (
              <SharedExpenseRow key={e.id} expense={e} me={me} currency={currency} />
            ))}
          </View>
        )}
      </Section>

      <Button
        title="Leave group"
        variant="ghost"
        onPress={() =>
          Alert.alert('Leave this group?', 'You can leave once you’re settled up in it.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Leave', style: 'destructive', onPress: () => leave.mutate(undefined) },
          ])
        }
      />

      {settle ? (
        <SettleUpSheet
          visible
          friendId={settle.userId}
          friendName={settle.name}
          net={settle.net}
          currency={currency}
          groupId={id}
          onClose={() => setSettle(null)}
        />
      ) : null}
    </Screen>
  );
}
