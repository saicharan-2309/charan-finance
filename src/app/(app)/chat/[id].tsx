/**
 * A conversation — one friend or a group. Plain, BUD-styled bubbles; shared
 * expenses, reminders and settlements appear as cards you can open. New
 * messages arrive live (Supabase Realtime, filtered by the same database
 * rules as everything else); "typing…" is a broadcast that's never stored.
 * The + button starts a split with the people in this chat.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';

import { haptic } from '@/components/ui/controls';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Glass } from '@/components/ui/glass';
import { Icon, Row, Text } from '@/components/ui/primitives';
import { Avatar } from '@/features/friends/Avatar';
import { useConversations, useMessages, usePeople } from '@/hooks/data';
import { qk } from '@/lib/query';
import { useUserId } from '@/providers/AuthProvider';
import { markConversationRead, sendMessage, subscribeToMessages, typingChannel } from '@/services/friends';
import { useTheme } from '@/theme/ThemeProvider';
import { GUTTER, radius, spacing } from '@/theme/tokens';
import type { ChatMessage } from '@/types/domain';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useUserId()!;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const client = useQueryClient();
  const conversations = useConversations();
  const messages = useMessages(id);
  const conv = (conversations.data ?? []).find((c) => c.id === id);
  const senders = useMemo(() => [...new Set((messages.data ?? []).map((m) => m.senderId))], [messages.data]);
  const people = usePeople(senders.filter((s) => s !== me));
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const typingRef = useRef<ReturnType<typeof typingChannel> | null>(null);
  const lastPing = useRef(0);

  // Live messages + read marker.
  useEffect(() => {
    if (!id) return;
    void markConversationRead(id).then(() => client.invalidateQueries({ queryKey: qk.conversations }));
    const off = subscribeToMessages(id, (m) => {
      client.setQueryData<ChatMessage[]>(qk.messages(id), (old) =>
        old && !old.some((x) => x.id === m.id) ? [...old, m] : old,
      );
      if (m.senderId !== me) void markConversationRead(id);
      setTyping(null);
    });
    return off;
  }, [id, me, client]);

  // Typing indicator (broadcast only).
  useEffect(() => {
    if (!id) return;
    let clear: ReturnType<typeof setTimeout> | undefined;
    typingRef.current = typingChannel(id, me, (uid) => {
      setTyping(uid);
      clearTimeout(clear);
      clear = setTimeout(() => setTyping(null), 3000);
    });
    return () => {
      clearTimeout(clear);
      typingRef.current?.close();
    };
  }, [id, me]);

  const send = async () => {
    const body = text.trim();
    if (!body || !id) return;
    setSending(true);
    setError(null);
    try {
      await sendMessage(id, body);
      setText('');
      haptic.selection();
      await client.invalidateQueries({ queryKey: qk.messages(id) });
      void client.invalidateQueries({ queryKey: qk.conversations });
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  };

  const title = conv?.title ?? 'Chat';
  const data = [...(messages.data ?? [])].reverse();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen
        options={{
          title: '',
          headerTitle: () => (
            <Pressable
              onPress={() =>
                conv?.kind === 'group' && conv.groupId
                  ? router.push({ pathname: '/groups/[id]', params: { id: conv.groupId } })
                  : conv?.otherUserId &&
                    router.push({ pathname: '/friends/[id]', params: { id: conv.otherUserId } })
              }
              accessibilityRole="button"
              accessibilityLabel={`${title}, open profile`}
            >
              <Row gap={spacing.sm}>
                <Avatar name={title} size={30} group={conv?.kind === 'group'} />
                <View>
                  <Text variant="bodyStrong">{title}</Text>
                  {typing ? (
                    <Text variant="caption" tone="brand">
                      typing…
                    </Text>
                  ) : null}
                </View>
              </Row>
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {messages.error && !messages.data ? (
          <ErrorState error={messages.error} onRetry={() => void messages.refetch()} />
        ) : messages.data === undefined ? (
          <View style={{ padding: GUTTER }}>
            <SkeletonList rows={5} />
          </View>
        ) : data.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState
              icon="chatbubbles-outline"
              title="Say hello"
              message="Paid for something together? Tap + to split it — the split appears here for everyone."
            />
          </View>
        ) : (
          <FlatList
            inverted
            data={data}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: GUTTER, gap: spacing.sm }}
            renderItem={({ item, index }) => {
              const mine = item.senderId === me;
              const next = data[index + 1];
              const showName = conv?.kind === 'group' && !mine && next?.senderId !== item.senderId;
              return (
                <Bubble
                  m={item}
                  mine={mine}
                  sender={showName ? (people.data?.get(item.senderId)?.name ?? 'Friend') : null}
                />
              );
            }}
          />
        )}

        {error ? (
          <Text variant="footnote" tone="negative" align="center" style={{ paddingHorizontal: GUTTER }}>
            Couldn’t send. Check your connection and try again.
          </Text>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: spacing.sm,
            paddingHorizontal: GUTTER,
            paddingTop: spacing.sm,
            paddingBottom: insets.bottom + spacing.sm,
          }}
        >
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/split/new',
                params: conv?.groupId
                  ? { groupId: conv.groupId }
                  : { friendId: conv?.otherUserId ?? undefined },
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Split a bill"
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.9 : 1 }] })}
          >
            <Glass
              interactive
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="add" size={24} tone="brand" />
            </Glass>
          </Pressable>
          <Glass style={{ flex: 1, borderRadius: radius.xl, minHeight: 44, justifyContent: 'center' }}>
            <TextInput
              value={text}
              onChangeText={(t) => {
                setText(t);
                if (Date.now() - lastPing.current > 2000) {
                  lastPing.current = Date.now();
                  typingRef.current?.ping();
                }
              }}
              placeholder="Message"
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={2000}
              accessibilityLabel="Message"
              style={{
                color: colors.text,
                fontSize: 16,
                paddingHorizontal: spacing.lg,
                paddingVertical: 11,
                maxHeight: 120,
              }}
            />
          </Glass>
          <Pressable
            onPress={() => void send()}
            disabled={!text.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="Send"
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: text.trim() ? colors.brand : colors.fill,
              transform: [{ scale: pressed ? 0.9 : 1 }],
            })}
          >
            <Icon name="arrow-up" size={22} color={text.trim() ? colors.onBrand : colors.textTertiary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Bubble({ m, mine, sender }: { m: ChatMessage; mine: boolean; sender: string | null }) {
  const { colors } = useTheme();
  const time = new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

  if (m.kind === 'system') {
    return (
      <Text variant="caption" tone="tertiary" align="center" style={{ marginVertical: spacing.xs }}>
        {m.body}
      </Text>
    );
  }

  if (m.kind === 'expense' || m.kind === 'settlement' || m.kind === 'reminder') {
    const icon =
      m.kind === 'expense' ? 'receipt' : m.kind === 'settlement' ? 'checkmark-circle' : 'notifications';
    const label = m.kind === 'expense' ? 'Shared expense' : m.kind === 'settlement' ? 'Payment' : 'Reminder';
    return (
      <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
        {sender ? (
          <Text variant="caption" tone="secondary" style={{ marginLeft: spacing.md, marginBottom: 2 }}>
            {sender}
          </Text>
        ) : null}
        <Pressable
          disabled={!m.sharedExpenseId}
          onPress={() =>
            m.sharedExpenseId && router.push({ pathname: '/shared/[id]', params: { id: m.sharedExpenseId } })
          }
          accessibilityRole={m.sharedExpenseId ? 'button' : undefined}
          style={({ pressed }) => ({
            maxWidth: '80%',
            padding: spacing.md,
            borderRadius: radius.lg,
            backgroundColor: colors.surface,
            borderWidth: 1.5,
            borderColor: m.kind === 'reminder' ? colors.highlight : colors.brandSoft,
            opacity: pressed ? 0.8 : 1,
            gap: 4,
          })}
        >
          <Row gap={6}>
            <Icon name={icon} size={15} tone="brand" />
            <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
              {label}
            </Text>
          </Row>
          <Text variant="bodyStrong">{m.body}</Text>
          <Text variant="caption" tone="tertiary">
            {m.sharedExpenseId ? 'Tap to see who owes what · ' : ''}
            {time}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      {sender ? (
        <Text variant="caption" tone="secondary" style={{ marginLeft: spacing.md, marginBottom: 2 }}>
          {sender}
        </Text>
      ) : null}
      <View
        style={{
          maxWidth: '80%',
          paddingHorizontal: spacing.md + 2,
          paddingVertical: spacing.sm + 1,
          borderRadius: 20,
          borderBottomRightRadius: mine ? 6 : 20,
          borderBottomLeftRadius: mine ? 20 : 6,
          backgroundColor: mine ? colors.brand : colors.surface,
        }}
      >
        <Text variant="callout" style={{ color: mine ? colors.onBrand : colors.text }}>
          {m.body}
        </Text>
        <Text
          variant="caption"
          style={{
            color: mine ? colors.onBrand : colors.textTertiary,
            opacity: mine ? 0.75 : 1,
            alignSelf: 'flex-end',
            marginTop: 2,
          }}
        >
          {time}
        </Text>
      </View>
    </View>
  );
}
