import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Button, Chip, SwitchRow, TextField } from '@/components/ui/controls';
import { SkeletonList, useToast } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Text } from '@/components/ui/primitives';
import { ColorPicker, CURRENCIES } from '@/features/shared/ColorPicker';
import { useAccounts, useAppMutation, useCurrency } from '@/hooks/data';
import { ACCOUNT_TYPE_ICONS, ACCOUNT_TYPE_LABELS, isLiability, supportsLast4 } from '@/lib/accounts';
import { describeError } from '@/lib/errors';
import { minorToInput, parseAmountInput, sanitizeAmountKeystrokes, type Minor } from '@/lib/money';
import {
  createAccount,
  deleteAccount,
  setAccountActive,
  updateAccount,
  type AccountInput,
} from '@/services/core';
import { spacing } from '@/theme/tokens';
import type { Account, AccountType } from '@/types/domain';

const TYPES: AccountType[] = [
  'bank',
  'savings',
  'cash',
  'credit_card',
  'debit_card',
  'wallet',
  'investment',
  'loan',
  'other_asset',
  'other_liability',
];

export default function AccountEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const accounts = useAccounts();
  const existing = id ? accounts.data?.find((a) => a.id === id) : undefined;
  if (id && !existing)
    return (
      <Screen>
        {accounts.isPending ? <SkeletonList rows={4} /> : <Text tone="secondary">Account not found.</Text>}
      </Screen>
    );
  return <AccountForm existing={existing ?? null} />;
}

