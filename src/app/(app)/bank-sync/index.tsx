/**
 * Bank sync — set up automatic capture of bank SMS.
 *
 * India's account-data network (Account Aggregator) is open only to regulated
 * companies, so the app reads the alert every bank sends by law for each debit
 * and credit. An iPhone Shortcut forwards each SMS to the app's own backend
 * the moment it arrives; the backend records it, matches it to an account,
 * skips duplicates and files transfers correctly.
 */
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Button, TextField, haptic } from '@/components/ui/controls';
import { QueryState, useToast } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, Icon, IconBadge, Row, Text } from '@/components/ui/primitives';
import { useAccounts, useAppMutation, useBankSyncStatus } from '@/hooks/data';
import { formatDayLabel, formatTime } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { qk } from '@/lib/query';
import {
  connectBankSync,
  disconnectBankSync,
  getStoredSyncKey,
  INGEST_URL,
  testBankSync,
} from '@/services/bank-sync';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import { describeParsed, parseBankSms } from '@/lib/bank-sms';

const NEEDS_DIGITS = new Set(['bank', 'savings', 'credit_card', 'debit_card']);

export default function BankSyncScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const status = useBankSyncStatus();
  const accounts = useAccounts();
  const [key, setKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [sample, setSample] = useState('');

  useEffect(() => {
    getStoredSyncKey()
      .then(setKey)
      .catch(() => setKey(null));
  }, [status.data?.connectedAt]);

  const connect = useAppMutation(connectBankSync, {
    context: 'bank-sync.connect',
    invalidate: [qk.bankSync],
    onSuccess: (k) => {
      setKey(k);
      setShowKey(true);
    },
    success: 'Bank sync is on. Now add the Shortcut on your iPhone.',
  });
  const disconnect = useAppMutation(disconnectBankSync, {
    context: 'bank-sync.disconnect',
    invalidate: [qk.bankSync],
    onSuccess: () => setKey(null),
    success: 'Bank sync is off. The old key no longer works.',
  });

  const copy = async (value: string, what: string) => {
    await Clipboard.setStringAsync(value);
    haptic.success();
    toast.show(`${what} copied`, 'success');
  };

  const runTest = async () => {
    if (!key) return;
    setTesting(true);
    setTest(await testBankSync(key));
    setTesting(false);
  };

  const missingDigits = (accounts.data ?? []).filter((a) => a.isActive && NEEDS_DIGITS.has(a.type) && !a.last4);
  const preview = useMemo(
    () => (sample.trim() ? parseBankSms({ body: sample, receivedAt: new Date().toISOString() }) : null),
    [sample],
  );

  return (
    <Screen>
      <QueryState query={status}>
        {(s) => (
          <>
            {/* Status */}
            <Card style={{ gap: spacing.md, marginBottom: spacing.xxl }}>
              <Row gap={spacing.md}>
                <IconBadge
                  icon={s.connected ? 'radio' : 'radio-outline'}
                  color={s.connected ? colors.positive : colors.textSecondary}
                  size={44}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="headline">{s.connected ? 'Bank sync is on' : 'Add transactions automatically'}</Text>
                  <Text variant="footnote" tone="secondary">
                    {s.connected
                      ? s.lastMessageAt
                        ? `Last message ${formatDayLabel(new Date(s.lastMessageAt)).toLowerCase()} at ${formatTime(s.lastMessageAt)}`
                        : 'Waiting for the first bank SMS'
                      : 'Your bank texts you for every payment. Forward those texts here and they become transactions — categorised, matched to the right account, never double-counted.'}
                  </Text>
                </View>
              </Row>
              {s.connected && (s.toReview > 0 || s.pending > 0) ? (
                <Button
                  title={
                    s.pending > 0
                      ? `${s.pending} need${s.pending === 1 ? 's' : ''} an account, ${s.toReview} to check`
                      : `${s.toReview} to check`
                  }
                  variant="secondary"
                  size="md"
                  onPress={() => router.push('/review')}
                />
              ) : null}
              {!s.connected ? (
                <Button
                  title="Turn on bank sync"
                  icon="flash"
                  loading={connect.isPending}
                  onPress={() => connect.mutate(undefined)}
                />
              ) : null}
            </Card>

            {missingDigits.length > 0 ? (
              <Section title="Add the last digits">
                <Card style={{ gap: spacing.sm }}>
                  <Text variant="footnote" tone="secondary">
                    Messages are matched to accounts by the last 4 digits of the account or card number. These
                    don’t have them yet:
                  </Text>
                  {missingDigits.map((a, i) => (
                    <View key={a.id}>
                      {i > 0 ? <Divider /> : null}
                      <Pressable
                        onPress={() => router.push({ pathname: '/accounts/edit', params: { id: a.id } })}
                        accessibilityRole="button"
                        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: spacing.sm })}
                      >
                        <Row justify="space-between">
                          <Text variant="bodyStrong">{a.name}</Text>
                          <Text variant="subhead" tone="brand">
                            Add digits
                          </Text>
                        </Row>
                      </Pressable>
                    </View>
                  ))}
                </Card>
              </Section>
            ) : null}

            {s.connected ? (
              <>
                <Section title="Your Shortcut details">
                  <Card style={{ gap: spacing.lg }}>
                    <CopyField label="Address" value={INGEST_URL} onCopy={() => copy(INGEST_URL, 'Address')} />
                    <Divider />
                    {key ? (
                      <CopyField
                        label="Sync key"
                        value={showKey ? key : `${key.slice(0, 10)}${'•'.repeat(18)}${key.slice(-4)}`}
                        onCopy={() => copy(key, 'Sync key')}
                        trailing={
                          <Pressable onPress={() => setShowKey((v) => !v)} hitSlop={8} accessibilityRole="button">
                            <Text variant="subhead" tone="brand">
                              {showKey ? 'Hide' : 'Show'}
                            </Text>
                          </Pressable>
                        }
                      />
                    ) : (
                      <View style={{ gap: spacing.sm }}>
                        <Text variant="footnote" tone="secondary">
                          This phone doesn’t have the sync key (it was set up on another device or reinstalled). Make
                          a new key — the Shortcut will need the new one.
                        </Text>
                        <Button
                          title="Make a new key"
                          variant="secondary"
                          size="md"
                          loading={connect.isPending}
                          onPress={() => connect.mutate(undefined)}
                        />
                      </View>
                    )}
                    {key ? (
                      <>
                        <Button
                          title="Test connection"
                          variant="secondary"
                          size="md"
                          icon="pulse"
                          loading={testing}
                          onPress={runTest}
                        />
                        {test ? (
                          <Row gap={spacing.sm}>
                            <Icon
                              name={test.ok ? 'checkmark-circle' : 'alert-circle'}
                              size={18}
                              tone={test.ok ? 'positive' : 'negative'}
                            />
                            <Text variant="footnote" tone={test.ok ? 'positive' : 'negative'} style={{ flex: 1 }}>
                              {test.message}
                            </Text>
                          </Row>
                        ) : null}
                      </>
                    ) : null}
                  </Card>
                </Section>

                <Section title="Set up the Shortcut — once">
                  <Card style={{ gap: spacing.lg }}>
                    {STEPS.map((step, i) => (
                      <Row key={step.title} align="flex-start" gap={spacing.md}>
                        <View
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            backgroundColor: colors.brandSoft,
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginTop: 1,
                          }}
                        >
                          <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
                            {i + 1}
                          </Text>
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text variant="bodyStrong">{step.title}</Text>
                          <Text variant="footnote" tone="secondary">
                            {step.body}
                          </Text>
                        </View>
                      </Row>
                    ))}
                    <View style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md }}>
                      <Text variant="footnote" tone="secondary">
                        Every text passes through your own server for a moment, but only bank alerts are kept. OTPs,
                        promotions and personal messages are discarded on arrival and never saved.
                      </Text>
                    </View>
                  </Card>
                </Section>
              </>
            ) : null}

            <Section title="Try a message">
              <Card style={{ gap: spacing.md }}>
                <Text variant="footnote" tone="secondary">
                  Paste a bank SMS to see what the app reads from it. Nothing is saved.
                </Text>
                <TextField
                  value={sample}
                  onChangeText={setSample}
                  placeholder="Sent Rs.450.00 From HDFC Bank A/C *1234 To SWIGGY…"
                  multiline
                  style={{ minHeight: 88, textAlignVertical: 'top' }}
                />
                {preview ? <ParsePreview preview={preview} /> : null}
              </Card>
            </Section>

            <Card padded={false} style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.xxl }}>
              <LinkRow icon="file-tray-full-outline" title="Review inbox" onPress={() => router.push('/review')} />
              <Divider inset={40} />
              <LinkRow
                icon="chatbox-ellipses-outline"
                title="All bank messages"
                onPress={() => router.push('/bank-sync/messages')}
              />
              <Divider inset={40} />
              <LinkRow icon="git-branch-outline" title="Auto-categorise rules" onPress={() => router.push('/rules')} />
            </Card>

            {s.connected ? (
              <Button
                title="Turn off bank sync"
                variant="destructive"
                loading={disconnect.isPending}
                onPress={() =>
                  Alert.alert(
                    'Turn off bank sync?',
                    'The Shortcut’s key stops working straight away. Transactions already added stay.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Turn off',
                        style: 'destructive',
                        onPress: () => disconnect.mutate(undefined),
                      },
                    ],
                  )
                }
              />
            ) : null}
            {connect.error ? (
              <Text variant="footnote" tone="negative" style={{ marginTop: spacing.md }}>
                {describeError(connect.error).message}
              </Text>
            ) : null}
          </>
        )}
      </QueryState>
    </Screen>
  );
}

