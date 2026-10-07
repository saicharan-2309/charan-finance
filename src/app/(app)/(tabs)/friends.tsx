/**
 * Friends — the people you share money with.
 *
 *   · You owe / owed to you (net, across every shared expense and settlement)
 *   · People: requests waiting for you, then friends with their balance
 *   · Chats: conversations, unread first
 *   · Groups: trips, flatmates, office lunch…
 *
 * Nothing here shows anyone's private finances — only what you share.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/features/friends/Avatar';
import { HeaderButton, SegmentedControl, TextField, Button } from '@/components/ui/controls';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, Icon, Row, Text } from '@/components/ui/primitives';
import {
  useAppMutation,
  useConversations,
  useFriendBalances,
  useFriendsTotals,
  useFriendships,
  useNotifications,
  useProfile,
  useSplitGroups,
} from '@/hooks/data';
import { formatMoney } from '@/lib/money';
import { qk } from '@/lib/query';
import { respondFriendRequest, setUsername } from '@/services/friends';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, typography } from '@/theme/tokens';

type Tab = 'people' | 'chats' | 'groups';

export default function FriendsScreen() {
  const { colors } = useTheme();
  const profile = useProfile();
  const friendships = useFriendships();
  const balances = useFriendBalances();
  const conversations = useConversations();
  const groups = useSplitGroups();
  const notifications = useNotifications();
  const [tab, setTab] = useState<Tab>('people');
  const [username, setUsernameText] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const respond = useAppMutation(
    (v: { userId: string; accept: boolean }) => respondFriendRequest(v.userId, v.accept),
    {
      context: 'friends.respond',
      invalidate: [qk.friendships, qk.friendBalances],
      success: (r) => (r === 'accepted' ? 'You’re now friends' : null),
    },
  );
  const saveName = useAppMutation(setUsername, {
    context: 'friends.username',
    invalidate: [qk.profile],
    success: (u) => `You’re @${u} on BUD`,
  });

  const currency = profile.data?.defaultCurrency ?? 'INR';
  const money = (v: number) => formatMoney(v, currency, { decimals: 'auto' });
  const { owe, owed } = useFriendsTotals();
  const net = useMemo(() => new Map((balances.data ?? []).map((b) => [b.userId, b.net])), [balances.data]);
  const unreadNotes = (notifications.data ?? []).filter((n) => !n.readAt).length;

  const all = friendships.data ?? [];
  const incoming = all.filter((f) => f.status === 'pending' && !f.outgoing);
  const outgoing = all.filter((f) => f.status === 'pending' && f.outgoing);
  const friends = all
    .filter((f) => f.status === 'accepted')
    .sort((a, b) => Math.abs(net.get(b.other.id) ?? 0) - Math.abs(net.get(a.other.id) ?? 0));
  const unreadChats = (conversations.data ?? []).reduce((s, c) => s + c.unread, 0);

  return (
    <Screen
      safeTop
      tabBarInset
      title="Friends"
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await Promise.all([
          friendships.refetch(),
          balances.refetch(),
          conversations.refetch(),
          groups.refetch(),
        ]);
        setRefreshing(false);
      }}
      headerRight={
        <Row gap={spacing.sm}>
          <View>
            <HeaderButton
              icon="notifications-outline"
              label="Notifications"
              onPress={() => router.push('/notifications')}
            />
            {unreadNotes ? <Badge n={unreadNotes} /> : null}
          </View>
          <HeaderButton
            icon="person-add-outline"
            label="Find friends"
            onPress={() => router.push('/friends/find')}
          />
        </Row>
      }
    >
      {profile.data && !profile.data.username ? (
        <Card style={{ marginBottom: spacing.xl, gap: spacing.md }}>
          <Row gap={spacing.md}>
            <Avatar name={profile.data.displayName ?? 'You'} size={44} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">Choose your BUD username</Text>
              <Text variant="footnote" tone="secondary">
                Friends find you by it. Only your name, username and status are ever visible to them.
              </Text>
            </View>
          </Row>
          <TextField
            value={username}
            onChangeText={(t) => setUsernameText(t.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
            placeholder="e.g. charan.s"
            autoCapitalize="none"
            autoCorrect={false}
            leading={<Text tone="tertiary">@</Text>}
          />
          <Button
            title="Save username"
            size="md"
            disabled={username.length < 3}
            loading={saveName.isPending}
            onPress={() => saveName.mutate(username)}
          />
        </Card>
      ) : null}

      {/* You owe / owed to you */}
      <Row gap={spacing.md} style={{ marginBottom: spacing.xl }}>
        <SummaryTile label="You owe" value={money(owe)} tone="negative" icon="arrow-up-circle" />
        <SummaryTile label="Owed to you" value={money(owed)} tone="positive" icon="arrow-down-circle" />
      </Row>

      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        style={{ marginBottom: spacing.xl }}
        options={[
          { value: 'people', label: incoming.length ? `People · ${incoming.length}` : 'People' },
          { value: 'chats', label: unreadChats ? `Chats · ${unreadChats}` : 'Chats' },
          { value: 'groups', label: 'Groups' },
        ]}
      />

      {tab === 'people' ? (
        friendships.error && !friendships.data ? (
          <ErrorState error={friendships.error} onRetry={() => void friendships.refetch()} />
        ) : friendships.data === undefined ? (
          <SkeletonList rows={4} />
        ) : all.length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon="people-outline"
              title="Split bills with friends"
              message="Add the people you go out with. When one of you pays, split it here — everyone sees their own share."
              actionLabel="Find friends"
              onAction={() => router.push('/friends/find')}
            />
          </Card>
        ) : (
          <>
            {incoming.length ? (
              <Section title="Requests">
                <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                  {incoming.map((f, i) => (
                    <View key={f.id}>
                      {i > 0 ? <Divider inset={56} /> : null}
                      <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                        <Avatar name={f.other.name} size={44} />
                        <View style={{ flex: 1 }}>
                          <Text variant="bodyStrong" numberOfLines={1}>
                            {f.other.name}
                          </Text>
                          <Text variant="footnote" tone="secondary" numberOfLines={1}>
                            {f.other.username ? `@${f.other.username}` : 'Wants to connect'}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => respond.mutate({ userId: f.other.id, accept: false })}
                          accessibilityRole="button"
                          accessibilityLabel={`Decline ${f.other.name}`}
                          hitSlop={6}
                          style={pill(colors.fill)}
                        >
                          <Text variant="subhead">Decline</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => respond.mutate({ userId: f.other.id, accept: true })}
                          accessibilityRole="button"
                          accessibilityLabel={`Accept ${f.other.name}`}
                          hitSlop={6}
                          style={pill(colors.brand)}
                        >
                          <Text variant="subhead" style={{ color: colors.onBrand, fontWeight: '600' }}>
                            Accept
                          </Text>
                        </Pressable>
                      </Row>
                    </View>
                  ))}
                </Card>
              </Section>
            ) : null}

            {friends.length ? (
              <Section title="Friends">
                <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                  {friends.map((f, i) => {
                    const n = net.get(f.other.id) ?? 0;
                    return (
                      <View key={f.id}>
                        {i > 0 ? <Divider inset={56} /> : null}
                        <Pressable
                          onPress={() =>
                            router.push({ pathname: '/friends/[id]', params: { id: f.other.id } })
                          }
                          accessibilityRole="button"
                          accessibilityLabel={`${f.other.name}, ${
                            n > 0 ? `owes you ${money(n)}` : n < 0 ? `you owe ${money(-n)}` : 'settled up'
                          }`}
                          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                        >
                          <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                            <Avatar name={f.other.name} size={44} />
                            <View style={{ flex: 1 }}>
                              <Text variant="bodyStrong" numberOfLines={1}>
                                {f.other.name}
                              </Text>
                              <Text variant="footnote" tone="secondary" numberOfLines={1}>
                                {f.other.status ?? (f.other.username ? `@${f.other.username}` : ' ')}
                              </Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text variant="caption" tone="secondary">
                                {n > 0 ? 'owes you' : n < 0 ? 'you owe' : 'settled up'}
                              </Text>
                              {n !== 0 ? (
                                <Text
                                  style={[
                                    typography.amount,
                                    { color: n > 0 ? colors.positive : colors.negative, fontWeight: '700' },
                                  ]}
                                >
                                  {money(Math.abs(n))}
                                </Text>
                              ) : null}
                            </View>
                            <Icon name="chevron-forward" size={16} tone="tertiary" />
                          </Row>
                        </Pressable>
                      </View>
                    );
                  })}
                </Card>
              </Section>
            ) : null}

            {outgoing.length ? (
              <Section title="Sent requests">
                <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                  {outgoing.map((f, i) => (
                    <View key={f.id}>
                      {i > 0 ? <Divider inset={56} /> : null}
                      <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                        <Avatar name={f.other.name} size={40} />
                        <View style={{ flex: 1 }}>
                          <Text variant="body" numberOfLines={1}>
                            {f.other.name}
                          </Text>
                          <Text variant="footnote" tone="tertiary">
                            Waiting for them to accept
                          </Text>
                        </View>
                      </Row>
                    </View>
                  ))}
                </Card>
              </Section>
            ) : null}
          </>
        )
      ) : tab === 'chats' ? (
        conversations.data === undefined && !conversations.error ? (
          <SkeletonList rows={4} />
        ) : (conversations.data ?? []).length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon="chatbubbles-outline"
              title="No conversations yet"
              message="Open a friend and say hello — or split a bill, and the conversation starts itself."
            />
          </Card>
        ) : (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {(conversations.data ?? []).map((c, i) => (
              <View key={c.id}>
                {i > 0 ? <Divider inset={56} /> : null}
                <Pressable
                  onPress={() => router.push({ pathname: '/chat/[id]', params: { id: c.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.title}${c.unread ? `, ${c.unread} unread` : ''}`}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                    <Avatar name={c.title} size={44} group={c.kind === 'group'} />
                    <View style={{ flex: 1 }}>
                      <Row justify="space-between">
                        <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                          {c.title}
                        </Text>
                        <Text variant="caption" tone="tertiary">
                          {c.lastAt ? shortWhen(c.lastAt) : ''}
                        </Text>
                      </Row>
                      <Row justify="space-between">
                        <Text
                          variant="footnote"
                          tone={c.unread ? 'primary' : 'secondary'}
                          numberOfLines={1}
                          style={{ flex: 1, fontWeight: c.unread ? '600' : '400' }}
                        >
                          {c.lastBody ?? 'Say hello'}
                        </Text>
                        {c.unread ? <Badge n={c.unread} inline /> : null}
                      </Row>
                    </View>
                  </Row>
                </Pressable>
              </View>
            ))}
          </Card>
        )
      ) : (
        <>
          {(groups.data ?? []).length === 0 && groups.data !== undefined ? (
            <Card>
              <EmptyState
                compact
                icon="people-circle-outline"
                title="Groups for trips and flats"
                message="Goa trip, flatmates, office lunch — add expenses to a group and BUD works out who owes whom, in the fewest payments."
                actionLabel="New group"
                onAction={() => router.push('/groups/new')}
              />
            </Card>
          ) : (
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
              {(groups.data ?? []).map((g, i) => (
                <View key={g.id}>
                  {i > 0 ? <Divider inset={56} /> : null}
                  <Pressable
                    onPress={() => router.push({ pathname: '/groups/[id]', params: { id: g.id } })}
                    accessibilityRole="button"
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                      <Avatar name={g.name} size={44} group />
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyStrong">{g.name}</Text>
                        <Text variant="footnote" tone="secondary">
                          {g.memberIds.length} {g.memberIds.length === 1 ? 'member' : 'members'}
                        </Text>
                      </View>
                      <Icon name="chevron-forward" size={16} tone="tertiary" />
                    </Row>
                  </Pressable>
                </View>
              ))}
            </Card>
          )}
          {(groups.data ?? []).length ? (
            <Button
              title="New group"
              icon="add"
              variant="secondary"
              size="md"
              style={{ marginTop: spacing.lg }}
              onPress={() => router.push('/groups/new')}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}

function SummaryTile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: 'positive' | 'negative';
  icon: string;
}) {
  return (
    <Card style={{ flex: 1, gap: spacing.sm }}>
      <Row gap={6}>
        <Icon name={icon} size={16} tone={tone} />
        <Text variant="footnote" tone="secondary">
          {label}
        </Text>
      </Row>
      <Text style={[typography.title, { fontSize: 24 }]} tone={tone} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </Card>
  );
}

function Badge({ n, inline }: { n: number; inline?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        position: inline ? 'relative' : 'absolute',
        top: inline ? 0 : -2,
        right: inline ? 0 : -2,
        minWidth: 18,
        height: 18,
        paddingHorizontal: 5,
        borderRadius: 9,
        backgroundColor: colors.brand,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: inline ? spacing.sm : 0,
      }}
      accessibilityLabel={`${n} unread`}
    >
      <Text style={{ color: colors.onBrand, fontSize: 11, fontWeight: '700' }}>{n > 99 ? '99+' : n}</Text>
    </View>
  );
}

const pill = (bg: string) => ({
  paddingHorizontal: 12,
  paddingVertical: 7,
  borderRadius: radius.pill,
  backgroundColor: bg,
});

function shortWhen(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
