/**
 * Notifications: friend requests, messages, shared expenses, payments and
 * reminders. Each one opens what it's about. Opening the list marks them read.
 */
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Card, Divider, Icon, Row, Text } from '@/components/ui/primitives';
import { useNotifications } from '@/hooks/data';
import { qk } from '@/lib/query';
import { openNotification } from '@/features/friends/live';
import { markNotificationsRead } from '@/services/friends';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import type { AppNotification } from '@/types/domain';

const ICON: Record<AppNotification['kind'], string> = {
  friend_request: 'person-add',
  friend_accepted: 'people',
  message: 'chatbubble',
  expense_added: 'receipt',
  expense_updated: 'create',
  expense_cancelled: 'close-circle',
  settlement_marked: 'swap-horizontal',
  settlement_completed: 'checkmark-circle',
  reminder: 'notifications',
};

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const client = useQueryClient();
  const q = useNotifications();

  useEffect(() => {
    if ((q.data ?? []).some((n) => !n.readAt)) {
      void markNotificationsRead().then(() => client.invalidateQueries({ queryKey: qk.notifications }));
    }
  }, [q.data, client]);

  return (
    <Screen refreshing={false} onRefresh={() => void q.refetch()}>
      {q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data === undefined ? (
        <SkeletonList rows={6} />
      ) : q.data.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title="Nothing new"
          message="Friend requests, shared expenses, payments and messages show up here."
        />
      ) : (
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          {q.data.map((n, i) => (
            <View key={n.id}>
              {i > 0 ? <Divider inset={48} /> : null}
              <Pressable
                onPress={() => openNotification(n)}
                accessibilityRole="button"
                accessibilityLabel={`${n.title}. ${n.body ?? ''}`}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Row gap={spacing.md} align="flex-start" style={{ paddingVertical: spacing.md }}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 12,
                      backgroundColor: colors.brandSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name={ICON[n.kind]} size={18} tone="brand" />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {n.title}
                    </Text>
                    {n.body ? (
                      <Text variant="footnote" tone="secondary" numberOfLines={2}>
                        {n.body}
                      </Text>
                    ) : null}
                    <Text variant="caption" tone="tertiary">
                      {new Date(n.createdAt).toLocaleString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  {!n.readAt ? (
                    <View
                      accessibilityLabel="Unread"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: colors.brand,
                        marginTop: 6,
                      }}
                    />
                  ) : null}
                </Row>
              </Pressable>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
