import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Button, Chip, SegmentedControl, SwitchRow, TextField } from '@/components/ui/controls';
import { SkeletonList, useToast } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { DateTimeField, SelectField, SelectSheet, type SelectOption } from '@/components/ui/pickers';
import { Card, Divider, Text } from '@/components/ui/primitives';
import { useAccounts, useAppMutation, useCategoryIndex, useMerchants, useRecurring } from '@/hooks/data';
import { ACCOUNT_TYPE_ICONS } from '@/lib/accounts';
import { fromISODate, toISODate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { minorToInput, parseAmountInput, sanitizeAmountKeystrokes } from '@/lib/money';
import { invalidateFinancialData } from '@/lib/query';
import { describeFrequency, FREQUENCY_LABELS, nextDueDate, type Frequency } from '@/lib/recurrence';
import { createRecurring, deleteRecurring, updateRecurring } from '@/services/planning';
import { spacing } from '@/theme/tokens';
import type { RecurringItem, RecurringKind } from '@/types/domain';

type RType = 'expense' | 'income' | 'transfer';

export default function RecurringEditScreen() {
  const { id, kind } = useLocalSearchParams<{ id?: string; kind?: RecurringKind }>();
  const q = useRecurring();
  if (id && !q.data)
    return (
      <Screen>
        <SkeletonList rows={5} />
      </Screen>
    );
  return (
    <RecurringForm existing={id ? (q.data?.find((r) => r.id === id) ?? null) : null} initialKind={kind} />
  );
}

function RecurringForm({
  existing,
  initialKind,
}: {
  existing: RecurringItem | null;
  initialKind?: RecurringKind;
}) {
  const toast = useToast();
  const accounts = (useAccounts().data ?? []).filter(
    (a) => a.isActive || a.id === existing?.accountId || a.id === existing?.toAccountId,
  );
  const merchants = useMerchants().data ?? [];
  const { index } = useCategoryIndex();

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<RType>(existing?.type ?? 'expense');
  const [kind, setKind] = useState<RecurringKind>(existing?.kind ?? initialKind ?? 'bill');
  const [amount, setAmount] = useState(existing ? minorToInput(existing.amount) : '');
  const [accountId, setAccountId] = useState<string | null>(existing?.accountId ?? accounts[0]?.id ?? null);
  const [toAccountId, setToAccountId] = useState<string | null>(existing?.toAccountId ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(existing?.categoryId ?? null);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(existing?.subcategoryId ?? null);
  const [merchantId, setMerchantId] = useState<string | null>(existing?.merchantId ?? null);
  const [frequency, setFrequency] = useState<Frequency>(existing?.frequency ?? 'monthly');
  const [interval, setInterval] = useState(String(existing?.intervalCount ?? 1));
  const [start, setStart] = useState<Date>(() => (existing ? fromISODate(existing.startDate) : new Date()));
  const [hasEnd, setHasEnd] = useState(!!existing?.endDate);
  const [end, setEnd] = useState<Date>(() =>
    existing?.endDate ? fromISODate(existing.endDate) : new Date(Date.now() + 365 * 86400000),
  );
  const [autoPost, setAutoPost] = useState(existing?.autoPost ?? false);
  const [remind, setRemind] = useState(existing?.remindDaysBefore ?? 1);
  const [isActive, setActive] = useState(existing?.isActive ?? true);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [picker, setPicker] = useState<null | 'account' | 'to' | 'category' | 'merchant'>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const catKind = type === 'income' ? 'income' : 'expense';
  const categoryOptions: SelectOption[] = index
    .top(catKind)
    .flatMap((c) => [
      { value: c.id, label: c.name, icon: c.icon, color: c.color },
      ...(index.children.get(c.id) ?? [])
        .filter((s) => !s.isArchived)
        .map((s) => ({ value: s.id, label: s.name, icon: s.icon, color: s.color, depth: 1 })),
    ]);
  const accountOptions: SelectOption[] = accounts.map((a) => ({
    value: a.id,
    label: a.name,
    icon: a.icon ?? ACCOUNT_TYPE_ICONS[a.type],
    color: a.color,
  }));

  const save = useAppMutation(
    () => {
      const input = {
        name,
        type,
        kind: type === 'expense' ? kind : 'general',
        amount: parseAmountInput(amount)!,
        accountId: accountId!,
        toAccountId,
        categoryId,
        subcategoryId,
        merchantId,
        notes: notes || null,
        frequency,
        intervalCount: Math.max(1, Math.min(52, parseInt(interval, 10) || 1)),
        startDate: toISODate(start),
        endDate: hasEnd ? toISODate(end) : null,
        autoPost,
        remindDaysBefore: remind,
        isActive,
      } as const;
      return existing ? updateRecurring(existing.id, input) : createRecurring(input);
    },
    {
      invalidate: 'financial',
      success: existing ? 'Recurring item updated' : 'Recurring item added',
      onSuccess: () => router.back(),
      context: 'save-recurring',
    },
  );

  const submit = () => {
    const amt = parseAmountInput(amount);
    const next = {
      name: name.trim() ? null : 'Give it a name (e.g. Rent, Netflix, Salary).',
      amount: amt && amt > 0 ? null : 'Enter an amount.',
      account: accountId ? null : 'Choose an account.',
      category: type !== 'transfer' && !categoryId ? 'Choose a category.' : null,
      to:
        type === 'transfer' && (!toAccountId || toAccountId === accountId)
          ? 'Choose a different destination account.'
          : null,
      end: hasEnd && end < start ? 'End date must be after the start date.' : null,
    };
    setErrors(next);
    if (!Object.values(next).some(Boolean)) save.mutate(undefined);
  };

  const remove = () =>
    Alert.alert('Delete recurring item?', 'Transactions already recorded from it are kept.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteRecurring(existing!.id);
            await invalidateFinancialData();
            toast.show('Recurring item deleted');
            router.back();
          } catch (e) {
            toast.show(describeError(e).message, 'error');
          }
        },
      },
    ]);

  const preview = nextDueDate({
    startDate: toISODate(start),
    endDate: hasEnd ? toISODate(end) : null,
    frequency,
    intervalCount: Math.max(1, parseInt(interval, 10) || 1),
    lastOccurrenceDate:
      existing?.lastOccurrenceDate && existing.lastOccurrenceDate >= toISODate(start)
        ? existing.lastOccurrenceDate
        : null,
  });

  const account = accounts.find((a) => a.id === accountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const category = categoryId ? index.byId.get(categoryId) : null;
  const sub = subcategoryId ? index.byId.get(subcategoryId) : null;

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: existing ? 'Edit recurring' : 'New recurring',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Text tone="secondary">Cancel</Text>
            </Pressable>
          ),
        }}
      />
      <SegmentedControl<RType>
        value={type}
        onChange={(t) => {
          setType(t);
          setCategoryId(null);
          setSubcategoryId(null);
        }}
        options={[
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
          { value: 'transfer', label: 'Transfer' },
        ]}
      />
      {type === 'expense' ? (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
          {(['bill', 'subscription', 'general'] as RecurringKind[]).map((k) => (
            <Chip
              key={k}
              label={k === 'bill' ? 'Bill' : k === 'subscription' ? 'Subscription' : 'Other'}
              selected={kind === k}
              onPress={() => setKind(k)}
            />
          ))}
        </View>
      ) : null}

      <View style={{ gap: spacing.lg, marginTop: spacing.xl }}>
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder={
            type === 'income' ? 'e.g. Salary' : type === 'transfer' ? 'e.g. SIP' : 'e.g. Rent, Netflix'
          }
          maxLength={80}
          error={errors.name}
        />
        <TextField
          label="Amount"
          value={amount}
          onChangeText={(t) => setAmount(sanitizeAmountKeystrokes(t))}
          keyboardType="decimal-pad"
          placeholder="0"
          error={errors.amount}
          helper="For variable bills, use a typical amount — you can change it when recording each payment."
        />
        <SelectField
          label={type === 'transfer' ? 'From' : type === 'income' ? 'Into account' : 'Paid from'}
          value={account?.name ?? null}
          placeholder="Choose account"
          onPress={() => setPicker('account')}
          error={errors.account}
        />
        {type === 'transfer' ? (
          <SelectField
            label="To"
            value={toAccount?.name ?? null}
            placeholder="Choose account"
            onPress={() => setPicker('to')}
            error={errors.to}
          />
        ) : null}
        {type !== 'transfer' ? (
          <SelectField
            label="Category"
            value={category ? (sub ? `${category.name} › ${sub.name}` : category.name) : null}
            placeholder="Choose category"
            icon={category?.icon}
            color={category?.color}
            onPress={() => setPicker('category')}
            error={errors.category}
          />
        ) : null}
        {type !== 'transfer' ? (
          <SelectField
            label="Merchant (optional)"
            value={merchants.find((m) => m.id === merchantId)?.name ?? null}
            placeholder="None"
            onPress={() => setPicker('merchant')}
          />
        ) : null}
      </View>

      <Section title="Schedule" style={{ marginTop: spacing.xxl }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
          {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => (
            <Chip
              key={f}
              label={FREQUENCY_LABELS[f]}
              selected={frequency === f}
              onPress={() => setFrequency(f)}
            />
          ))}
        </View>
        <TextField
          label="Repeat every"
          value={interval}
          onChangeText={(t) => setInterval(t.replace(/\D/g, '').slice(0, 2))}
          keyboardType="number-pad"
          helper={describeFrequency(frequency, Math.max(1, parseInt(interval, 10) || 1))}
        />
        <Card style={{ marginTop: spacing.md, paddingVertical: spacing.xs }}>
          <DateTimeField label="First payment" value={start} onChange={setStart} />
          <Divider />
          <SwitchRow title="Ends on a date" value={hasEnd} onValueChange={setHasEnd} />
          {hasEnd ? (
            <DateTimeField label="Last payment" value={end} onChange={setEnd} minimumDate={start} />
          ) : null}
        </Card>
        {errors.end ? (
          <Text variant="footnote" tone="negative">
            {errors.end}
          </Text>
        ) : null}
        <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
          {preview
            ? `Next due: ${fromISODate(preview).toDateString()}`
            : 'No upcoming occurrences with these dates.'}
        </Text>
      </Section>

      <Section title="Reminders & posting">
        <Text variant="subhead" tone="secondary" style={{ marginBottom: spacing.sm }}>
          Remind me
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
          {[0, 1, 2, 3, 7].map((d) => (
            <Chip
              key={d}
              label={d === 0 ? 'On the day' : `${d} day${d > 1 ? 's' : ''} before`}
              selected={remind === d}
              onPress={() => setRemind(d)}
            />
          ))}
        </View>
        <Card style={{ paddingVertical: spacing.xs }}>
          <SwitchRow
            title="Record automatically"
            subtitle="When due, add it as a real transaction without asking. Off: you confirm each payment (recommended for bills that vary)."
            value={autoPost}
            onValueChange={setAutoPost}
          />
          <Divider />
          <SwitchRow title="Active" value={isActive} onValueChange={setActive} />
        </Card>
      </Section>

      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} maxLength={1000} multiline />

      <View style={{ gap: spacing.md, marginTop: spacing.xxl }}>
        <Button
          title={existing ? 'Save changes' : 'Add recurring item'}
          onPress={submit}
          loading={save.isPending}
        />
        {existing ? <Button title="Delete" variant="destructive" onPress={remove} /> : null}
      </View>

      <SelectSheet
        visible={picker === 'account' || picker === 'to'}
        title="Account"
        options={accountOptions}
        selected={picker === 'to' ? toAccountId : accountId}
        onClose={() => setPicker(null)}
        onSelect={(v) => (picker === 'to' ? setToAccountId(v) : setAccountId(v))}
      />
      <SelectSheet
        visible={picker === 'category'}
        title="Category"
        searchable
        options={categoryOptions}
        selected={subcategoryId ?? categoryId}
        onClose={() => setPicker(null)}
        onSelect={(v) => {
          const c = v ? index.byId.get(v) : null;
          if (!c) return;
          setCategoryId(c.parentId ?? c.id);
          setSubcategoryId(c.parentId ? c.id : null);
        }}
      />
      <SelectSheet
        visible={picker === 'merchant'}
        title="Merchant"
        searchable
        noneLabel="None"
        options={merchants.filter((m) => !m.isArchived).map((m) => ({ value: m.id, label: m.name }))}
        selected={merchantId}
        onClose={() => setPicker(null)}
        onSelect={setMerchantId}
      />
    </Screen>
  );
}
