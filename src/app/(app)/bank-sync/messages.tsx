/**
 * Every bank SMS the app has kept, newest first, with what it did with each —
 * so nothing is ever recorded (or skipped) without a trace the user can check.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { EmptyState, QueryState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Card, Divider, Icon, Row, Text } from '@/components/ui/primitives';
import { useRecentMessages } from '@/hooks/data';
import { formatDayLabel, formatTime } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { invalidateFinancialData } from '@/lib/query';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { BankMessage, BankMessageStatus } from '@/types/domain';

const STATUS: Record<BankMessageStatus, { label: string; tone: 'positive' | 'warning' | 'secondary' | 'brand' }> = {
  received: { label: 'Processing', tone: 'secondary' },
  created: { label: 'Added', tone: 'positive' },
  linked: { label: 'Matched your entry', tone: 'positive' },
  paired: { label: 'Transfer', tone: 'brand' },
  duplicate: { label: 'Already recorded', tone: 'secondary' },
  ignored: { label: 'Skipped', tone: 'secondary' },
  needs_account: { label: 'Needs an account', tone: 'warning' },
  awaiting_pair: { label: 'Waiting for other side', tone: 'warning' },
  balance: { label: 'Balance update', tone: 'secondary' },
  dismissed: { label: 'Dismissed', tone: 'secondary' },
};

export default function BankMessagesScreen() {
  const q = useRecentMessages();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <Screen
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await invalidateFinancialData();
        setRefreshing(false);
      }}
    >
      <QueryState query={q}>
        {(messages) =>
          messages.length === 0 ? (
            <EmptyState
              icon="chatbox-ellipses-outline"
              title="No bank messages yet"
              message="Once the Shortcut is set up, every bank SMS you receive shows up here with what the app did with it."
              actionLabel="Set up bank sync"
              onAction={() => router.push('/bank-sync')}
            />
          ) : (
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
              {messages.map((m, i) => (
                <View key={m.id}>
                  {i > 0 ? <Divider /> : null}
                  <MessageRow m={m} />
                </View>
              ))}
            </Card>
          )
        }
      </QueryState>
    </Screen>
  );
}

function MessageRow({ m }: { m: BankMessage }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const s = STATUS[m.status];
  return (
    <Pressable
      onPress={() => (m.transactionId && !open ? setOpen(true) : setOpen((v) => !v))}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={{ paddingVertical: spacing.md, gap: 6 }}
    >
      <Row justify="space-between" align="flex-start" gap={spacing.md}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {m.merchant ?? (m.direction === 'credit' ? 'Money in' : m.direction === 'debit' ? 'Money out' : 'Message')}
          </Text>
          <Text variant="caption" tone="secondary">
            {formatDayLabel(new Date(m.receivedAt))}, {formatTime(m.receivedAt)}
            {m.last4 ? `, ends ${m.last4}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {m.amount !== null ? (
            <Text variant="amount" tone={m.direction === 'credit' ? 'positive' : 'primary'}>
              {m.direction === 'credit' ? '+' : ''}
              {formatMoney(m.amount, 'INR', { decimals: 'never' })}
            </Text>
          ) : null}
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 2,
              borderRadius: radius.pill,
              backgroundColor:
                s.tone === 'positive'
                  ? colors.positiveSoft
                  : s.tone === 'warning'
                    ? colors.warningSoft
                    : s.tone === 'brand'
                      ? colors.brandSoft
                      : colors.surfaceMuted,
            }}
          >
            <Text variant="caption" tone={s.tone}>
              {s.label}
            </Text>
          </View>
        </View>
      </Row>
      {open ? (
        <View style={{ gap: spacing.sm }}>
          <Text
            variant="footnote"
            tone="secondary"
            selectable
            style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md }}
          >
            {m.body}
          </Text>
          {m.transactionId ? (
            <Pressable
              onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: m.transactionId! } })}
              accessibilityRole="link"
            >
              <Row gap={4}>
                <Text variant="subhead" tone="brand">
                  Open transaction
                </Text>
                <Icon name="chevron-forward" size={14} tone="brand" />
              </Row>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
