/**
 * Add or edit an EMI / loan.
 *
 * The payment method is a free choice: bank account, credit card, debit card,
 * UPI wallet or cash. Saving writes the agreement plus a monthly schedule, so
 * the EMI shows up in Upcoming, the calendar and reminders like any other
 * commitment, and instalments are recorded against the chosen method.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Button, Chip, SwitchRow, TextField, haptic } from '@/components/ui/controls';
import { SkeletonList, useToast } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { DateTimeField, SelectField, SelectSheet, type SelectOption } from '@/components/ui/pickers';
import { Card, Divider, Row, Text } from '@/components/ui/primitives';
import { useAccounts, useAppMutation, useCategoryIndex, useCurrency, useLoans } from '@/hooks/data';
import { fromISODate, toISODate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatMoney, minorToInput, parseAmountInput, sanitizeAmountKeystrokes } from '@/lib/money';
import { accountVisual, balanceDisplay, canSpendFrom } from '@/lib/payment-methods';
import { invalidateFinancialData } from '@/lib/query';
import { createLoan, deleteLoan, updateLoan, type LoanInput } from '@/services/loans';
import { spacing } from '@/theme/tokens';
import type { Loan } from '@/types/domain';

export default function LoanEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const q = useLoans();
  if (id && !q.data)
    return (
      <Screen>
        <SkeletonList rows={5} />
      </Screen>
    );
  return <LoanForm existing={id ? (q.data?.find((l) => l.id === id) ?? null) : null} />;
}

function LoanForm({ existing }: { existing: Loan | null }) {
  const toast = useToast();
  const defaultCurrency = useCurrency();
  const allAccounts = useAccounts().data ?? [];
  const accounts = allAccounts.filter((a) => canSpendFrom(a) || a.id === existing?.accountId);
  const { index } = useCategoryIndex();

  const [name, setName] = useState(existing?.name ?? '');
  const [lender, setLender] = useState(existing?.lender ?? '');
  const [principal, setPrincipal] = useState(existing ? minorToInput(existing.principalAmount) : '');
  const [emi, setEmi] = useState(existing ? minorToInput(existing.emiAmount) : '');
  const [rate, setRate] = useState(existing?.interestRate != null ? String(existing.interestRate) : '');
  const [tenure, setTenure] = useState(existing?.tenureMonths != null ? String(existing.tenureMonths) : '');
  const [accountId, setAccountId] = useState<string | null>(
    existing?.accountId ?? accounts.find(canSpendFrom)?.id ?? null,
  );
  const [categoryId, setCategoryId] = useState<string | null>(
    existing?.categoryId ?? defaultEmiCategory(index) ?? null,
  );
  const [start, setStart] = useState<Date>(() => (existing ? fromISODate(existing.startDate) : new Date()));
  const [nextPayment, setNextPayment] = useState<Date>(() =>
    existing?.nextPaymentDate ? fromISODate(existing.nextPaymentDate) : new Date(),
  );
  const [autoPost, setAutoPost] = useState(existing?.autoPost ?? false);
  // Reminder lead time for the instalment, in days.
  const [remind, setRemind] = useState(3);
  const REMIND_CHOICES = [0, 1, 3, 7];
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [picker, setPicker] = useState<null | 'account' | 'category'>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const account = accounts.find((a) => a.id === accountId);
  const category = categoryId ? index.byId.get(categoryId) : null;
  const currency = account?.currency ?? existing?.currency ?? defaultCurrency;

  const accountOptions: SelectOption[] = accounts.map((a) => {
    const visual = accountVisual(a);
    const display = balanceDisplay(a);
    return {
      value: a.id,
      label: a.name,
      subtitle: `${formatMoney(display.amount, a.currency, { decimals: 'never' })}${
        display.caption ? ` ${display.caption}` : ''
      }`,
      icon: visual.icon,
      color: visual.color,
    };
  });

  const categoryOptions: SelectOption[] = index
    .top('expense')
    .flatMap((c) => [
      { value: c.id, label: c.name, icon: c.icon, color: c.color },
      ...(index.children.get(c.id) ?? [])
        .filter((s) => !s.isArchived)
        .map((s) => ({ value: s.id, label: s.name, icon: s.icon, color: s.color, depth: 1 })),
    ]);

  const save = useAppMutation(
    async (input: LoanInput) => {
      if (existing) await updateLoan(existing, input);
      else await createLoan(input);
    },
    {
      invalidate: 'financial',
      success: existing ? 'EMI updated' : 'EMI added',
      onSuccess: () => router.back(),
      context: 'save-loan',
    },
  );

  const submit = () => {
    const principalAmount = parseAmountInput(principal);
    const emiAmount = parseAmountInput(emi);
    const rateValue = rate ? Number(rate) : null;
    const tenureValue = tenure ? parseInt(tenure, 10) : null;
    const next = {
      name: name.trim() ? null : 'Give it a name (e.g. Car Loan, Phone EMI).',
      principal: principalAmount && principalAmount > 0 ? null : 'Enter the total loan amount.',
      emi: emiAmount && emiAmount > 0 ? null : 'Enter the monthly instalment.',
      rate:
        rate && (rateValue === null || Number.isNaN(rateValue) || rateValue < 0 || rateValue > 100)
          ? 'Enter a rate between 0 and 100.'
          : null,
      tenure:
        tenure && (tenureValue === null || Number.isNaN(tenureValue) || tenureValue < 1 || tenureValue > 600)
          ? 'Enter the number of months (1–600).'
          : null,
      account: accountId ? null : 'Choose which payment method pays this EMI.',
      category: categoryId ? null : 'Choose a category.',
    };
    setErrors(next);
    if (Object.values(next).some(Boolean) || !principalAmount || !emiAmount || !accountId) {
      haptic.error();
      return;
    }
    save.mutate({
      name,
      lender: lender || null,
      principalAmount,
      emiAmount,
      interestRate: rateValue,
      tenureMonths: tenureValue,
      currency,
      startDate: toISODate(start),
      accountId,
      categoryId,
      notes: notes || null,
      color: null,
      icon: 'calendar-number-outline',
      nextPaymentDate: toISODate(nextPayment),
      autoPost,
      remindDaysBefore: remind,
      isActive: existing ? existing.scheduleActive || !existing.isClosed : true,
    });
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert(
      'Delete this EMI?',
      'The agreement and its schedule are removed. Instalments already recorded are kept as transactions.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteLoan(existing);
              await invalidateFinancialData();
              toast.show('EMI deleted');
              router.back();
            } catch (e) {
              toast.show(describeError(e).message, 'error');
            }
          },
        },
      ],
    );
  };

  // Exact arithmetic only: total payable is emi × tenure, and the interest
  // shown is that total minus the principal. Nothing is amortised or guessed.
  const emiMinor = parseAmountInput(emi);
  const principalMinor = parseAmountInput(principal);
  const tenureMonths = tenure ? parseInt(tenure, 10) : null;
  const totalPayable = emiMinor && tenureMonths ? emiMinor * tenureMonths : null;
  const totalInterest =
    totalPayable !== null && principalMinor !== null ? totalPayable - principalMinor : null;

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: existing ? 'Edit EMI' : 'New EMI',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
              <Text tone="secondary">Cancel</Text>
            </Pressable>
          ),
        }}
      />

      <View style={{ gap: spacing.lg }}>
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Car Loan, Phone EMI"
          maxLength={80}
          error={errors.name}
        />
        <TextField
          label="Monthly EMI"
          value={emi}
          onChangeText={(t) => setEmi(sanitizeAmountKeystrokes(t))}
          keyboardType="decimal-pad"
          placeholder="0"
          error={errors.emi}
        />
        <SelectField
          label="Paid from"
          value={account?.name ?? null}
          placeholder="Choose payment method"
          icon={account ? accountVisual(account).icon : undefined}
          color={account ? accountVisual(account).color : undefined}
          onPress={() =>
            accounts.length
              ? setPicker('account')
              : router.push({ pathname: '/accounts/edit', params: { returnTo: 'emi' } })
          }
          error={errors.account}
        />
        <SelectField
          label="Category"
          value={category?.name ?? null}
          placeholder="Choose category"
          icon={category?.icon}
          color={category?.color}
          onPress={() => setPicker('category')}
          error={errors.category}
        />
      </View>

      <Section title="Loan details" style={{ marginTop: spacing.xxl }}>
        <View style={{ gap: spacing.lg }}>
          <TextField
            label="Total loan amount"
            value={principal}
            onChangeText={(t) => setPrincipal(sanitizeAmountKeystrokes(t))}
            keyboardType="decimal-pad"
            placeholder="0"
            error={errors.principal}
          />
          <TextField
            label="Interest rate (optional)"
            value={rate}
            onChangeText={(t) => setRate(t.replace(/[^\d.]/g, '').slice(0, 5))}
            keyboardType="decimal-pad"
            placeholder="e.g. 9.5"
            error={errors.rate}
            helper="Annual percentage, as written in your loan agreement."
          />
          <TextField
            label="Tenure in months (optional)"
            value={tenure}
            onChangeText={(t) => setTenure(t.replace(/\D/g, '').slice(0, 3))}
            keyboardType="number-pad"
            placeholder="e.g. 60"
            error={errors.tenure}
            helper="Used to track how many instalments are left. The schedule ends on its own."
          />
          <TextField
            label="Lender (optional)"
            value={lender}
            onChangeText={setLender}
            placeholder="e.g. HDFC Bank"
            maxLength={80}
          />
        </View>
        {totalPayable !== null ? (
          <Card variant="muted" style={{ marginTop: spacing.lg, gap: 2 }}>
            <Text variant="subhead">
              {formatMoney(totalPayable, currency, { decimals: 'never' })} over {tenureMonths} months
            </Text>
            {totalInterest !== null ? (
              <Text variant="footnote" tone="secondary">
                {totalInterest >= 0
                  ? `${formatMoney(totalInterest, currency, { decimals: 'never' })} more than the loan amount.`
                  : 'The instalments add up to less than the loan amount — check the figures.'}
              </Text>
            ) : null}
            <Text variant="caption" tone="tertiary">
              Simple arithmetic from the numbers you entered, not an amortisation schedule.
            </Text>
          </Card>
        ) : null}
      </Section>

      <Section title="Schedule">
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          <DateTimeField label="Loan start date" value={start} onChange={setStart} />
          <Divider />
          <DateTimeField label="Next payment" value={nextPayment} onChange={setNextPayment} />
          <Divider />
          <SwitchRow
            title="Record automatically"
            subtitle="When an instalment is due, add it as a transaction without asking. Off: you confirm each payment."
            value={autoPost}
            onValueChange={setAutoPost}
          />
        </Card>
        <Text variant="subhead" tone="secondary" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
          Remind me
        </Text>
        <Row gap={spacing.sm} wrap>
          {REMIND_CHOICES.map((d) => (
            <Chip
              key={d}
              label={d === 0 ? 'On the day' : `${d} day${d > 1 ? 's' : ''} before`}
              selected={remind === d}
              onPress={() => setRemind(d)}
            />
          ))}
        </Row>
        <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
          Instalments repeat monthly from the next payment date. A date like the 31st moves to the last day of
          shorter months.
        </Text>
      </Section>

      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} multiline maxLength={1000} />

      <View style={{ gap: spacing.md, marginTop: spacing.xxl }}>
        <Button title={existing ? 'Save changes' : 'Add EMI'} onPress={submit} loading={save.isPending} />
        {existing ? <Button title="Delete" variant="destructive" onPress={remove} /> : null}
      </View>

      <SelectSheet
        visible={picker === 'account'}
        title="Payment method"
        options={accountOptions}
        selected={accountId}
        addAction={{
          label: 'Add new payment method',
          onPress: () => router.push({ pathname: '/accounts/edit', params: { returnTo: 'emi' } }),
        }}
        onClose={() => setPicker(null)}
        onSelect={(v) => {
          setAccountId(v);
          setErrors((e) => ({ ...e, account: null }));
        }}
      />
      <SelectSheet
        visible={picker === 'category'}
        title="Category"
        searchable
        options={categoryOptions}
        selected={categoryId}
        onClose={() => setPicker(null)}
        onSelect={(v) => {
          const c = v ? index.byId.get(v) : null;
          setCategoryId(c ? c.id : null);
          setErrors((e) => ({ ...e, category: null }));
        }}
      />
    </Screen>
  );
}

/** Prefers a loans/EMI category when one exists, so the field starts filled. */
function defaultEmiCategory(index: { top: (kind: 'expense' | 'income') => { id: string; name: string }[] }) {
  const tops = index.top('expense');
  const match = tops.find((c) => /emi|loan/i.test(c.name));
  return match?.id ?? null;
}
