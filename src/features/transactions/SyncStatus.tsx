/**
 * Communicates offline/sync state: a compact banner when writes are waiting,
 * and an explicit list of failed writes with Retry / Discard — nothing is
 * dropped without the user deciding.
 */
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Icon, MoneyText, Text } from '@/components/ui/primitives';
import { useOfflineQueue } from '@/hooks/data';
import { offlineQueue, type QueueItem } from '@/lib/offline-queue';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(
    () => NetInfo.addEventListener((s) => setOnline(!!s.isConnected && s.isInternetReachable !== false)),
    [],
  );
  return online;
}

export function SyncBanner() {
  const { colors } = useTheme();
  const items = useOfflineQueue();
  const online = useIsOnline();
  const pending = items.filter((i) => i.status === 'pending').length;
  const failed = items.filter((i) => i.status === 'failed');

  if (online && items.length === 0) return null;

  const tone = failed.length ? colors.negative : colors.warning;
  const bg = failed.length ? colors.negativeSoft : colors.warningSoft;
  const message = failed.length
    ? `${failed.length} change${failed.length > 1 ? 's' : ''} couldn't sync — tap to review`
    : !online
      ? pending
        ? `Offline · ${pending} change${pending > 1 ? 's' : ''} will sync when you're back online`
        : "You're offline · showing saved data"
      : `Syncing ${pending} change${pending > 1 ? 's' : ''}…`;

  return (
    <Pressable
      accessibilityRole={failed.length ? 'button' : 'text'}
      onPress={
        failed.length
          ? () => reviewFailed(failed)
          : pending && online
            ? () => void offlineQueue.flush()
            : undefined
      }
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: bg,
        borderRadius: radius.md,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        marginBottom: spacing.lg,
      }}
    >
      <Icon
        name={failed.length ? 'alert-circle' : online ? 'sync' : 'cloud-offline-outline'}
        size={18}
        color={tone}
      />
      <Text variant="footnote" style={{ flex: 1, color: tone }}>
        {message}
      </Text>
    </Pressable>
  );
}

function reviewFailed(failed: QueueItem[]) {
  const first = failed[0];
  Alert.alert(
    `Couldn't save “${first.display.title}”`,
    `${first.error ?? 'The server rejected this change.'}\n\nRetry it, or discard it if it's no longer needed.`,
    [
      { text: 'Keep for later', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => void offlineQueue.discard(first.opId) },
      { text: 'Retry', onPress: () => void offlineQueue.retry(first.opId) },
    ],
  );
}

/** Pending creates shown above the real list so the user sees them immediately. */
export function PendingTransactions() {
  const items = useOfflineQueue().filter((i) => i.kind === 'save');
  if (items.length === 0) return null;
  return (
    <View style={{ marginBottom: spacing.lg, gap: spacing.xs }}>
      <Text variant="overline" tone="secondary">
        Waiting to sync
      </Text>
      {items.map((i) => (
        <View
          key={i.opId}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm }}
        >
          <Icon
            name={i.status === 'failed' ? 'alert-circle' : 'cloud-upload-outline'}
            size={20}
            tone={i.status === 'failed' ? 'negative' : 'warning'}
          />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {i.display.title}
            </Text>
            <Text variant="footnote" tone="secondary" numberOfLines={1}>
              {i.status === 'failed' ? i.error : i.display.subtitle}
            </Text>
          </View>
          <MoneyText
            minor={i.display.type === 'expense' ? -i.display.amount : i.display.amount}
            currency={i.display.currency}
            tone={i.display.type === 'income' ? 'positive' : 'primary'}
          />
        </View>
      ))}
    </View>
  );
}
