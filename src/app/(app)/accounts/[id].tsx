/**
 * One payment method.
 *
 * The header adapts to the type: a credit card shows what it has used this
 * billing cycle, what is available, its limit and when payment is due; every
 * other type shows its balance. Figures come from the database — the cycle
 * spend is computed by `credit_card_cycle`, available credit from the limit.
 */
import { useQuery } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Button, TextField } from '@/components/ui/controls';
import { EmptyState, ProgressBar, Skeleton, SkeletonList } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, Icon, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { AmountPrompt } from '@/features/shared/AmountPrompt';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { useAccounts, useAppMutation, useCardCycle, useTransactionsInfinite } from '@/hooks/data';
import { isLiability } from '@/lib/accounts';
import { formatDayLabel, formatShortDate, formatTime, fromISODate, todayISO } from '@/lib/dates';
import { formatMoney, minorToInput, type Minor } from '@/lib/money';
import { accountVisual, cardDates, cardStanding, providerByKey } from '@/lib/payment-methods';
import { addAlias, deleteAlias, fetchAliases } from '@/services/bank-sync';
import { reconcileAccountBalance } from '@/services/core';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { Account, CardCycle } from '@/types/domain';

export default function AccountDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const accounts = useAccounts();
  const account = accounts.data?.find((a) => a.id === id);
  const filters = useMemo(() => ({ accountIds: [id] }), [id]);
  const tx = useTransactionsInfinite(filters);
  const cycle = useCardCycle(id, account?.type === 'credit_card');
  const [reconcile, setReconcile] = useState(false);

  const reconcileM = useAppMutation(
    ({ amount, note }: { amount: Minor; note: string | null }) =>
      reconcileAccountBalance(id, amount, note ?? undefined),
    {
      invalidate: 'financial',
      success: 'Balance updated',
      onSuccess: () => setReconcile(false),
      context: 'reconcile',
    },
  );

  if (!account)
    return (
      <Screen>
        {accounts.isPending ? <SkeletonList rows={4} /> : <EmptyState title="Payment method not found" />}
      </Screen>
    );

  const liability = isLiability(account.type);
  const isCard = account.type === 'credit_card';
  const items = tx.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: account.name,
          headerRight: () => (
            <Pressable
              onPress={() => router.push({ pathname: '/accounts/edit', params: { id } })}
              hitSlop={10}
              accessibilityRole="button"
            >
              <Text variant="bodyStrong" tone="brand">
                Edit
              </Text>
            </Pressable>
          ),
        }}
      />

      {isCard ? (
        <CardHeader account={account} cycle={cycle.data ?? null} loading={cycle.isPending} />
      ) : (
        <BalanceHeader account={account} />
      )}

      <BankBalanceCheck
        account={account}
        loading={reconcileM.isPending}
        onMatch={(amount) => reconcileM.mutate({ amount, note: 'Matched to the balance in a bank SMS' })}
      />

      <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xxl }}>
        <Button
          title={account.type === 'credit_card' ? 'Add expense' : 'Add'}
          icon="add"
          size="md"
          style={{ flex: 1 }}
          onPress={() => router.push({ pathname: '/transaction/new', params: { accountId: id } })}
          disabled={!account.isActive}
        />
        {liability ? (
          <Button
            title={isCard ? 'Make payment' : 'Pay'}
            icon="arrow-down"
            size="md"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() =>
              router.push({
                pathname: '/transaction/new',
                params: { type: 'transfer', toAccountId: id },
              })
            }
            accessibilityHint="Records a transfer from another account, not a new expense"
          />
        ) : null}
        <Button
          title="Reconcile"
          icon="checkmark-done"
          size="md"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => setReconcile(true)}
        />
      </View>

      <Section title="Transactions">
        {tx.isPending ? (
          <SkeletonList rows={6} />
        ) : items.length === 0 ? (
          <EmptyState compact icon="receipt-outline" title="Nothing recorded yet" />
        ) : (
          <>
            {items.map((t) => (
              <TransactionRow key={t.id} t={t} showDate />
            ))}
            {tx.hasNextPage ? (
              tx.isFetchingNextPage ? (
                <ActivityIndicator style={{ marginTop: spacing.lg }} />
              ) : (
                <Button title="Load more" variant="ghost" size="md" onPress={() => void tx.fetchNextPage()} />
              )
            ) : null}
          </>
        )}
      </Section>

      {account.type !== 'cash' && account.type !== 'wallet' ? <AliasSection account={account} /> : null}

      <AmountPrompt
        visible={reconcile}
        title="Reconcile balance"
        message={`Enter the real balance from your ${liability ? 'statement' : 'bank'}. The difference is recorded as an adjustment (not income or expense).`}
        initial={minorToInput(Math.abs(account.currentBalance))}
        signOptions={liability ? ['Amount owed', 'In credit'] : ['Positive', 'Overdrawn']}
        withNote
        confirmLabel="Update"
        loading={reconcileM.isPending}
        onClose={() => setReconcile(false)}
        onSubmit={(amount, note) => {
          // For liabilities "Amount owed" (the first option) means a negative balance.
          const signed = (liability ? -amount : amount) as Minor;
          reconcileM.mutate({ amount: signed, note });
        }}
      />
    </Screen>
  );
}

