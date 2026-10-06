/**
 * "Found in your messages" — accounts and cards your bank texts mention that
 * aren't in the app yet.
 *
 * Every waiting message is grouped by bank and last digits, so instead of
 * asking about each SMS the app asks once per account: "Axis account ending
 * 7890 — 14 transactions — add it?" One tap adds it (or links the digits to an
 * account you already have) and files all of its messages at once, oldest
 * first, with the balance starting from the bank's own latest figure.
 */
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, TextField } from '@/components/ui/controls';
import { SelectSheet } from '@/components/ui/pickers';
import { Card, Icon, Row, Text } from '@/components/ui/primitives';
import { accountOptions } from '@/features/shared/options';
import { useAccounts, useAppMutation, useDiscoveredAccounts } from '@/hooks/data';
import { formatShortDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { addAccountFromMessages } from '@/services/bank-sync';
import { useTheme } from '@/theme/ThemeProvider';
import { GUTTER, radius, spacing } from '@/theme/tokens';
import type { AccountType, DiscoveredAccount } from '@/types/domain';

const BANK_NAMES: Record<string, string> = {
  hdfc: 'HDFC Bank',
  icici: 'ICICI Bank',
  sbi: 'SBI',
  axis: 'Axis Bank',
  kotak: 'Kotak',
  idfc: 'IDFC FIRST',
  yes: 'Yes Bank',
  indusind: 'IndusInd',
  au: 'AU Bank',
  federal: 'Federal Bank',
  pnb: 'PNB',
  bob: 'Bank of Baroda',
  canara: 'Canara Bank',
  union: 'Union Bank',
  idbi: 'IDBI Bank',
  rbl: 'RBL Bank',
  sc: 'Standard Chartered',
  hsbc: 'HSBC',
  amex: 'American Express',
  onecard: 'OneCard',
  boi: 'Bank of India',
};

export const bankName = (key: string | null): string =>
  key ? (BANK_NAMES[key] ?? key.toUpperCase()) : 'Unknown bank';

const isCard = (d: DiscoveredAccount) => d.suggestedType === 'credit_card' || d.instrument !== 'account';

/** "Axis Bank account ••7890" / "ICICI Bank credit card ••4321". */
export function foundTitle(d: DiscoveredAccount): string {
  const what =
    d.suggestedType === 'credit_card'
      ? 'credit card'
      : d.instrument === 'debit_card'
        ? 'debit card'
        : d.instrument === 'wallet'
          ? 'wallet'
          : 'account';
  return `${bankName(d.bank)} ${what}${d.last4 ? ` ••${d.last4}` : ''}`;
}

/** Only groups with digits can be added as an account; the rest stay per-message. */
export function useFoundAccounts() {
  const q = useDiscoveredAccounts();
  const items = useMemo(() => (q.data ?? []).filter((d) => d.last4), [q.data]);
  return { ...q, items };
}

const TYPE_CHOICES: { type: AccountType; label: string }[] = [
  { type: 'savings', label: 'Savings' },
  { type: 'bank', label: 'Current' },
  { type: 'credit_card', label: 'Credit card' },
  { type: 'debit_card', label: 'Debit card' },
  { type: 'wallet', label: 'Wallet' },
];

/**
 * The list plus its two flows (add as new / link to one you have). Renders
 * nothing when there's nothing to add.
 */
export function FoundAccountsList({ compact = false }: { compact?: boolean }) {
  const found = useFoundAccounts();
  const accounts = useAccounts();
  const [adding, setAdding] = useState<DiscoveredAccount | null>(null);
  const [linking, setLinking] = useState<DiscoveredAccount | null>(null);

  const link = useAppMutation(
    (v: { d: DiscoveredAccount; accountId: string }) =>
      addAccountFromMessages({ bank: v.d.bank, last4: v.d.last4, linkAccountId: v.accountId }),
    {
      context: 'found.link',
      invalidate: 'financial',
      success: (r) =>
        r.messages > 0
          ? `${r.messages} transaction${r.messages === 1 ? '' : 's'} added — these digits are remembered now.`
          : 'Linked — these digits are remembered now.',
    },
  );

  const linkOptions = useMemo(() => {
    if (!linking) return [];
    const all = accounts.data ?? [];
    if (linking.suggestedType === 'credit_card') {
      const cards = accountOptions(all, (a) => a.type === 'credit_card');
      if (cards.length) return cards;
    }
    return accountOptions(all, (a) => a.type !== 'cash');
  }, [accounts.data, linking]);

  if (found.items.length === 0) return null;

  return (
    <>
      <View style={{ gap: spacing.md }}>
        {found.items.map((d) => (
          <FoundAccountCard
            key={`${d.bank ?? ''}:${d.last4}`}
            d={d}
            compact={compact}
            onAdd={() => setAdding(d)}
            onLink={() => setLinking(d)}
          />
        ))}
      </View>

      <AddFromMessagesSheet found={adding} onClose={() => setAdding(null)} />

      <SelectSheet
        visible={!!linking}
        title={linking ? `Which of yours ends in ${linking.last4}?` : ''}
        options={linkOptions}
        onSelect={(value) => {
          if (linking && value) link.mutate({ d: linking, accountId: value });
          setLinking(null);
        }}
        onClose={() => setLinking(null)}
      />
    </>
  );
}

function FoundAccountCard({
  d,
  compact,
  onAdd,
  onLink,
}: {
  d: DiscoveredAccount;
  compact: boolean;
  onAdd: () => void;
  onLink: () => void;
}) {
  const { colors } = useTheme();
  const card = isCard(d);
  const span =
    formatShortDate(new Date(d.firstAt)) === formatShortDate(new Date(d.lastAt))
      ? formatShortDate(new Date(d.lastAt))
      : `${formatShortDate(new Date(d.firstAt))} – ${formatShortDate(new Date(d.lastAt))}`;

  return (
    <Card style={{ gap: spacing.md }}>
      <Row gap={spacing.md} align="flex-start">
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            backgroundColor: colors.brandSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={card ? 'card-outline' : 'business-outline'} size={20} tone="brand" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {foundTitle(d)}
          </Text>
          <Text variant="footnote" tone="secondary" numberOfLines={1}>
            {d.messageCount} transaction{d.messageCount === 1 ? '' : 's'}, {span}
          </Text>
          {!compact && d.sampleMerchants.length > 0 ? (
            <Text variant="footnote" tone="tertiary" numberOfLines={1}>
              {d.sampleMerchants.join(', ')}
            </Text>
          ) : null}
          {d.latestBalance !== null ? (
            <Text variant="footnote" tone="secondary" style={{ marginTop: 2 }}>
              {d.balanceKind === 'limit' ? 'Available limit ' : 'Bank balance '}
              <Text variant="footnote" style={{ fontWeight: '600' }}>
                {formatMoney(d.latestBalance, 'INR')}
              </Text>
            </Text>
          ) : null}
        </View>
      </Row>
      <Row gap={spacing.sm} wrap>
        <Button title={card ? 'Add card' : 'Add account'} size="sm" icon="add" onPress={onAdd} />
        <Button title="It’s one I have" size="sm" variant="secondary" onPress={onLink} />
      </Row>
    </Card>
  );
}

/** Name it, pick the kind, done — every waiting message is filed into it. */
function AddFromMessagesSheet({ found, onClose }: { found: DiscoveredAccount | null; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('savings');
  const [seenKey, setSeenKey] = useState<string | null>(null);

  // Reset the form whenever a different account is opened.
  const key = found ? `${found.bank}:${found.last4}` : null;
  if (key !== seenKey) {
    setSeenKey(key);
    if (found) {
      setType(found.suggestedType);
      setName(defaultName(found, found.suggestedType));
    }
  }

  const add = useAppMutation(
    (v: { d: DiscoveredAccount; name: string; type: AccountType }) =>
      addAccountFromMessages({ bank: v.d.bank, last4: v.d.last4, name: v.name, type: v.type }),
    {
      context: 'found.add',
      invalidate: 'financial',
      success: (r) =>
        `Added, with ${r.messages} transaction${r.messages === 1 ? '' : 's'} from your messages.`,
      onSuccess: () => onClose(),
    },
  );

  const liability = type === 'credit_card';
  const startsFromBank = found?.latestBalance !== null && found?.balanceKind === 'balance' && !liability;

  return (
    <Modal visible={!!found} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: GUTTER,
            paddingTop: spacing.xl,
            paddingBottom: spacing.md,
          }}
        >
          <Text variant="title">{liability ? 'Add card' : 'Add account'}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Text variant="bodyStrong" tone="brand">
              Cancel
            </Text>
          </Pressable>
        </View>
        {found ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: GUTTER,
              paddingBottom: insets.bottom + spacing.xxl,
              gap: spacing.xl,
            }}
          >
            <Text variant="callout" tone="secondary">
              From your {bankName(found.bank)} messages about the {isCard(found) ? 'card' : 'account'} ending{' '}
              {found.last4}.
            </Text>

            <TextField
              label="Name"
              value={name}
              onChangeText={setName}
              maxLength={60}
              autoCapitalize="words"
              returnKeyType="done"
            />

            <View style={{ gap: spacing.sm }}>
              <Text variant="subhead" tone="secondary">
                What is it?
              </Text>
              <Row gap={spacing.sm} wrap>
                {TYPE_CHOICES.map((c) => (
                  <Chip
                    key={c.type}
                    label={c.label}
                    selected={type === c.type}
                    onPress={() => {
                      // Keep a name the user typed; refresh the suggested one.
                      if (name === defaultName(found, type)) setName(defaultName(found, c.type));
                      setType(c.type);
                    }}
                  />
                ))}
              </Row>
            </View>

            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colors.border,
                padding: spacing.lg,
                gap: spacing.sm,
              }}
            >
              <Row gap={spacing.sm}>
                <Icon name="layers-outline" size={18} tone="brand" />
                <Text variant="callout" style={{ flex: 1 }}>
                  {found.messageCount} transaction{found.messageCount === 1 ? '' : 's'} will be added to it,
                  in date order.
                </Text>
              </Row>
              <Row gap={spacing.sm}>
                <Icon name="scale-outline" size={18} tone="brand" />
                <Text variant="callout" style={{ flex: 1 }}>
                  {startsFromBank
                    ? `Its balance starts from the bank’s latest figure, ${formatMoney(found.latestBalance!, 'INR')}.`
                    : liability
                      ? 'Set what you owe and the card limit afterwards on the card’s page.'
                      : 'No balance in these messages yet — set it afterwards, or it updates from the next one that has it.'}
                </Text>
              </Row>
              <Row gap={spacing.sm}>
                <Icon name="repeat-outline" size={18} tone="brand" />
                <Text variant="callout" style={{ flex: 1 }}>
                  New messages for ••{found.last4} go straight in from now on.
                </Text>
              </Row>
            </View>

            <Button
              title={liability ? 'Add card' : 'Add account'}
              loading={add.isPending}
              disabled={!name.trim()}
              onPress={() => add.mutate({ d: found, name: name.trim(), type })}
            />
          </ScrollView>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function defaultName(d: DiscoveredAccount, type: AccountType): string {
  const bank = bankName(d.bank);
  const what =
    type === 'credit_card'
      ? 'Card'
      : type === 'debit_card'
        ? 'Debit'
        : type === 'wallet'
          ? 'Wallet'
          : type === 'bank'
            ? 'Current'
            : 'Savings';
  return `${bank} ${what} ${d.last4 ?? ''}`.trim();
}
