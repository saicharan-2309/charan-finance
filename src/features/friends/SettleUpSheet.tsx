/**
 * Settle up with one friend: how much (full or part), which way, from/to
 * which of your accounts. The settlement is recorded separately from the
 * expenses — nothing historical changes — and is allocated to the oldest
 * bills first. Your friend records their own side when they see it.
 */
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, SegmentedControl, TextField } from '@/components/ui/controls';
import { SelectField, SelectSheet } from '@/components/ui/pickers';
import { Text } from '@/components/ui/primitives';
import { accountOptions } from '@/features/shared/options';
import { useAccounts, useAppMutation } from '@/hooks/data';
import {
  formatMoney,
  minorToInput,
  parseAmountInput,
  sanitizeAmountKeystrokes,
  type Minor,
} from '@/lib/money';
import { recordSettlement } from '@/services/friends';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export function SettleUpSheet({
  visible,
  friendId,
  friendName,
  net,
  currency,
  groupId,
  onClose,
}: {
  visible: boolean;
  friendId: string;
  friendName: string;
  /** Positive: they owe you. Negative: you owe them. */
  net: Minor;
  currency: string;
  groupId?: string | null;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const accounts = useAccounts();
  const iOwe = net < 0;
  const owed = Math.abs(net) as Minor;
  // Mounted fresh each time it opens (callers render it only while open), so
  // the form starts from the full amount owed.
  const [direction, setDirection] = useState<'full' | 'part'>('full');
  const [text, setText] = useState(() => minorToInput(owed));
  const [accountId, setAccountId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState('');

  const options = useMemo(
    () => accountOptions(accounts.data ?? [], (a) => a.type !== 'credit_card' || iOwe),
    [accounts.data, iOwe],
  );
  const account = (accounts.data ?? []).find((a) => a.id === accountId) ?? null;
  const amount = direction === 'full' ? owed : parseAmountInput(text);
  const invalid = amount === null || amount <= 0 || amount > owed;

  const save = useAppMutation(recordSettlement, {
    context: 'friends.settle',
    invalidate: 'financial',
    success: iOwe ? `Recorded — ${friendName} will see it` : 'Recorded as received',
    onSuccess: onClose,
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View
          style={{
            flex: 1,
            backgroundColor: colors.background,
            padding: spacing.xl,
            paddingBottom: insets.bottom + spacing.xl,
            gap: spacing.xl,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="title">Settle up</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
              <Text variant="bodyStrong" tone="brand">
                Cancel
              </Text>
            </Pressable>
          </View>

          <View
            style={{
              padding: spacing.lg,
              borderRadius: radius.lg,
              backgroundColor: iOwe ? colors.negativeSoft : colors.positiveSoft,
            }}
          >
            <Text variant="callout" tone={iOwe ? 'negative' : 'positive'} style={{ fontWeight: '600' }}>
              {iOwe
                ? `You owe ${friendName} ${formatMoney(owed, currency)}`
                : `${friendName} owes you ${formatMoney(owed, currency)}`}
            </Text>
            <Text variant="footnote" tone="secondary" style={{ marginTop: 2 }}>
              {iOwe
                ? 'Record what you paid them. It comes out of the account you choose.'
                : 'Record what they paid you. It goes into the account you choose.'}
            </Text>
          </View>

          <SegmentedControl
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'full', label: `Full ${formatMoney(owed, currency, { decimals: 'never' })}` },
              { value: 'part', label: 'Part of it' },
            ]}
          />
          {direction === 'part' ? (
            <TextField
              label="Amount"
              value={text}
              onChangeText={(t) => setText(sanitizeAmountKeystrokes(t))}
              keyboardType="decimal-pad"
              leading={<Text tone="secondary">₹</Text>}
              error={
                amount !== null && amount > owed
                  ? `That’s more than the ${formatMoney(owed, currency)} owed.`
                  : null
              }
              helper={
                amount !== null && amount > 0 && amount < owed
                  ? `${formatMoney((owed - amount) as Minor, currency)} will still be outstanding.`
                  : undefined
              }
            />
          ) : null}

          <SelectField
            label={iOwe ? 'Paid from' : 'Received into'}
            value={account?.name ?? null}
            placeholder="Choose an account"
            icon={account?.icon}
            color={account?.color}
            onPress={() => setPicking(true)}
          />
          <TextField
            label="Note (optional)"
            value={note}
            onChangeText={setNote}
            placeholder="e.g. UPI"
            maxLength={200}
          />

          <View style={{ flex: 1 }} />
          <Button
            title={iOwe ? 'Record payment' : 'Record as received'}
            disabled={invalid || !accountId}
            loading={save.isPending}
            onPress={() =>
              amount !== null &&
              save.mutate({
                otherUserId: friendId,
                direction: iOwe ? 'i_paid' : 'they_paid',
                amount,
                accountId,
                groupId: groupId ?? null,
                note: note || null,
              })
            }
          />
        </View>
      </KeyboardAvoidingView>
      <SelectSheet
        visible={picking}
        title={iOwe ? 'Paid from' : 'Received into'}
        options={options}
        selected={accountId}
        onSelect={(v) => {
          setAccountId(v);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </Modal>
  );
}

/** Pick the account a friend's recorded payment landed in (or left from). */
export function BookSettlementSheet({
  visible,
  title,
  onPick,
  onClose,
  creditOnly,
}: {
  visible: boolean;
  title: string;
  onPick: (accountId: string) => void;
  onClose: () => void;
  creditOnly?: boolean;
}) {
  const accounts = useAccounts();
  const options = accountOptions(
    accounts.data ?? [],
    creditOnly ? (a) => a.type === 'credit_card' : undefined,
  );
  return (
    <SelectSheet
      visible={visible}
      title={title}
      options={options}
      selected={null}
      onSelect={(v) => {
        if (v) onPick(v);
      }}
      onClose={onClose}
    />
  );
}