function MethodIdentity({ account }: { account: Account }) {
  const visual = accountVisual(account);
  const provider = providerByKey(account.provider);
  const subtitle =
    [provider?.label ?? account.institution, account.last4 ? `•••• ${account.last4}` : null]
      .filter(Boolean)
      .join(' · ') || account.currency;
  return (
    <Row gap={spacing.md}>
      <IconBadge icon={visual.icon} color={visual.color} size={44} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{account.name}</Text>
        <Text variant="footnote" tone="secondary">
          {account.isActive ? subtitle : `${subtitle} · Archived`}
        </Text>
      </View>
    </Row>
  );
}

function BalanceHeader({ account }: { account: Account }) {
  const liability = isLiability(account.type);
  const owed = liability ? Math.max(-account.currentBalance, 0) : 0;
  return (
    <Card variant="elevated" style={{ padding: spacing.xl, gap: spacing.lg, marginBottom: spacing.xl }}>
      <MethodIdentity account={account} />
      <View>
        <Text variant="overline" tone="secondary">
          {liability ? 'Amount owed' : 'Current balance'}
        </Text>
        <MoneyText
          minor={liability ? owed : account.currentBalance}
          currency={account.currency}
          variant="display"
          colorBySign={!liability && account.currentBalance < 0}
          options={{ decimals: 'always' }}
        />
        {liability && account.currentBalance > 0 ? (
          <Text variant="footnote" tone="positive">
            In credit by {formatMoney(account.currentBalance, account.currency)}
          </Text>
        ) : null}
      </View>
      <Text variant="caption" tone="tertiary">
        Opening balance {formatMoney(account.openingBalance, account.currency)}
      </Text>
    </Card>
  );
}

function CardHeader({
  account,
  cycle,
  loading,
}: {
  account: Account;
  cycle: CardCycle | null;
  loading: boolean;
}) {
  const standing = cardStanding(account);
  const dates = cardDates(account, todayISO());
  return (
    <Card variant="elevated" style={{ padding: spacing.xl, gap: spacing.lg, marginBottom: spacing.xl }}>
      <MethodIdentity account={account} />

      <Row gap={spacing.xl} align="flex-start">
        <View style={{ flex: 1 }}>
          <Text variant="overline" tone="secondary">
            Outstanding
          </Text>
          <MoneyText
            minor={standing.used}
            currency={account.currency}
            variant="amountLarge"
            options={{ decimals: 'never' }}
          />
        </View>
        {standing.available !== null ? (
          <View style={{ flex: 1 }}>
            <Text variant="overline" tone="secondary">
              Available
            </Text>
            <MoneyText
              minor={standing.available}
              currency={account.currency}
              variant="amountLarge"
              tone="positive"
              options={{ decimals: 'never' }}
            />
          </View>
        ) : null}
      </Row>

      {standing.inCredit > 0 ? (
        <Text variant="footnote" tone="positive">
          This card is in credit by {formatMoney(standing.inCredit, account.currency)}.
        </Text>
      ) : null}

      {standing.utilisation !== null && account.creditLimit ? (
        <View style={{ gap: spacing.xs }}>
          <ProgressBar progress={standing.utilisation} />
          <Text variant="footnote" tone="secondary">
            {Math.round(standing.utilisation * 100)}% of{' '}
            {formatMoney(account.creditLimit, account.currency, { decimals: 'never' })} limit used
          </Text>
        </View>
      ) : null}

      <Divider />

      <Row gap={spacing.lg} align="flex-start" wrap>
        <Fact
          label="Used this cycle"
          value={
            loading ? null : cycle ? formatMoney(cycle.spend, account.currency, { decimals: 'never' }) : '—'
          }
          hint={
            cycle
              ? `${formatShortDate(fromISODate(cycle.cycleStart))} – ${formatShortDate(fromISODate(cycle.cycleEnd))}`
              : undefined
          }
        />
        <Fact
          label="Payment due"
          value={
            cycle?.dueDate
              ? formatShortDate(fromISODate(cycle.dueDate))
              : dates.nextDue
                ? formatShortDate(fromISODate(dates.nextDue))
                : 'Not set'
          }
          hint={account.dueDay ? undefined : 'Add a due day when editing'}
        />
        {account.minimumDue != null ? (
          <Fact
            label="Minimum due"
            value={formatMoney(account.minimumDue, account.currency, { decimals: 'never' })}
            hint="As printed on your statement"
          />
        ) : null}
      </Row>

      {cycle && cycle.payments > 0 ? (
        <Text variant="caption" tone="tertiary">
          {formatMoney(cycle.payments, account.currency, { decimals: 'never' })} repaid during this cycle.
          Repayments are transfers, so they are never counted as spending.
        </Text>
      ) : null}
    </Card>
  );
}

