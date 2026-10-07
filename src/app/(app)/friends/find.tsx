/**
 * Find people on BUD by username (prefix) or exact email, and send requests.
 * The database decides who is findable: never yourself, never someone who
 * blocked you (or whom you blocked), only people who allow being found.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { TextField } from '@/components/ui/controls';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Card, Divider, Icon, Row, Text } from '@/components/ui/primitives';
import { Avatar } from '@/features/friends/Avatar';
import { useAppMutation } from '@/hooks/data';
import { qk } from '@/lib/query';
import { respondFriendRequest, searchPeople, sendFriendRequest } from '@/services/friends';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { SearchResult } from '@/types/domain';

export default function FindFriends() {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchPeople(q);
        if (live) {
          setResults(r);
          setError(null);
        }
      } catch (e) {
        if (live) setError(e);
      } finally {
        if (live) setSearching(false);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const update = (id: string, relation: SearchResult['relation']) =>
    setResults((r) => r?.map((x) => (x.id === id ? { ...x, relation } : x)) ?? null);

  const send = useAppMutation(sendFriendRequest, {
    context: 'friends.request',
    invalidate: [qk.friendships],
    success: (r) => (r === 'accepted' ? 'You’re now friends' : 'Request sent'),
    onSuccess: (r, id) => update(id, r === 'accepted' ? 'friend' : 'requested'),
  });
  const accept = useAppMutation((id: string) => respondFriendRequest(id, true), {
    context: 'friends.accept',
    invalidate: [qk.friendships, qk.friendBalances],
    success: 'You’re now friends',
    onSuccess: (_r, id) => update(id, 'friend'),
  });

  return (
    <Screen>
      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder="Username or email"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        keyboardType="email-address"
        returnKeyType="search"
        leading={<Icon name="search" size={18} tone="tertiary" />}
        trailing={searching ? <ActivityIndicator /> : null}
        accessibilityLabel="Search people"
        containerStyle={{ marginBottom: spacing.xl }}
      />

      {error && query.trim().length >= 2 ? (
        <ErrorState error={error} compact onRetry={() => setQuery((q) => `${q}`)} />
      ) : results === null || query.trim().length < 2 ? (
        <Text variant="footnote" tone="secondary">
          Search by BUD username, or type someone’s full email address. People only see your name, username
          and status — never your accounts or transactions.
        </Text>
      ) : results.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon="person-outline"
            title="No one found"
            message="Check the spelling, or ask them for their BUD username."
          />
        </Card>
      ) : (
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          {results.map((p, i) => (
            <View key={p.id}>
              {i > 0 ? <Divider inset={56} /> : null}
              <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                <Avatar name={p.name} size={44} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text variant="footnote" tone="secondary" numberOfLines={1}>
                    {p.username ? `@${p.username}` : ' '}
                  </Text>
                </View>
                {p.relation === 'friend' ? (
                  <Pressable
                    onPress={() => router.push({ pathname: '/friends/[id]', params: { id: p.id } })}
                    style={pill(colors.fill)}
                    accessibilityRole="button"
                  >
                    <Text variant="subhead">Friends</Text>
                  </Pressable>
                ) : p.relation === 'requested' ? (
                  <View style={pill(colors.fill)}>
                    <Text variant="subhead" tone="secondary">
                      Requested
                    </Text>
                  </View>
                ) : p.relation === 'incoming' ? (
                  <Pressable
                    onPress={() => accept.mutate(p.id)}
                    style={pill(colors.brand)}
                    accessibilityRole="button"
                  >
                    <Text variant="subhead" style={{ color: colors.onBrand, fontWeight: '600' }}>
                      Accept
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => send.mutate(p.id)}
                    style={pill(colors.brand)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${p.name}`}
                  >
                    <Text variant="subhead" style={{ color: colors.onBrand, fontWeight: '600' }}>
                      Add
                    </Text>
                  </Pressable>
                )}
              </Row>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const pill = (bg: string) => ({
  paddingHorizontal: 14,
  paddingVertical: 7,
  borderRadius: radius.pill,
  backgroundColor: bg,
});
