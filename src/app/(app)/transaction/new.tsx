/**
 * Add / edit / duplicate a transaction.
 *
 * Built for speed: the amount field is focused immediately, recent categories,
 * merchants and accounts are one tap away, the last-used account is
 * preselected, and picking a known merchant fills in its usual category.
 * Typical expense: amount → category → (merchant) → Save.
 *
 * Params: type, id (edit), duplicate (source id), amount, date, merchant,
 *         categoryId, attachmentId (from receipt scan — user confirms here).
 */
import { randomUUID } from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Chip, haptic, SegmentedControl, TextField } from '@/components/ui/controls';
import { SkeletonList, useToast } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { DateTimeField, SelectField, SelectSheet, type SelectOption } from '@/components/ui/pickers';
import { Card, Divider, Icon, IconBadge, Text } from '@/components/ui/primitives';
import { pickReceipt } from '@/features/receipts/pickReceipt';
import {
  useAccounts,
  useCategoryIndex,
  useCurrency,
  useMerchants,
  useRecentUsage,
  useTransaction,
} from '@/hooks/data';
import { accountVisual, balanceDisplay, canSpendFrom, cardStanding } from '@/lib/payment-methods';
import { combineDateTime, isISODate } from '@/lib/dates';
import { describeError, logError } from '@/lib/errors';
import {
  currencySymbol,
  formatMoney,
  minorToInput,
  parseAmountInput,
  sanitizeAmountKeystrokes,
} from '@/lib/money';
import { submitTransaction } from '@/lib/offline-queue';
import { invalidateFinancialData } from '@/lib/query';
import { linkAttachment, prepareReceipt, uploadReceipt, type LocalFile } from '@/services/attachments';
import type { SaveTransactionInput } from '@/services/transactions';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, typography } from '@/theme/tokens';
import type { Transaction } from '@/types/domain';

type FormType = 'expense' | 'income' | 'transfer';

type Params = {
  type?: FormType;
  id?: string;
  duplicate?: string;
  amount?: string;
  date?: string;
  merchant?: string;
  categoryId?: string;
  attachmentId?: string;
  accountId?: string;
  toAccountId?: string;
};

export default function TransactionFormScreen() {
  const params = useLocalSearchParams<Params>();
  const editId = params.id;
  const sourceId = editId ?? params.duplicate;
  const source = useTransaction(sourceId);

  if (sourceId && !source.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: editId ? 'Edit transaction' : 'Duplicate' }} />
        {source.error ? (
          <Text tone="negative">{describeError(source.error).message}</Text>
        ) : (
          <SkeletonList rows={4} />
        )}
      </Screen>
    );
  }
  return <TransactionForm params={params} source={source.data ?? null} mode={editId ? 'update' : 'create'} />;
}