function Fact({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <View style={{ gap: 2, minWidth: 110, flexGrow: 1, flexBasis: 110 }}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      {value === null ? <Skeleton width={70} height={18} /> : <Text variant="bodyStrong">{value}</Text>}
      {hint ? (
        <Text variant="caption" tone="tertiary" numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * What the bank itself last said, from the balance printed in its SMS. If the
 * app's figure differs, one tap records the difference as an adjustment — the
 * same reconciliation as entering it by hand, never income or expense.
 */
function BankBalanceCheck({
  account,
  loading,
  onMatch,
}: {
  account: Account;
  loading: boolean;
  onMatch: (amount: Minor) => void;
}) {
  const { colors } = useTheme();
  if (account.reportedBalance === null || !account.reportedBalanceAt) return null;
  const at = `${formatDayLabel(new Date(account.reportedBalanceAt)).toLowerCase()} at ${formatTime(account.reportedBalanceAt)}`;
  let expected: Minor | null = null;
  let said: string;
  if (account.reportedBalanceKind === 'limit') {
    said = `${formatMoney(account.reportedBalance, account.currency)} available`;
    if (account.creditLimit !== null) expected = -(account.creditLimit - account.reportedBalance) as Minor;
  } else {
    said = formatMoney(account.reportedBalance, account.currency);
    expected = (isLiability(account.type) ? -account.reportedBalance : account.reportedBalance) as Minor;
  }
  const matches = expected !== null && Math.abs(account.currentBalance - expected) < 100;

  return (
    <View
      style={{
        backgroundColor: matches ? colors.positiveSoft : colors.surface,
        borderRadius: radius.xl,
        borderWidth: matches ? 0 : 1,
        borderColor: colors.border,
        padding: spacing.lg,
        gap: spacing.md,
        marginBottom: spacing.xl,
      }}
    >
      <Row gap={spacing.md} align="flex-start">
        <Icon
          name={matches ? 'checkmark-circle' : 'chatbox-ellipses-outline'}
          size={20}
          tone={matches ? 'positive' : 'secondary'}
        />
        <Text variant="callout" style={{ flex: 1 }}>
          {matches
            ? `Matches your bank — it said ${said} ${at}.`
            : expected === null
              ? `Your bank said ${said} ${at}. Add the credit limit to compare it with the app.`
              : `Your bank said ${said} ${at}. The app shows ${formatMoney(Math.abs(account.currentBalance), account.currency)}${account.currentBalance < 0 ? ' owed' : ''}.`}
        </Text>
      </Row>
      {!matches && expected !== null ? (
        <Button
          title="Match the bank’s balance"
          size="md"
          variant="secondary"
          loading={loading}
          onPress={() => onMatch(expected!)}
        />
      ) : null}
    </View>
  );
}

/**
 * Other digits that belong to this account — a debit card on a savings
 * account, a reissued card. Bank SMS that quote them land here automatically.
 */
function AliasSection({ account }: { account: Account }) {
  const q = useQuery({ queryKey: ['aliases', account.id], queryFn: () => fetchAliases(account.id) });
  const [adding, setAdding] = useState(false);
  const [digits, setDigits] = useState('');
  const add = useAppMutation((d: string) => addAlias(account.id, d), {
    context: 'alias.add',
    invalidate: [['aliases', account.id]],
    onSuccess: () => {
      setDigits('');
      setAdding(false);
    },
    success: 'Saved. Messages with these digits come here now.',
  });
  const remove = useAppMutation(deleteAlias, { context: 'alias.delete', invalidate: [['aliases', account.id]] });
  const list = q.data ?? [];

  return (
    <Section title="Matched from bank SMS">
      <Card style={{ gap: spacing.md }}>
        <Text variant="footnote" tone="secondary">
          Bank messages ending{' '}
          {[account.last4, ...list.map((a) => a.last4)].filter(Boolean).join(', ') || '—'} are recorded here.
        </Text>
        {list.map((a) => (
          <Row key={a.id} justify="space-between">
            <Text variant="body">
              Also ends {a.last4}
              {a.bank ? ` (${a.bank.toUpperCase()})` : ''}
            </Text>
            <Pressable onPress={() => remove.mutate(a.id)} hitSlop={8} accessibilityRole="button">
              <Text variant="subhead" tone="negative">
                Remove
              </Text>
            </Pressable>
          </Row>
        ))}
        {adding ? (
          <Row gap={spacing.sm} align="flex-end">
            <View style={{ flex: 1 }}>
              <TextField
                label="Last 4 digits (e.g. your debit card)"
                value={digits}
                onChangeText={(v) => setDigits(v.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
              />
            </View>
            <Button
              title="Save"
              size="md"
              disabled={!/^\d{3,4}$/.test(digits)}
              loading={add.isPending}
              onPress={() => add.mutate(digits)}
            />
          </Row>
        ) : (
          <Button title="Add other digits" variant="ghost" size="sm" icon="add" onPress={() => setAdding(true)} />
        )}
      </Card>
    </Section>
  );
}
