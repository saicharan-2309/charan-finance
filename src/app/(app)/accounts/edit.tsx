/**
 * Add or edit a payment method.
 *
 * Type first, then only the fields that type actually needs: Cash asks for a
 * balance and nothing else; a credit card adds a limit, a statement day and a
 * due day; a UPI wallet adds the app it belongs to.
 *
 * Params: id (edit), type (preselect), returnTo ('expense' comes back to the
 * expense form with the new method chosen).
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { Button, Chip, SwitchRow, TextField, haptic } from '@/components/ui/controls';
import { SkeletonList, useToast } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, IconBadge, Row, Text } from '@/components/ui/primitives';
import { ColorPicker, CURRENCIES } from '@/features/shared/ColorPicker';
import { useAccounts, useAppMutation, useCurrency } from '@/hooks/data';
import { retryMessages } from '@/services/bank-sync';
import { isLiability } from '@/lib/accounts';
import { describeError } from '@/lib/errors';
import { minorToInput, parseAmountInput, sanitizeAmountKeystrokes, type Minor } from '@/lib/money';
import { fieldsFor, METHOD_CHOICES, METHOD_ICONS, providersFor, providerByKey } from '@/lib/payment-methods';
import {
  createAccount,
  deleteAccount,
  setAccountActive,
  updateAccount,
  type AccountInput,
} from '@/services/core';
import { useTheme } from '@/theme/ThemeProvider';
import { BUD_SWATCHES, radius, spacing } from '@/theme/tokens';
import type { Account, AccountType } from '@/types/domain';

export default function AccountEditScreen() {
  const params = useLocalSearchParams<{ id?: string; type?: AccountType; returnTo?: string }>();
  const accounts = useAccounts();
  const existing = params.id ? accounts.data?.find((a) => a.id === params.id) : undefined;
  if (params.id && !existing)
    return (
      <Screen>
        {accounts.isPending ? <SkeletonList rows={4} /> : <Text tone="secondary">Account not found.</Text>}
      </Screen>
    );
  return (
    <AccountForm
      existing={existing ?? null}
      initialType={params.type}
      returnTo={params.returnTo ?? null}
      hasAny={(accounts.data?.length ?? 0) > 0}
    />
  );
}

function AccountForm({
  existing,
  initialType,
  returnTo,
  hasAny,
}: {
  existing: Account | null;
  initialType?: AccountType;
  returnTo: string | null;
  hasAny: boolean;
}) {
  const toast = useToast();
  const { colors } = useTheme();
  const defaultCurrency = useCurrency();

  // On a fresh add with no type given, choose the type before anything else —
  // it decides which fields exist.
  const [type, setType] = useState<AccountType | null>(existing?.type ?? initialType ?? null);
  const [name, setName] = useState(existing?.name ?? '');
  const [provider, setProvider] = useState<string | null>(existing?.provider ?? null);
  const [institution, setInstitution] = useState(existing?.institution ?? '');
  const [last4, setLast4] = useState(existing?.last4 ?? '');
  const [currency, setCurrency] = useState(existing?.currency ?? defaultCurrency);
  const [openingText, setOpeningText] = useState(
    existing ? minorToInput(Math.abs(existing.openingBalance)) : '',
  );
  const [openingNegative, setOpeningNegative] = useState(
    existing ? existing.openingBalance < 0 && !isLiability(existing.type) : false,
  );
  const [limitText, setLimitText] = useState(
    existing?.creditLimit != null ? minorToInput(existing.creditLimit) : '',
  );
  const [statementDay, setStatementDay] = useState(
    existing?.statementDay != null ? String(existing.statementDay) : '',
  );
  const [dueDay, setDueDay] = useState(existing?.dueDay != null ? String(existing.dueDay) : '');
  const [minDueText, setMinDueText] = useState(
    existing?.minimumDue != null ? minorToInput(existing.minimumDue) : '',
  );
  const [includeInNetWorth, setInclude] = useState(existing?.includeInNetWorth ?? true);
  // New methods start with a BUD colour picked, so what you see is exactly what's saved.
  const [color, setColor] = useState<string | null>(existing?.color ?? BUD_SWATCHES[0].base);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [showMore, setShowMore] = useState(!!(existing?.notes || existing?.currency !== defaultCurrency));
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const save = useAppMutation(
    async (input: AccountInput) => {
      const account = await (existing ? updateAccount(existing.id, input) : createAccount(input));
      // New last digits may be exactly what waiting bank messages were missing.
      if (input.last4) await retryMessages().catch(() => 0);
      return account;
    },
    {
      invalidate: 'financial',
      success: existing ? 'Payment method updated' : 'Payment method added',
      onSuccess: (account) => {
        if (returnTo === 'expense' && !existing) {
          // Hand the new method straight back to the expense form.
          router.replace({
            pathname: '/transaction/new',
            params: { accountId: (account as Account).id },
          });
        } else {
          router.back();
        }
      },
      context: 'save-account',
    },
  );

  // -------------------------------------------------------------------------
  // Step 1: choose a type
  // -------------------------------------------------------------------------
  if (!type) {
    return (
      <Screen>
        <Stack.Screen
          options={{
            title: 'Add payment method',
            headerLeft: () => (
              <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
                <Text tone="secondary">Cancel</Text>
              </Pressable>
            ),
          }}
        />
        <Text variant="footnote" tone="secondary" style={{ marginBottom: spacing.lg }}>
          {hasAny
            ? 'What kind of account or payment method is this?'
            : 'Start with wherever your money actually sits — a bank account, cash, or a card. You can add more at any time.'}
        </Text>
        <Card padded={false} style={{ paddingVertical: spacing.xs }}>
          {METHOD_CHOICES.map((c, i) => (
            <View key={c.type}>
              {i > 0 ? <Divider inset={68} /> : null}
              <Pressable
                onPress={() => {
                  haptic.selection();
                  setType(c.type);
                }}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
                  paddingHorizontal: spacing.lg,
                })}
              >
                <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                  <IconBadge icon={c.icon} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{c.label}</Text>
                    <Text variant="footnote" tone="secondary">
                      {c.hint}
                    </Text>
                  </View>
                </Row>
              </Pressable>
            </View>
          ))}
        </Card>
      </Screen>
    );
  }

  // -------------------------------------------------------------------------
  // Step 2: the fields this type needs
  // -------------------------------------------------------------------------
  const fields = fieldsFor(type);
  const liability = isLiability(type);
  const providers = fields.provider ? providersFor(type) : [];
  const chosenProvider = providerByKey(provider);
  const choice = METHOD_CHOICES.find((c) => c.type === type);

  const dayValue = (text: string) => {
    if (!text) return null;
    const n = parseInt(text, 10);
    return Number.isFinite(n) && n >= 1 && n <= 31 ? n : NaN;
  };

  const submit = () => {
    const opening = openingText ? parseAmountInput(openingText) : (0 as Minor);
    const limit = limitText ? parseAmountInput(limitText) : null;
    const minDue = minDueText ? parseAmountInput(minDueText) : null;
    const stmt = dayValue(statementDay);
    const due = dayValue(dueDay);
    const next = {
      name: name.trim() ? null : 'Give it a name.',
      last4: last4 && !/^\d{4}$/.test(last4) ? 'Enter exactly 4 digits.' : null,
      opening: opening === null ? 'Enter a valid amount.' : null,
      limit:
        limitText && limit === null
          ? 'Enter a valid amount.'
          : type === 'credit_card' && !existing && !limitText
            ? 'Enter the card’s credit limit.'
            : null,
      minDue: minDueText && minDue === null ? 'Enter a valid amount.' : null,
      statementDay: Number.isNaN(stmt) ? 'Enter a day between 1 and 31.' : null,
      dueDay: Number.isNaN(due) ? 'Enter a day between 1 and 31.' : null,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean) || opening === null) {
      haptic.error();
      return;
    }
    const signed = (liability || openingNegative ? -opening : opening) as Minor;
    save.mutate({
      name,
      type,
      institution: fields.institution ? institution || chosenProvider?.institution || null : null,
      last4: fields.last4 ? last4 || null : null,
      currency,
      openingBalance: signed,
      creditLimit: fields.creditLimit ? limit : null,
      includeInNetWorth,
      color,
      // The type's glyph, except for a UPI wallet where the app is the identity.
      icon: type === 'wallet' ? (chosenProvider?.icon ?? METHOD_ICONS[type]) : METHOD_ICONS[type],
      notes: notes || null,
      provider: fields.provider ? provider : null,
      statementDay: fields.billingDates ? (stmt as number | null) : null,
      dueDay: fields.billingDates ? (due as number | null) : null,
      minimumDue: fields.billingDates ? minDue : null,
    });
  };

  const archiveOrDelete = () => {
    if (!existing) return;
    Alert.alert(
      existing.isActive ? 'Archive payment method?' : 'Restore payment method?',
      existing.isActive
        ? 'Archived methods keep their history but no longer appear when adding a transaction. Deleting is only possible when nothing has been recorded against it.'
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
                    toast.show('Payment method deleted');
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
              toast.show(existing.isActive ? 'Archived' : 'Restored');
              router.back();
            } catch (e) {
              toast.show(describeError(e).message, 'error');
            }
          },
        },
      ],
    );
  };

  const balanceLabel = liability
    ? existing
      ? 'Opening amount owed'
      : 'Amount currently owed'
    : existing
      ? 'Opening balance'
      : 'Current balance';

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: existing ? 'Edit payment method' : (choice?.label ?? 'New payment method'),
          headerLeft: () => (
            <Pressable
              onPress={() => (existing || initialType ? router.back() : setType(null))}
              hitSlop={10}
              accessibilityRole="button"
            >
              <Text tone="secondary">{existing || initialType ? 'Cancel' : 'Back'}</Text>
            </Pressable>
          ),
        }}
      />

      {/* Type, changeable without leaving the form */}
      <Section title="Type">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -20 }}
          contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: 20 }}
        >
          {METHOD_CHOICES.map((c) => (
            <Chip
              key={c.type}
              label={c.label}
              icon={c.icon}
              selected={type === c.type}
              onPress={() => setType(c.type)}
            />
          ))}
        </ScrollView>
      </Section>

      {providers.length ? (
        <Section title={type === 'wallet' ? 'App' : 'Bank or issuer'}>
          <Row gap={spacing.sm} wrap>
            {providers.map((p) => (
              <Chip
                key={p.key}
                label={p.label}
                icon={p.icon}
                color={p.color}
                selected={provider === p.key}
                onPress={() => {
                  const next = provider === p.key ? null : p.key;
                  setProvider(next);
                  if (next && !name.trim()) {
                    setName(
                      type === 'wallet'
                        ? p.label
                        : type === 'credit_card'
                          ? `${p.label} Credit Card`
                          : type === 'debit_card'
                            ? `${p.label} Debit Card`
                            : `${p.label} Savings`,
                    );
                  }
                }}
              />
            ))}
          </Row>
        </Section>
      ) : null}

      <View style={{ gap: spacing.lg }}>
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder={
            type === 'cash'
              ? 'e.g. Cash'
              : type === 'wallet'
                ? 'e.g. Google Pay'
                : type === 'credit_card'
                  ? 'e.g. HDFC Credit Card'
                  : 'e.g. HDFC Savings'
          }
          error={errors.name}
          maxLength={60}
        />
        {fields.institution ? (
          <TextField
            label="Institution (optional)"
            value={institution}
            onChangeText={setInstitution}
            placeholder={chosenProvider?.institution ?? 'e.g. HDFC Bank'}
            maxLength={80}
          />
        ) : null}
        {fields.last4 ? (
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
          label={balanceLabel}
          value={openingText}
          onChangeText={(t) => setOpeningText(sanitizeAmountKeystrokes(t))}
          keyboardType="decimal-pad"
          placeholder="0"
          error={errors.opening}
          helper={
            existing
              ? 'Changing this shifts the current balance by the same difference. To match a real balance, use “Reconcile” on the account.'
              : type === 'credit_card'
                ? 'What you owe on the card right now — not your limit. Leave empty if nothing is owed.'
                : 'What’s in it today. From here BUD keeps the balance up to date: money in adds, spending takes away — you never edit this again.'
          }
        />
        {!liability ? (
          <SwitchRow
            title="Balance is negative (overdrawn)"
            value={openingNegative}
            onValueChange={setOpeningNegative}
          />
        ) : null}
      </View>

      {/* Credit-card specifics */}
      {fields.creditLimit || fields.billingDates ? (
        <Section title="Card details" style={{ marginTop: spacing.xxl }}>
          <View style={{ gap: spacing.lg }}>
            <TextField
              label={type === 'credit_card' ? 'Credit limit' : 'Credit limit (optional)'}
              value={limitText}
              onChangeText={(t) => setLimitText(sanitizeAmountKeystrokes(t))}
              keyboardType="decimal-pad"
              placeholder="0"
              error={errors.limit}
              helper="Your limit is never counted as cash. Available credit = limit − what you owe, worked out every time."
            />
            <Row gap={spacing.md} align="flex-start">
              <View style={{ flex: 1 }}>
                <TextField
                  label="Statement day"
                  value={statementDay}
                  onChangeText={(t) => setStatementDay(t.replace(/\D/g, '').slice(0, 2))}
                  keyboardType="number-pad"
                  placeholder="28"
                  error={errors.statementDay}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label="Payment due day"
                  value={dueDay}
                  onChangeText={(t) => setDueDay(t.replace(/\D/g, '').slice(0, 2))}
                  keyboardType="number-pad"
                  placeholder="12"
                  error={errors.dueDay}
                />
              </View>
            </Row>
            <Text variant="footnote" tone="secondary">
              Day of the month. A day later than a short month has is moved to that month’s last day.
            </Text>
            <TextField
              label="Minimum due (optional)"
              value={minDueText}
              onChangeText={(t) => setMinDueText(sanitizeAmountKeystrokes(t))}
              keyboardType="decimal-pad"
              placeholder="0"
              error={errors.minDue}
            />
          </View>
        </Section>
      ) : null}

      <Section title="Colour">
        <ColorPicker value={color} onChange={setColor} previewLabel={name || undefined} preview="card" />
      </Section>

      {showMore ? (
        <>
          <Section title="Currency">
            <Row gap={spacing.sm} wrap>
              {CURRENCIES.map((c) => (
                <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
              ))}
            </Row>
            {currency !== defaultCurrency ? (
              <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
                Accounts in other currencies are tracked separately and excluded from totals in{' '}
                {defaultCurrency} (no exchange rates are assumed).
              </Text>
            ) : null}
          </Section>
          <Card padded={false} style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.lg }}>
            <SwitchRow title="Include in net worth" value={includeInNetWorth} onValueChange={setInclude} />
          </Card>
          <TextField
            label="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            multiline
            maxLength={1000}
          />
        </>
      ) : (
        <Pressable
          onPress={() => setShowMore(true)}
          accessibilityRole="button"
          style={{
            alignSelf: 'flex-start',
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            borderRadius: radius.pill,
            marginBottom: spacing.lg,
          }}
        >
          <Text variant="subhead" tone="brand">
            + Currency, net worth & notes
          </Text>
        </Pressable>
      )}

      <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
        <Button
          title={existing ? 'Save changes' : 'Add payment method'}
          onPress={submit}
          loading={save.isPending}
        />
        {existing ? (
          <Button
            title={existing.isActive ? 'Archive or delete' : 'Restore'}
            variant={existing.isActive ? 'destructive' : 'secondary'}
            onPress={archiveOrDelete}
          />
        ) : null}
      </View>
    </Screen>
  );
}