const STEPS = [
  {
    title: 'Create a Message automation',
    body: 'Open Shortcuts › Automation › + (New Automation) › Message. Leave Sender and Message Contains empty, choose Run Immediately, then Next › New Blank Automation.',
  },
  {
    title: 'Add “Get Contents of URL”',
    body: 'Search for the action and add it. Paste the Address above as the URL.',
  },
  {
    title: 'Set method and key',
    body: 'Tap the arrow to show more. Method: POST. Under Headers add a header named x-sync-key with your Sync key as the value.',
  },
  {
    title: 'Send the message',
    body: 'Request Body: JSON. Add a Text field named text — tap the value, choose Shortcut Input, then tap it again and pick Content. Add another named sender and pick Sender.',
  },
  {
    title: 'Optional: see what was added',
    body: 'Add “Get Dictionary Value” for summary, then “Show Notification”. You’ll see “Spent ₹450 · Swiggy” a second after each payment.',
  },
  {
    title: 'Done',
    body: 'Tap Done, and turn off Notify When Run if you don’t want a banner. Tap Test connection above to check the key, then make any small UPI payment.',
  },
];

function CopyField({
  label,
  value,
  onCopy,
  trailing,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Row justify="space-between">
        <Text variant="caption" tone="secondary">
          {label}
        </Text>
        <Row gap={spacing.lg}>
          {trailing}
          <Pressable onPress={onCopy} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Copy ${label}`}>
            <Text variant="subhead" tone="brand">
              Copy
            </Text>
          </Pressable>
        </Row>
      </Row>
      <Text variant="callout" selectable numberOfLines={2} style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
    </View>
  );
}

function LinkRow({ icon, title, onPress }: { icon: string; title: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: spacing.md })}
    >
      <Row gap={spacing.md}>
        <Icon name={icon} size={20} tone="secondary" />
        <Text variant="body" style={{ flex: 1 }}>
          {title}
        </Text>
        <Icon name="chevron-forward" size={18} tone="tertiary" />
      </Row>
    </Pressable>
  );
}

function ParsePreview({ preview }: { preview: ReturnType<typeof parseBankSms> }) {
  const { colors } = useTheme();
  if (preview.kind !== 'transaction') {
    return (
      <Row gap={spacing.sm}>
        <Icon name="remove-circle-outline" size={18} tone="secondary" />
        <Text variant="footnote" tone="secondary">
          {describeParsed(preview)} — this would not be recorded.
        </Text>
      </Row>
    );
  }
  const rows: [string, string | null][] = [
    ['What', preview.isCardPaymentReceived ? 'Card bill payment' : preview.direction === 'debit' ? 'Money out' : 'Money in'],
    ['Amount', `₹${preview.amount}`],
    ['Merchant', preview.merchant],
    [
      'Account',
      preview.last4
        ? `${preview.instrument === 'account' ? 'Account' : 'Card'} ending ${preview.last4}`
        : preview.instrument
          ? 'Not stated'
          : null,
    ],
    ['Bank', preview.bank?.toUpperCase() ?? null],
    ['Reference', preview.reference],
    ['Balance shown', preview.balance ? `₹${preview.balance}${preview.balanceKind === 'limit' ? ' available' : ''}` : null],
  ];
  return (
    <View style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md, gap: 6 }}>
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <Row key={k} justify="space-between">
            <Text variant="footnote" tone="secondary">
              {k}
            </Text>
            <Text variant="footnote" style={{ fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>
              {v}
            </Text>
          </Row>
        ))}
    </View>
  );
}