function AccountForm({ existing }: { existing: Account | null }) {
  const toast = useToast();
  const defaultCurrency = useCurrency();
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<AccountType>(existing?.type ?? 'bank');
  const [institution, setInstitution] = useState(existing?.institution ?? '');
  const [last4, setLast4] = useState(existing?.last4 ?? '');
  const [currency, setCurrency] = useState(existing?.currency ?? defaultCurrency);
  const liability = isLiability(type);
  // Liabilities are entered as "amount owed" (positive) and stored as negative balances.
  const [openingText, setOpeningText] = useState(
    existing ? minorToInput(Math.abs(existing.openingBalance)) : '',
  );
  const [openingNegative, setOpeningNegative] = useState(
    existing ? existing.openingBalance < 0 && !isLiability(existing.type) : false,
  );
  const [limitText, setLimitText] = useState(
    existing?.creditLimit != null ? minorToInput(existing.creditLimit) : '',
  );
  const [includeInNetWorth, setInclude] = useState(existing?.includeInNetWorth ?? true);
  const [color, setColor] = useState<string | null>(existing?.color ?? null);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const save = useAppMutation(
    (input: AccountInput) => (existing ? updateAccount(existing.id, input) : createAccount(input)),
    {
      invalidate: 'financial',
      success: existing ? 'Account updated' : 'Account added',
      onSuccess: () => router.back(),
      context: 'save-account',
    },
  );

  const submit = () => {
    const opening = openingText ? parseAmountInput(openingText) : (0 as Minor);
    const limit = limitText ? parseAmountInput(limitText) : null;
    const next = {
      name: name.trim() ? null : 'Give the account a name.',
      last4: last4 && !/^\d{4}$/.test(last4) ? 'Enter exactly 4 digits.' : null,
      opening: opening === null ? 'Enter a valid amount.' : null,
      limit: limitText && limit === null ? 'Enter a valid amount.' : null,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean) || opening === null) return;
    const signed = (liability || openingNegative ? -opening : opening) as Minor;
    save.mutate({
      name,
      type,
      institution: institution || null,
      last4: supportsLast4(type) ? last4 || null : null,
      currency,
      openingBalance: signed,
      creditLimit: type === 'credit_card' ? limit : null,
      includeInNetWorth,
      color,
      icon: ACCOUNT_TYPE_ICONS[type],
      notes: notes || null,
    });
  };

  const archiveOrDelete = () => {
    if (!existing) return;
    Alert.alert(
      existing.isActive ? 'Archive account?' : 'Restore account?',
      existing.isActive
        ? 'Archived accounts keep their history but are hidden from pickers. You can delete an account only if it has no transactions.'
        : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        ...(existing.isActive
          ? [
              {
                text: 'Delete permanently',
                style: 'destructive' as const,
                onPress: async () => {
                  try {
                    await deleteAccount(existing.id);
                    toast.show('Account deleted');
                    router.dismissAll();
                  } catch (e) {
                    toast.show(describeError(e).message, 'error');
                  }
                },
              },
            ]
          : []),
        {
          text: existing.isActive ? 'Archive' : 'Restore',
          onPress: async () => {
            try {
              await setAccountActive(existing.id, !existing.isActive);
              toast.show(existing.isActive ? 'Account archived' : 'Account restored');
              router.back();
            } catch (e) {
              toast.show(describeError(e).message, 'error');
            }
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: existing ? 'Edit account' : 'New account',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Text tone="secondary">Cancel</Text>
            </Pressable>
          ),
        }}
      />
      <Section title="Type">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {TYPES.map((t) => (
            <Chip
              key={t}
              label={ACCOUNT_TYPE_LABELS[t]}
              icon={ACCOUNT_TYPE_ICONS[t]}
              selected={type === t}
              onPress={() => setType(t)}
            />
          ))}
        </View>
      </Section>

      <View style={{ gap: spacing.lg }}>
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. HDFC Bank"
          error={errors.name}
          maxLength={60}
        />
        <TextField
          label="Institution (optional)"
          value={institution}
          onChangeText={setInstitution}
          placeholder="e.g. HDFC Bank"
          maxLength={80}
        />
        {supportsLast4(type) ? (
          <TextField
            label="Last 4 digits (optional)"
            value={last4}
            onChangeText={(t) => setLast4(t.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            placeholder="1234"
            error={errors.last4}
            helper="Only the last four digits — never enter full card numbers, CVV, PINs or passwords."
          />
        ) : null}
        <TextField
          label={
            liability
              ? existing
                ? 'Opening amount owed'
                : 'Amount currently owed'
              : existing
                ? 'Opening balance'
                : 'Current balance'
          }
          value={openingText}
          onChangeText={(t) => setOpeningText(sanitizeAmountKeystrokes(t))}
          keyboardType="decimal-pad"
          placeholder="0"
          error={errors.opening}
          helper={
            existing
              ? 'Changing this shifts the current balance by the same difference. To match a real balance, use “Reconcile balance” on the account.'
              : undefined
          }
        />
        {!liability ? (
          <SwitchRow
            title="Balance is negative (overdrawn)"
            value={openingNegative}
            onValueChange={setOpeningNegative}
          />
        ) : null}
        {type === 'credit_card' ? (
          <TextField
            label="Credit limit (optional)"
            value={limitText}
            onChangeText={(t) => setLimitText(sanitizeAmountKeystrokes(t))}
            keyboardType="decimal-pad"
            error={errors.limit}
          />
        ) : null}
      </View>

      <Section title="Currency" style={{ marginTop: spacing.xxl }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {CURRENCIES.map((c) => (
            <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
          ))}
        </View>
        {currency !== defaultCurrency ? (
          <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
            Accounts in other currencies are tracked separately and excluded from totals in {defaultCurrency}{' '}
            (no exchange rates are assumed).
          </Text>
        ) : null}
      </Section>

      <Section title="Colour">
        <ColorPicker value={color} onChange={setColor} />
      </Section>

      <Card style={{ paddingVertical: spacing.xs, marginBottom: spacing.xxl }}>
        <SwitchRow title="Include in net worth" value={includeInNetWorth} onValueChange={setInclude} />
      </Card>

      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline maxLength={1000} />

      <View style={{ gap: spacing.md, marginTop: spacing.xxl }}>
        <Button title={existing ? 'Save changes' : 'Add account'} onPress={submit} loading={save.isPending} />
        {existing ? (
          <Button
            title={existing.isActive ? 'Archive or delete' : 'Restore account'}
            variant={existing.isActive ? 'destructive' : 'secondary'}
            onPress={archiveOrDelete}
          />
        ) : null}
      </View>
    </Screen>
  );
}
