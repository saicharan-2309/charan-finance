/**
 * Loans & EMIs.
 *
 * Each EMI is an agreement (principal, rate, tenure) plus a monthly schedule
 * that charges a payment method of the user's choosing — bank account, credit
 * card, UPI or cash. Progress is counted from instalments actually recorded,
 * so nothing here is an estimate.
 */
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Button, haptic } from '@/components/ui/controls';
import { EmptyState, ProgressBar, QueryState, useToast } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, Icon, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { useAppMutation, useCurrency, useLoans } from '@/hooks/data';
import { formatDayLabel, todayISO } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatMoney } from '@/lib/money';
import { METHOD_ICONS } from '@/lib/payment-methods';
import { invalidateFinancialData } from '@/lib/query';
import { postRecurringOccurrence } from '@/services/planning';
import { deleteLoan, setLoanClosed } from '@/services/loans';
import { spacing } from '@/theme/tokens';
import type { Loan } from '@/types/domain';

export default function LoansScreen() {
  const q = useLoans();
  const currency = useCurrency();

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: 'Loans & EMIs',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/emi/edit')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Add EMI"
            >
              <Text variant="bodyStrong" tone="brand">
                Add
              </Text>
            </Pressable>
          ),
        }}
      />
      <QueryState query={q}>
        {(loans) => {
          if (loans.length === 0) {
            return (
              <EmptyState
                icon="calendar-number-outline"
                title="No EMIs yet"
                message="Add a car loan, phone EMI or personal loan. Each one can be paid from any account — a bank account, a credit card, UPI or cash."
                actionLabel="Add EMI"
                onAction={() => router.push('/emi/edit')}
              />
            );
          }
          const open = loans.filter((l) => !l.isClosed);
          const closed = loans.filter((l) => l.isClosed);
          const monthly = open.filter((l) => l.currency === currency).reduce((s, l) => s + l.emiAmount, 0);

          return (
            <>
              {open.length ? (
                <Card variant="muted" style={{ marginBottom: spacing.xxl }}>
                  <Text variant="caption" tone="secondary">
                    Committed every month
                  </Text>
                  <MoneyText minor={monthly} currency={currency} variant="amountLarge" />
                  <Text variant="footnote" tone="secondary">
                    Across {open.length} {open.length === 1 ? 'EMI' : 'EMIs'}
                  </Text>
                </Card>
              ) : null}

              {open.map((l) => (
                <LoanCard key={l.id} loan={l} />
              ))}

              {closed.length ? (
                <Section title="Closed">
                  {closed.map((l) => (
                    <LoanCard key={l.id} loan={l} />
                  ))}
                </Section>
              ) : null}
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}

function LoanCard({ loan: l }: { loan: Loan }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const progress =
    l.scheduledTotal && l.scheduledTotal > 0 ? Math.min(l.paidAmount / l.scheduledTotal, 1) : null;

  const record = useAppMutation(() => postRecurringOccurrence(l.recurringId!, l.nextPaymentDate!), {
    invalidate: 'financial',
    success: 'Instalment recorded',
    context: 'post-emi',
  });

  const manage = () => {
    haptic.light();
    Alert.alert(l.name, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Edit', onPress: () => router.push({ pathname: '/emi/edit', params: { id: l.id } }) },
      {
        text: l.isClosed ? 'Reopen' : 'Mark as closed',
        onPress: async () => {
          setBusy(true);
          try {
            await setLoanClosed(l, !l.isClosed);
            await invalidateFinancialData();
            toast.show(l.isClosed ? 'Reopened' : 'Marked as closed');
          } catch (e) {
            toast.show(describeError(e).message, 'error');
          } finally {
            setBusy(false);
          }
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          Alert.alert(
            'Delete this EMI?',
            'The agreement and its schedule are removed. Instalments already recorded are kept as transactions.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  setBusy(true);
                  try {
                    await deleteLoan(l);
                    await invalidateFinancialData();
                    toast.show('EMI deleted');
                  } catch (e) {
                    toast.show(describeError(e).message, 'error');
                  } finally {
                    setBusy(false);
                  }
                },
              },
            ],
          ),
      },
    ]);
  };

  const overdue = l.nextPaymentDate !== null && l.nextPaymentDate < todayISO();

  return (
    <Card style={{ marginBottom: spacing.lg, gap: spacing.md, opacity: busy ? 0.6 : 1 }}>
      <Pressable onPress={manage} accessibilityRole="button" accessibilityLabel={`Manage ${l.name}`}>
        <Row gap={spacing.md}>
          <IconBadge
            icon={l.icon ?? l.categoryIcon ?? 'calendar-number-outline'}
            color={l.color ?? l.categoryColor}
            size={44}
          />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {l.name}
            </Text>
            <Row gap={spacing.xs}>
              <Icon name={METHOD_ICONS[l.accountType]} size={13} tone="tertiary" />
              <Text variant="footnote" tone="secondary" numberOfLines={1}>
                {l.accountName}
              </Text>
            </Row>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <MoneyText minor={l.emiAmount} currency={l.currency} options={{ decimals: 'never' }} />
            <Text variant="caption" tone="secondary">
              per month
            </Text>
          </View>
        </Row>
      </Pressable>

      {progress !== null ? (
        <View style={{ gap: spacing.xs }}>
          <ProgressBar progress={progress} />
          <Row justify="space-between">
            <Text variant="caption" tone="secondary">
              {l.paidCount} of {l.tenureMonths} paid ·{' '}
              {formatMoney(l.paidAmount, l.currency, { decimals: 'never' })}
            </Text>
            {l.amountRemaining != null ? (
              <Text variant="caption" tone="secondary">
                {formatMoney(l.amountRemaining, l.currency, { decimals: 'never' })} to go
              </Text>
            ) : null}
          </Row>
        </View>
      ) : (
        <Text variant="caption" tone="secondary">
          {l.paidCount} {l.paidCount === 1 ? 'instalment' : 'instalments'} recorded ·{' '}
          {formatMoney(l.paidAmount, l.currency, { decimals: 'never' })} paid
        </Text>
      )}

      <Divider />

      <Row justify="space-between">
        <View style={{ flex: 1 }}>
          <Text variant="caption" tone="secondary">
            {l.isClosed ? 'Closed' : 'Next payment'}
          </Text>
          <Text variant="subhead" tone={overdue ? 'warning' : 'primary'}>
            {l.isClosed
              ? 'No further instalments'
              : l.nextPaymentDate
                ? formatDayLabel(l.nextPaymentDate)
                : 'Schedule finished'}
          </Text>
        </View>
        {!l.isClosed && l.recurringId && l.nextPaymentDate ? (
          <Button
            title="Record"
            size="sm"
            variant="secondary"
            loading={record.isPending}
            onPress={() => record.mutate(undefined)}
            accessibilityHint={`Records the ${l.name} instalment as paid from ${l.accountName}`}
          />
        ) : null}
      </Row>

      {l.interestRate != null || l.principalAmount ? (
        <Text variant="caption" tone="tertiary">
          {[
            `Loan ${formatMoney(l.principalAmount, l.currency, { decimals: 'never' })}`,
            l.interestRate != null ? `${l.interestRate}% interest` : null,
            l.tenureMonths ? `${l.tenureMonths} months` : null,
            l.lender,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}
    </Card>
  );
}
