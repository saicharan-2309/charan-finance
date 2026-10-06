/**
 * Home's bank-sync slot. With sync on, it says how many auto-added
 * transactions are waiting for a glance; with sync off, it offers to set it
 * up. When there is nothing to say, it renders nothing.
 */
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Icon, Row, Text } from '@/components/ui/primitives';
import { useBankSyncStatus } from '@/hooks/data';
import { useFoundAccounts } from './FoundAccounts';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export function BankSyncCard() {
  const { colors } = useTheme();
  const q = useBankSyncStatus();
  const found = useFoundAccounts();
  const s = q.data;
  if (!s) return null;

  if (!s.connected) {
    return (
      <Pressable
        onPress={() => router.push('/bank-sync')}
        accessibilityRole="button"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.lg,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: colors.borderStrong,
          backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
          marginBottom: spacing.xxl,
        })}
      >
        <Icon name="flash-outline" size={22} tone="brand" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">Add transactions automatically</Text>
          <Text variant="footnote" tone="secondary">
            Let your bank’s SMS alerts fill this in. Set up once.
          </Text>
        </View>
        <Icon name="chevron-forward" size={18} tone="tertiary" />
      </Pressable>
    );
  }

  // Messages grouped under a found account are counted as that one account.
  const foundCount = found.items.length;
  const grouped = found.items.reduce((n, d) => n + d.messageCount, 0);
  const loose = Math.max(0, s.pending - grouped);
  const total = s.toReview + loose + foundCount;
  if (total === 0) return null;

  return (
    <Pressable
      onPress={() => router.push('/review')}
      accessibilityRole="button"
      accessibilityLabel={`${total} items from your bank to check`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.xl,
        backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        marginBottom: spacing.xxl,
      })}
    >
      <View
        style={{
          minWidth: 40,
          height: 40,
          paddingHorizontal: 8,
          borderRadius: 20,
          backgroundColor: colors.highlight,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text variant="headline" style={{ color: '#161D36' }}>
          {total > 99 ? '99+' : total}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">
          {foundCount > 0
            ? `${foundCount} new account${foundCount === 1 ? '' : 's'} in your messages`
            : s.toReview > 0
              ? `New from your bank`
              : 'Your bank sent something new'}
        </Text>
        <Row gap={spacing.xs}>
          <Text variant="footnote" tone="secondary" numberOfLines={1}>
            {[
              foundCount > 0 ? `${grouped} transaction${grouped === 1 ? '' : 's'} ready to add` : null,
              s.toReview > 0 ? `${s.toReview} to check` : null,
              loose > 0 ? `${loose} need${loose === 1 ? 's' : ''} an account` : null,
            ]
              .filter(Boolean)
              .join(', ')}
          </Text>
        </Row>
      </View>
      <Icon name="chevron-forward" size={18} tone="tertiary" />
    </Pressable>
  );
}
