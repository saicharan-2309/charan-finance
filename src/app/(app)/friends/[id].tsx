/**
 * A friend: who they are, where you stand with them, what you've shared.
 * Only shared things are shown — never their accounts or other spending.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, View } from 'react-native';

import { HeaderButton } from '@/components/ui/controls';
import { EmptyState, SkeletonList } from '@/components/ui/feedback';
import { Glass } from '@/components/ui/glass';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, Icon, Row, Text } from '@/components/ui/primitives';
import { Avatar } from '@/features/friends/Avatar';
import { SharedExpenseRow } from '@/features/friends/SharedExpenseRow';
import { BookSettlementSheet, SettleUpSheet } from '@/features/friends/SettleUpSheet';
import {
  useAppMutation,
  useFriendBalances,
  useFriendships,
  usePeople,
  useProfile,
  useSettlements,
  useSharedExpenses,
} from '@/hooks/data';
import { formatMoney, type Minor } from '@/lib/money';
import { qk } from '@/lib/query';
import { useUserId } from '@/providers/AuthProvider';
import {
  blockUser,
  bookSettlementSide,
  directConversation,
  remindFriend,
  removeFriend,
} from '@/services/friends';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, typography } from '@/theme/tokens';

export default function FriendProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useUserId();
  const { colors } = useTheme();
  const profile = useProfile();
  const people = usePeople(id ? [id] : []);
  const friendships = useFriendships();
  const balances = useFriendBalances();
  const expenses = useSharedExpenses({ withUser: id });
  const settlements = useSettlements(id);
  const [settling, setSettling] = useState(false);
  const [booking, setBooking] = useState<string | null>(null);

  const person = id ? people.data?.get(id) : undefined;
  const name = person?.name ?? 'Friend';
  const currency = profile.data?.defaultCurrency ?? 'INR';
  const net = ((balances.data ?? []).find((b) => b.userId === id)?.net ?? 0) as Minor;
  const isFriend = (friendships.data ?? []).some((f) => f.other.id === id && f.status === 'accepted');
  const money = (v: number) => formatMoney(v, currency);

  const remind = useAppMutation(() => remindFriend(id!), {
    context: 'friends.remind',
    invalidate: [qk.conversations],
    success: 'Reminder sent in your chat',
  });
  const book = useAppMutation(
    (v: { settlementId: string; accountId: string }) => bookSettlementSide(v.settlementId, v.accountId),
    {
      context: 'friends.book-settlement',
      invalidate: 'financial',
      success: 'Recorded in your accounts',
      onSuccess: () => setBooking(null),
    },
  );
  const remove = useAppMutation(() => removeFriend(id!), {
    context: 'friends.remove',
    invalidate: [qk.friendships],
    success: 'Removed',
    onSuccess: () => router.back(),
  });
  const block = useAppMutation(() => blockUser(id!), {
    context: 'friends.block',
    invalidate: [qk.friendships],
    success: 'Blocked',
    onSuccess: () => router.back(),
  });

  const openChat = async () => {
    const cid = await directConversation(id!);
    router.push({ pathname: '/chat/[id]', params: { id: cid } });
  };

  const more = () => {
    const actions = ['Remove friend', `Block ${name}`, 'Cancel'];
    const run = (i: number) => {
      if (i === 0)
        Alert.alert(`Remove ${name}?`, 'Shared expenses and anything owed stay as they are.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(undefined) },
        ]);
      if (i === 1)
        Alert.alert(
          `Block ${name}?`,
          'They won’t be able to find you, message you or send requests. They aren’t told.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Block', style: 'destructive', onPress: () => block.mutate(undefined) },
          ],
        );
    };
    if (Platform.OS === 'ios')
      ActionSheetIOS.showActionSheetWithOptions(
        { options: actions, destructiveButtonIndex: [0, 1], cancelButtonIndex: 2 },
        run,
      );
    else
      Alert.alert(name, undefined, [
        { text: actions[0], onPress: () => run(0) },
        { text: actions[1], onPress: () => run(1) },
        { text: 'Cancel', style: 'cancel' },
      ]);
  };

  // Settlements where my side still needs an account.
  const toBook = (settlements.data ?? []).filter(
    (s) => (s.toUser === me && !s.toBooked) || (s.fromUser === me && !s.fromBooked),
  );

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => <HeaderButton icon="ellipsis-horizontal" label="More" onPress={more} />,
        }}
      />
      <View style={{ alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl }}>
        <Avatar name={name} size={88} />
        <Text variant="title" align="center">
          {name}
        </Text>
        <Text variant="callout" tone="secondary" align="center">
          {[person?.username ? `@${person.username}` : null, person?.status].filter(Boolean).join(' · ') ||
            ' '}
        </Text>
      </View>

      {/* Where you stand */}
      <Card style={{ alignItems: 'center', gap: spacing.xs, marginBottom: spacing.lg }}>
        <Text variant="footnote" tone="secondary">
          {net > 0 ? `${name} owes you` : net < 0 ? `You owe ${name}` : 'All settled up'}
        </Text>
        <Text
          style={[
            typography.display,
            {
              fontSize: 36,
              lineHeight: 42,
              color: net > 0 ? colors.positive : net < 0 ? colors.negative : colors.text,
            },
          ]}
        >
          {money(Math.abs(net))}
        </Text>
        <Text variant="caption" tone="tertiary">
          Net across every shared expense and payment between you
        </Text>
      </Card>

      <Row justify="space-between" style={{ marginBottom: spacing.xxl }}>
        <Action icon="chatbubble" label="Message" onPress={() => void openChat()} disabled={!isFriend} />
        <Action
          icon="git-branch"
          label="Split bill"
          onPress={() => router.push({ pathname: '/split/new', params: { friendId: id } })}
          disabled={!isFriend}
        />
        <Action
          icon="swap-horizontal"
          label="Settle up"
          onPress={() => setSettling(true)}
          disabled={net === 0}
        />
        <Action
          icon="notifications"
          label="Remind"
          onPress={() => remind.mutate(undefined)}
          disabled={net <= 0 || !isFriend}
        />
      </Row>

      {toBook.length ? (
        <Section title="Record in your accounts">
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {toBook.map((s, i) => (
              <View key={s.id}>
                {i > 0 ? <Divider inset={0} /> : null}
                <Pressable
                  onPress={() => setBooking(s.id)}
                  accessibilityRole="button"
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: spacing.md })}
                >
                  <Row gap={spacing.md}>
                    <Icon name="alert-circle" size={20} tone="warning" />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong">
                        {s.toUser === me
                          ? `${name} paid you ${money(s.amount)}`
                          : `You paid ${name} ${money(s.amount)}`}
                      </Text>
                      <Text variant="footnote" tone="secondary">
                        Choose the account it {s.toUser === me ? 'went into' : 'came from'}
                      </Text>
                    </View>
                    <Icon name="chevron-forward" size={16} tone="tertiary" />
                  </Row>
                </Pressable>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section title="Shared expenses">
        {expenses.data === undefined ? (
          <SkeletonList rows={3} />
        ) : expenses.data.length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon="receipt-outline"
              title="Nothing shared yet"
              message={`Split a bill with ${name} and it shows here.`}
            />
          </Card>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {expenses.data.map((e) => (
              <SharedExpenseRow key={e.id} expense={e} me={me!} currency={currency} />
            ))}
          </View>
        )}
      </Section>

      {(settlements.data ?? []).length ? (
        <Section title="Payments between you">
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {(settlements.data ?? []).map((s, i) => (
              <View key={s.id}>
                {i > 0 ? <Divider inset={0} /> : null}
                <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                  <Icon
                    name={s.fromUser === me ? 'arrow-up' : 'arrow-down'}
                    size={18}
                    tone={s.fromUser === me ? 'negative' : 'positive'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="body">{s.fromUser === me ? `You paid ${name}` : `${name} paid you`}</Text>
                    <Text variant="footnote" tone="secondary">
                      {new Date(s.settledOn).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                      {s.allocations.length
                        ? ` · towards ${s.allocations.length} ${s.allocations.length === 1 ? 'expense' : 'expenses'}`
                        : ''}
                      {s.note ? ` · ${s.note}` : ''}
                    </Text>
                  </View>
                  <Text style={typography.amount}>{money(s.amount)}</Text>
                </Row>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {id && settling ? (
        <SettleUpSheet
          visible
          friendId={id}
          friendName={name}
          net={net}
          currency={currency}
          onClose={() => setSettling(false)}
        />
      ) : null}
      <BookSettlementSheet
        visible={!!booking}
        title="Which account?"
        onPick={(accountId) => booking && book.mutate({ settlementId: booking, accountId })}
        onClose={() => setBooking(null)}
      />
    </Screen>
  );
}

function Action({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({
        alignItems: 'center',
        gap: spacing.xs,
        width: 76,
        opacity: disabled ? 0.4 : 1,
        transform: [{ scale: pressed ? 0.92 : 1 }],
      })}
    >
      <Glass
        interactive
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={22} tone="brand" />
      </Glass>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
    </Pressable>
  );
}