function TransactionForm({
  params,
  source,
  mode,
}: {
  params: Params;
  source: Transaction | null;
  mode: 'create' | 'update';
}) {
  const { colors } = useTheme();
  const toast = useToast();
  const currency = useCurrency();
  const accountsQ = useAccounts();
  const { index: cats } = useCategoryIndex();
  const merchantsQ = useMerchants();

  const initialType: FormType =
    (source?.type === 'adjustment' ? 'expense' : (source?.type as FormType | undefined)) ??
    params.type ??
    'expense';
  const [type, setType] = useState<FormType>(initialType);
  const usage = useRecentUsage(type === 'income' ? 'income' : 'expense');

  const [amountText, setAmountText] = useState(
    source ? minorToInput(source.amount) : params.amount ? sanitizeAmountKeystrokes(params.amount) : '',
  );
  const [categoryId, setCategoryId] = useState<string | null>(
    source?.categoryId ?? params.categoryId ?? null,
  );
  const [subcategoryId, setSubcategoryId] = useState<string | null>(source?.subcategoryId ?? null);
  const [merchantName, setMerchantName] = useState(source?.merchantName ?? params.merchant ?? '');
  const [merchantId, setMerchantId] = useState<string | null>(source?.merchantId ?? null);
  const [chosenAccountId, setChosenAccountId] = useState<string | null>(
    source?.accountId ?? params.accountId ?? null,
  );
  const [toAccountId, setToAccountId] = useState<string | null>(
    source?.toAccountId ?? params.toAccountId ?? null,
  );
  const [date, setDate] = useState<Date>(() => {
    if (mode === 'update' && source) return new Date(source.occurredAt);
    if (params.date && isISODate(params.date)) return combineDateTime(params.date, '12:00');
    return new Date();
  });
  const [notes, setNotes] = useState(source?.notes ?? '');
  const [tagsText, setTagsText] = useState(source?.tagNames.join(', ') ?? '');
  const [receipt, setReceipt] = useState<LocalFile | null>(null);
  const [showMore, setShowMore] = useState(!!(source?.notes || source?.tagNames.length));
  const [picker, setPicker] = useState<null | 'category' | 'account' | 'toAccount'>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<TextInput>(null);
  const [maxDate] = useState(() => new Date(Date.now() + 366 * 86400000));

  const accounts = (accountsQ.data ?? []).filter(
    (a) => a.isActive || a.id === chosenAccountId || a.id === toAccountId,
  );

  // Smart default: last-used (or first active) account until the user picks one.
  const lastUsed = usage.data?.lastAccountId;
  const defaultAccountId =
    lastUsed && accounts.some((a) => a.id === lastUsed && a.isActive)
      ? lastUsed
      : (accounts.find(canSpendFrom)?.id ?? accounts.find((a) => a.isActive)?.id ?? null);
  const accountId = chosenAccountId ?? defaultAccountId;
  const setAccountId = setChosenAccountId;

  // Reset category when switching between expense and income.
  const switchType = (t: FormType) => {
    setType(t);
    if (t === 'transfer') return;
    const cat = categoryId ? cats.byId.get(categoryId) : null;
    if (cat && cat.kind !== t) {
      setCategoryId(null);
      setSubcategoryId(null);
    }
  };

  const kind = type === 'income' ? 'income' : 'expense';
  const topCategories = cats.top(kind);
  const recentCats = (usage.data?.categoryIds ?? [])
    .map((id) => cats.byId.get(id))
    .filter(
      (c): c is NonNullable<typeof c> => !!c && !c.isArchived && c.kind === kind && c.parentId === null,
    );
  const quickCats = [
    ...recentCats,
    ...topCategories.filter((c) => !recentCats.some((r) => r.id === c.id)),
  ].slice(0, 8);
  const subcats = categoryId ? (cats.children.get(categoryId) ?? []).filter((c) => !c.isArchived) : [];
  const selectedCategory = categoryId ? cats.byId.get(categoryId) : null;

  const merchants = (merchantsQ.data ?? []).filter((m) => !m.isArchived);
  const merchantSuggestions = useMemo(() => {
    const q = merchantName.trim().toLowerCase();
    if (q)
      return merchants
        .filter((m) => m.name.toLowerCase().includes(q) && m.name.toLowerCase() !== q)
        .slice(0, 6);
    const recentIds = usage.data?.merchantIds ?? [];
    return recentIds
      .map((id) => merchants.find((m) => m.id === id))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .slice(0, 6);
  }, [merchantName, merchants, usage.data?.merchantIds]);

  const chooseMerchant = (id: string, name: string) => {
    haptic.selection();
    setMerchantId(id);
    setMerchantName(name);
    if (!categoryId) {
      const learned =
        usage.data?.merchantCategory[id] ?? merchants.find((m) => m.id === id)?.defaultCategoryId;
      const cat = learned ? cats.byId.get(learned) : null;
      if (cat && cat.kind === kind && !cat.isArchived) setCategoryId(cat.id);
    }
  };

  const orderedAccounts = useMemo(() => {
    const recent = usage.data?.accountIds ?? [];
    const active = accounts.filter((a) => a.isActive);
    return [
      ...recent.map((id) => active.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a),
      ...active.filter((a) => !recent.includes(a.id)),
    ];
  }, [accounts, usage.data?.accountIds]);

  // Each method shows what it holds (or, for a card, what is used and what is
  // left) so the choice can be made without leaving the form.
  const accountOptions: SelectOption[] = orderedAccounts.map((a) => {
    const visual = accountVisual(a);
    const display = balanceDisplay(a);
    const card = a.type === 'credit_card' ? cardStanding(a) : null;
    const money = `${formatMoney(display.amount, a.currency, { decimals: 'never' })}${
      display.caption ? ` ${display.caption}` : ''
    }`;
    return {
      value: a.id,
      label: a.name,
      subtitle: [
        money,
        card?.available != null
          ? `${formatMoney(card.available, a.currency, { decimals: 'never' })} available`
          : null,
        a.last4 ? `•••• ${a.last4}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      icon: visual.icon,
      color: visual.color,
    };
  });

  const categoryOptions: SelectOption[] = topCategories.flatMap((c) => [
    { value: c.id, label: c.name, icon: c.icon, color: c.color },
    ...(cats.children.get(c.id) ?? [])
      .filter((s) => !s.isArchived)
      .map((s) => ({ value: s.id, label: s.name, icon: s.icon, color: s.color, depth: 1 })),
  ]);

  const amount = parseAmountInput(amountText);
  const account = accounts.find((a) => a.id === accountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const displayCurrency = account?.currency ?? currency;

  const validate = () => {
    const next: Record<string, string | null> = {
      amount: amount && amount > 0 ? null : 'Enter an amount greater than zero.',
      account: accountId ? null : 'Choose an account.',
      category: type !== 'transfer' && !categoryId ? 'Choose a category.' : null,
      toAccount:
        type === 'transfer'
          ? !toAccountId
            ? 'Choose where the money goes.'
            : toAccountId === accountId
              ? 'Choose a different account.'
              : null
          : null,
    };
    setErrors(next);
    return !Object.values(next).some(Boolean);
  };

  const save = async () => {
    if (saving) return;
    if (!validate() || !amount || !accountId) {
      haptic.error();
      return;
    }
    setSaving(true);
    const id = mode === 'update' && source ? source.id : randomUUID();
    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10);
    const input: SaveTransactionInput = {
      mode,
      id,
      type,
      amount,
      accountId,
      occurredAt: date.toISOString(),
      toAccountId: type === 'transfer' ? toAccountId : null,
      categoryId: type === 'transfer' ? null : categoryId,
      subcategoryId: type === 'transfer' ? null : subcategoryId,
      merchantId: type === 'transfer' ? null : merchantId,
      merchantName: type === 'transfer' ? null : merchantName.trim() || null,
      notes: notes.trim() || null,
      tags: mode === 'update' || tags.length ? tags : null,
      expectedUpdatedAt: mode === 'update' ? (source?.updatedAt ?? null) : null,
    };
    const title =
      type === 'transfer'
        ? `${account?.name ?? ''} → ${toAccount?.name ?? ''}`
        : merchantName.trim() || selectedCategory?.name || 'Transaction';

    try {
      const result = await submitTransaction(input, {
        type,
        amount,
        currency: displayCurrency,
        title,
        subtitle: [selectedCategory?.name, account?.name].filter(Boolean).join(' · '),
        occurredAt: input.occurredAt,
      });
      haptic.success();
      if (result.status === 'saved') {
        // Attach receipts only once the transaction exists on the server.
        try {
          if (params.attachmentId) await linkAttachment(params.attachmentId, id);
          if (receipt) await uploadReceipt(await prepareReceipt(receipt), id);
        } catch (e) {
          logError('receipt', e);
          toast.show(
            'Saved, but the receipt could not be attached. Try again from the transaction.',
            'error',
          );
        }
        await invalidateFinancialData();
        toast.show(
          mode === 'update'
            ? 'Changes saved'
            : `${type === 'income' ? 'Income' : type === 'transfer' ? 'Transfer' : 'Expense'} saved`,
        );
      } else {
        toast.show(
          receipt
            ? "Saved offline. It will sync when you're online — attach the receipt then."
            : "Saved offline. It will sync when you're back online.",
          'info',
        );
      }
      router.back();
    } catch (e) {
      haptic.error();
      logError('save-transaction', e);
      toast.show(describeError(e).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const title =
    mode === 'update'
      ? 'Edit transaction'
      : params.duplicate
        ? 'Duplicate'
        : type === 'income'
          ? 'Add income'
          : type === 'transfer'
            ? 'Transfer'
            : 'Add expense';

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
              <Text variant="body" tone="secondary">
                Cancel
              </Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={save} hitSlop={12} accessibilityRole="button" disabled={saving}>
              <Text variant="bodyStrong" tone="brand" style={{ opacity: saving ? 0.4 : 1 }}>
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          ),
        }}
      />
      <Screen>
        <SegmentedControl<FormType>
          value={type}
          onChange={switchType}
          options={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
            { value: 'transfer', label: 'Transfer' },
          ]}
        />

        {/* Amount */}
        <Pressable
          onPress={() => amountRef.current?.focus()}
          style={{ alignItems: 'center', paddingVertical: spacing.xxl }}
          accessible={false}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text
              style={[
                typography.display,
                { color: amountText ? colors.text : colors.textTertiary, marginRight: 4 },
              ]}
            >
              {currencySymbol(displayCurrency).trim()}
            </Text>
            <TextInput
              ref={amountRef}
              value={amountText}
              onChangeText={(t) => {
                setAmountText(sanitizeAmountKeystrokes(t));
                if (errors.amount) setErrors((e) => ({ ...e, amount: null }));
              }}
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
              keyboardType="decimal-pad"
              autoFocus={mode === 'create' && !params.amount}
              accessibilityLabel="Amount"
              maxLength={16}
              style={[typography.display, { color: colors.text, minWidth: 60, padding: 0 }]}
              selectionColor={colors.brand}
            />
          </View>
          {errors.amount ? (
            <Text variant="footnote" tone="negative" style={{ marginTop: spacing.sm }}>
              {errors.amount}
            </Text>
          ) : null}
        </Pressable>

        {type !== 'transfer' ? (
          <>
            {/* Category quick picks */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: spacing.sm,
              }}
            >
              <Text variant="subhead" tone="secondary">
                Category
              </Text>
              <Pressable onPress={() => setPicker('category')} hitSlop={10} accessibilityRole="button">
                <Text variant="subhead" tone="brand">
                  All categories
                </Text>
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.xs }}
              keyboardShouldPersistTaps="handled"
            >
              {selectedCategory && !quickCats.some((c) => c.id === selectedCategory.id) ? (
                <Chip
                  label={selectedCategory.name}
                  icon={selectedCategory.icon}
                  color={selectedCategory.color}
                  selected
                  onPress={() => setPicker('category')}
                />
              ) : null}
              {quickCats.map((c) => (
                <Chip
                  key={c.id}
                  label={c.name}
                  icon={c.icon}
                  color={c.color}
                  selected={c.id === categoryId}
                  onPress={() => {
                    setCategoryId(c.id === categoryId ? null : c.id);
                    setSubcategoryId(null);
                    setErrors((e) => ({ ...e, category: null }));
                  }}
                />
              ))}
            </ScrollView>
            {subcats.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.sm, paddingTop: spacing.sm }}
                keyboardShouldPersistTaps="handled"
              >
                {subcats.map((s) => (
                  <Chip
                    key={s.id}
                    label={s.name}
                    selected={s.id === subcategoryId}
                    onPress={() => setSubcategoryId(s.id === subcategoryId ? null : s.id)}
                  />
                ))}
              </ScrollView>
            ) : null}
            {errors.category ? (
              <Text variant="footnote" tone="negative" style={{ marginTop: spacing.xs }}>
                {errors.category}
              </Text>
            ) : null}

            {/* Merchant */}
            <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
              <TextField
                label={type === 'income' ? 'Payer (optional)' : 'Merchant'}
                value={merchantName}
                onChangeText={(t) => {
                  setMerchantName(t);
                  const exact = merchants.find((m) => m.name.toLowerCase() === t.trim().toLowerCase());
                  setMerchantId(exact?.id ?? null);
                }}
                placeholder={type === 'income' ? 'e.g. Employer' : 'e.g. Swiggy, Amazon'}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                maxLength={80}
                leading={<Icon name="storefront-outline" size={18} tone="tertiary" />}
              />
              {merchantSuggestions.length ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: spacing.sm }}
                  keyboardShouldPersistTaps="handled"
                >
                  {merchantSuggestions.map((m) => (
                    <Chip
                      key={m.id}
                      label={m.name}
                      selected={m.id === merchantId}
                      onPress={() => chooseMerchant(m.id, m.name)}
                    />
                  ))}
                </ScrollView>
              ) : null}
            </View>
          </>
        ) : null}

        {/* Accounts */}
        <View style={{ marginTop: spacing.xl, gap: spacing.lg }}>
          <SelectField
            label={type === 'transfer' ? 'From' : type === 'income' ? 'Received in' : 'Payment method'}
            value={account ? account.name : null}
            placeholder={accounts.length ? 'Choose payment method' : 'Add a payment method first'}
            icon={account ? accountVisual(account).icon : undefined}
            color={account ? accountVisual(account).color : undefined}
            onPress={() =>
              accounts.length
                ? setPicker('account')
                : router.push({ pathname: '/accounts/edit', params: { returnTo: 'expense' } })
            }
            error={errors.account}
          />
          {account ? (
            <Text variant="caption" tone="tertiary" style={{ marginTop: -spacing.sm }}>
              {type === 'expense'
                ? 'How it was paid. The category above says what it was for.'
                : type === 'income'
                  ? 'Where the money landed.'
                  : ''}
            </Text>
          ) : null}
          {type === 'transfer' ? (
            <SelectField
              label="To"
              value={toAccount ? toAccount.name : null}
              placeholder="Choose account"
              icon={toAccount ? accountVisual(toAccount).icon : undefined}
              color={toAccount ? accountVisual(toAccount).color : undefined}
              onPress={() => setPicker('toAccount')}
              error={errors.toAccount}
            />
          ) : null}
          {type === 'transfer' && toAccount?.type === 'credit_card' ? (
            <Text variant="footnote" tone="secondary" style={{ marginTop: -spacing.sm }}>
              This is a credit card payment. It reduces what you owe and is not counted as spending.
            </Text>
          ) : null}
        </View>

        <Card style={{ marginTop: spacing.xl, paddingVertical: spacing.xs }}>
          <DateTimeField
            label="Date"
            value={date}
            onChange={(d) => setDate((prev) => mergeDate(prev, d))}
            maximumDate={maxDate}
          />
          <Divider />
          <DateTimeField
            label="Time"
            mode="time"
            value={date}
            onChange={(d) => setDate((prev) => mergeTime(prev, d))}
          />
        </Card>

        {/* More options */}
        {showMore ? (
          <View style={{ marginTop: spacing.xl, gap: spacing.lg }}>
            <TextField
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional"
              multiline
              maxLength={2000}
              style={{ minHeight: 60 }}
            />
            <TextField
              label="Tags"
              value={tagsText}
              onChangeText={setTagsText}
              placeholder="e.g. work, trip-goa"
              autoCapitalize="none"
              helper="Separate tags with commas."
            />
          </View>
        ) : (
          <Pressable
            onPress={() => setShowMore(true)}
            style={{ marginTop: spacing.lg, alignSelf: 'flex-start', paddingVertical: spacing.sm }}
            accessibilityRole="button"
          >
            <Text variant="subhead" tone="brand">
              + Notes & tags
            </Text>
          </Pressable>
        )}

        {mode === 'create' && type !== 'transfer' && !params.attachmentId ? (
          <Pressable
            onPress={async () => setReceipt((await pickReceipt()) ?? receipt)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              marginTop: spacing.xl,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              padding: spacing.lg,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: receipt ? colors.positive : colors.borderStrong,
              backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
            })}
          >
            <IconBadge
              icon={receipt ? 'checkmark-circle' : 'receipt-outline'}
              color={receipt ? colors.positive : colors.textSecondary}
              size={36}
            />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{receipt ? 'Receipt attached' : 'Attach receipt'}</Text>
              <Text variant="footnote" tone="secondary">
                {receipt ? 'Tap to replace' : 'Photo or PDF, up to 10 MB'}
              </Text>
            </View>
          </Pressable>
        ) : null}
        {params.attachmentId ? (
          <View
            style={{ marginTop: spacing.xl, flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}
          >
            <Icon name="receipt" size={18} tone="positive" />
            <Text variant="footnote" tone="secondary">
              Scanned receipt will be attached. Check the details above before saving.
            </Text>
          </View>
        ) : null}

        <View style={{ height: spacing.xxl }} />
      </Screen>

      <SelectSheet
        visible={picker === 'category'}
        title="Category"
        options={categoryOptions}
        selected={subcategoryId ?? categoryId}
        searchable
        onClose={() => setPicker(null)}
        onSelect={(v) => {
          const c = v ? cats.byId.get(v) : null;
          if (!c) return;
          if (c.parentId) {
            setCategoryId(c.parentId);
            setSubcategoryId(c.id);
          } else {
            setCategoryId(c.id);
            setSubcategoryId(null);
          }
          setErrors((e) => ({ ...e, category: null }));
        }}
      />
      <SelectSheet
        visible={picker === 'account' || picker === 'toAccount'}
        title={picker === 'toAccount' ? 'To account' : type === 'expense' ? 'Payment method' : 'Account'}
        options={accountOptions}
        selected={picker === 'toAccount' ? toAccountId : accountId}
        searchable={accountOptions.length > 8}
        addAction={{
          label: 'Add new payment method',
          onPress: () => router.push({ pathname: '/accounts/edit', params: { returnTo: 'expense' } }),
        }}
        onClose={() => setPicker(null)}
        onSelect={(v) => {
          if (picker === 'toAccount') setToAccountId(v);
          else setAccountId(v);
          setErrors((e) => ({ ...e, account: null, toAccount: null }));
        }}
      />
    </>
  );
}

function mergeDate(prev: Date, picked: Date): Date {
  const d = new Date(prev);
  d.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
  return d;
}

function mergeTime(prev: Date, picked: Date): Date {
  const d = new Date(prev);
  d.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
  return d;
}
