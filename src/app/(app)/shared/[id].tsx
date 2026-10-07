/**
 * One shared expense, answering at a glance:
 *   WHO PAID · WHO OWES · HOW MUCH · WHAT'S SETTLED
 *
 * Actions depend on your part in it: the payer can remind, edit or cancel
 * (until something is settled against it) and records the payment in their
 * accounts if they haven't; anyone who owes can settle up.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { Button } from '@/components/ui/controls';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { SelectSheet } from '@/components/ui/pickers';
import { Card, Divider, Icon, Row, Text } from '@/components/ui/primitives';
import { Avatar } from '@/features/friends/Avatar';
import { SettleUpSheet } from '@/features/friends/SettleUpSheet';
import { accountOptions } from '@/features/shared/options';
import {
  useAccounts,
  useAppMutation,
  useFriendBalances,
  usePeople,
  useProfile,
  useSharedExpense,
} from '@/hooks/data';
import { formatMoney, type Minor } from '@/lib/money';
import { qk } from '@/lib/query';
import { useUserId } from '@/providers/AuthProvider';
import { bookMyShare, bookPayerSide, cancelSharedExpense, remindFriend } from '@/services/friends';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, typography } from '@/theme/tokens';

export default function SharedExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useUserId()!;
  const { colors } = useTheme();
  const q = useSharedExpense(id);
  const profile = useProfile();
  const accounts = useAccounts();
  const balances = useFriendBalances();
  const e = q.data;
  const people = usePeople(e ? [e.paidBy, ...e.shares.map((s) => s.userId)] : []);
  const [picking, setPicking] = useState(false);
  const [settleWith, setSettleWith] = useState<string | null>(null);
  const currency = e?.currency ?? profile.data?.defaultCurrency ?? 'INR';
  const money = (v: number) => formatMoney(v, currency);
  const nameOf = (u: string) => (u === me ? 'You' : (people.data?.get(u)?.name ?? 'Friend'));

  const book = useAppMutation((accountId: string) => bookPayerSide({ expenseId: id!, accountId }), {
    context: 'shared.book-payer',
    invalidate: 'financial',
    success: 'Added to your accounts',
    onSuccess: () => setPicking(false),
  });
  const bookShare = useAppMutation(() => bookMyShare(id!), {
    context: 'shared.book-share',
    invalidate: 'financial',
    success: 'Your share is in your spending',
  });
  const cancel = useAppMutation(() => cancelSharedExpense(id!), {
    context: 'shared.cancel',
    invalidate: 'financial',
    success: 'Cancelled — everyone’s balances are back as they were',
  });
  const remind = useAppMutation((userId: string) => remindFriend(userId, id), {
    context: 'shared.remind',
    invalidate: [qk.conversations],
    success: 'Reminder sent',
  });

  if (q.error && !e)
    return (
      <Screen>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  if (q.data === undefined)
    return (
      <Screen>
        <SkeletonList rows={5} />
      </Screen>
    );
  if (!e) {
    return (
      <Screen>
        <EmptyState
          icon="receipt-outline"
          title="Not found"
          message="This shared expense isn’t available to you."
        />
      </Screen>
    );
  }

  const iPaid = e.paidBy === me;
  const mine = e.shares.find((s) => s.userId === me);
  const settledAny = e.shares.some((s) => s.settled > 0);
  const canManage = (me === e.createdBy || iPaid) && e.status === 'active';
  const cancelled = e.status === 'cancelled';

  return (
    <Screen>
      <Stack.Screen options={{ title: '' }} />
      <View style={{ alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xl }}>
        <Text variant="callout" tone="secondary">
          {e.categoryName ?? 'Shared expense'} ·{' '}
          {new Date(e.occurredOn).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </Text>
        <Text variant="title" align="center">
          {e.title}
        </Text>
        <Text style={[typography.display, { color: cancelled ? colors.textTertiary : colors.text }]}>
          {money(e.total)}
        </Text>
        {cancelled ? (
          <Text variant="subhead" tone="negative">
            Cancelled
          </Text>
        ) : null}
      </View>

      {/* Who paid */}
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg }}>
        <Avatar
          name={nameOf(e.paidBy) === 'You' ? (profile.data?.displayName ?? 'You') : nameOf(e.paidBy)}
          size={44}
        />
        <View style={{ flex: 1 }}>
          <Text variant="footnote" tone="secondary">
            Paid by
          </Text>
          <Text variant="headline">{nameOf(e.paidBy)}</Text>
        </View>
        <Text style={[typography.amount, { fontWeight: '700' }]}>{money(e.total)}</Text>
      </Card>

      {iPaid && !e.payerBooked && !cancelled ? (
        <Card style={{ gap: spacing.sm, marginBottom: spacing.lg, backgroundColor: colors.warningSoft }}>
          <Row gap={spacing.sm}>
            <Icon name="alert-circle" size={18} tone="warning" />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              Add your payment to your accounts
            </Text>
          </Row>
          <Text variant="footnote" tone="secondary">
            Choose the account you paid from. Your spending becomes your share ({money(mine?.amount ?? 0)});
            the rest is recorded as owed to you.
          </Text>
          <Button title="Choose account" size="md" onPress={() => setPicking(true)} />
        </Card>
      ) : null}
      {!iPaid && mine && !mine.booked && mine.amount > 0 && !cancelled ? (
        <Button
          title="Add my share to my spending"
          variant="secondary"
          size="md"
          style={{ marginBottom: spacing.lg }}
          loading={bookShare.isPending}
          onPress={() => bookShare.mutate(undefined)}
        />
      ) : null}

      {/* Who owes */}
      <Section title="Split">
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          {e.shares.map((s, i) => {
            const isPayer = s.userId === e.paidBy;
            const open = s.amount - s.settled;
            const status = isPayer
              ? 'Paid'
              : open <= 0
                ? 'Settled'
                : s.settled > 0
                  ? `Owes ${money(open)} more`
                  : `Owes ${nameOf(e.paidBy).replace(/^You$/, 'you')}`;
            return (
              <View key={s.userId}>
                {i > 0 ? <Divider inset={52} /> : null}
                <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                  <Avatar
                    name={s.userId === me ? (profile.data?.displayName ?? 'You') : nameOf(s.userId)}
                    size={40}
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{nameOf(s.userId)}</Text>
                    <Row gap={4}>
                      <Icon
                        name={isPayer || open <= 0 ? 'checkmark-circle' : 'time-outline'}
                        size={13}
                        tone={isPayer || open <= 0 ? 'positive' : 'warning'}
                      />
                      <Text variant="footnote" tone={isPayer || open <= 0 ? 'positive' : 'secondary'}>
                        {status}
                      </Text>
                    </Row>
                  </View>
                  <Text style={[typography.amount, { fontWeight: '700' }]}>{money(s.amount)}</Text>
                </Row>
                {iPaid && !isPayer && open > 0 && !cancelled ? (
                  <Row gap={spacing.sm} style={{ paddingBottom: spacing.md, marginLeft: 52 }}>
                    <Button
                      title="Remind"
                      size="sm"
                      variant="secondary"
                      onPress={() => remind.mutate(s.userId)}
                    />
                  </Row>
                ) : null}
              </View>
            );
          })}
        </Card>
        <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
          Split{' '}
          {e.splitMethod === 'equal'
            ? 'equally'
            : e.splitMethod === 'percent'
              ? 'by percentage'
              : e.splitMethod === 'shares'
                ? 'by shares'
                : 'by amount'}
          .{mine ? ` Your share, ${money(mine.amount)}, is what counts as your spending.` : ''}
        </Text>
      </Section>

      {!iPaid && mine && mine.amount - mine.settled > 0 && !cancelled ? (
        <Button
          title={`Settle up with ${nameOf(e.paidBy)}`}
          style={{ marginBottom: spacing.md }}
          onPress={() => setSettleWith(e.paidBy)}
        />
      ) : null}

      {e.notes ? (
        <Card variant="muted" style={{ marginBottom: spacing.lg }}>
          <Text variant="callout">{e.notes}</Text>
        </Card>
      ) : null}

      {canManage ? (
        <View style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
          <Button
            title="Edit"
            variant="secondary"
            disabled={settledAny}
            onPress={() =>
              router.push({
                pathname: '/split/new',
                params: { editId: e.id, groupId: e.groupId ?? undefined },
              })
            }
          />
          <Button
            title="Cancel this expense"
            variant="destructive"
            disabled={settledAny}
            loading={cancel.isPending}
            onPress={() =>
              Alert.alert('Cancel this shared expense?', 'Everyone’s shares and balances are reversed.', [
                { text: 'Keep it', style: 'cancel' },
                { text: 'Cancel it', style: 'destructive', onPress: () => cancel.mutate(undefined) },
              ])
            }
          />
          {settledAny ? (
            <Text variant="footnote" tone="tertiary" align="center">
              Some of this has been paid back, so it can’t be changed. Undo the payment first.
            </Text>
          ) : null}
        </View>
      ) : null}

      <SelectSheet
        visible={picking}
        title="Paid from"
        options={accountOptions(accounts.data ?? [])}
        selected={null}
        onSelect={(v) => v && book.mutate(v)}
        onClose={() => setPicking(false)}
      />
      {settleWith ? (
        <SettleUpSheet
          visible
          friendId={settleWith}
          friendName={nameOf(settleWith)}
          net={
            ((balances.data ?? []).find((b) => b.userId === settleWith)?.net ?? -(mine?.amount ?? 0)) as Minor
          }
          currency={currency}
          onClose={() => setSettleWith(null)}
        />
      ) : null}
    </Screen>
  );
}
