import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Button } from '@/components/ui/controls';
import { EmptyState, ProgressBar, SkeletonList } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { AmountPrompt } from '@/features/shared/AmountPrompt';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { useAccounts, useAppMutation, useTransactionsInfinite } from '@/hooks/data';
import { ACCOUNT_TYPE_ICONS, ACCOUNT_TYPE_LABELS, isLiability } from '@/lib/accounts';
import { formatMoney, minorToInput, type Minor } from '@/lib/money';
import { reconcileAccountBalance } from '@/services/core';
import { spacing } from '@/theme/tokens';

export default function AccountDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const accounts = useAccounts();
  const account = accounts.data?.find((a) => a.id === id);
  const filters = useMemo(() => ({ accountIds: [id] }), [id]);
  const tx = useTransactionsInfinite(filters);
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
        {accounts.isPending ? <SkeletonList rows={4} /> : <EmptyState title="Account not found" />}
      </Screen>
    );
  const liability = isLiability(account.type);
  const items = tx.data?.pages.flatMap((p) => p.items) ?? [];
  const owed = liability ? Math.max(-account.currentBalance, 0) : 0;

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: account.name,
          headerRight: () => (
            <Pressable
              onPress={() => router.push({ pathname: '/accounts/edit', params: { id } })}
              hitSlop={10}
            >
              <Text variant="bodyStrong" tone="brand">
                Edit
              </Text>
            </Pressable>
          ),
        }}
      />
      <Card variant="elevated" style={{ padding: spacing.xl, gap: spacing.md, marginBottom: spacing.xl }}>
        <Row gap={spacing.md}>
          <IconBadge
            icon={account.icon ?? ACCOUNT_TYPE_ICONS[account.type]}
            color={account.color}
            size={44}
          />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">{ACCOUNT_TYPE_LABELS[account.type]}</Text>
            <Text variant="footnote" tone="secondary">
              {[
                account.institution,
                account.last4 ? `••${account.last4}` : null,
                account.isActive ? null : 'Archived',
              ]
                .filter(Boolean)
                .join(' · ') || account.currency}
            </Text>
          </View>
        </Row>
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
        {account.type === 'credit_card' && account.creditLimit ? (
          <View style={{ gap: spacing.xs }}>
            <ProgressBar progress={owed / account.creditLimit} />
            <Text variant="footnote" tone="secondary">
              {Math.round((owed / account.creditLimit) * 100)}% of{' '}
              {formatMoney(account.creditLimit, account.currency, { decimals: 'never' })} limit used ·{' '}
              {formatMoney(Math.max(account.creditLimit - owed, 0), account.currency, { decimals: 'never' })}{' '}
              available
            </Text>
          </View>
        ) : null}
        <Text variant="caption" tone="tertiary">
          Opening balance {formatMoney(account.openingBalance, account.currency)}
        </Text>
      </Card>

      <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xxl }}>
        <Button
          title="Add"
          icon="add"
          size="md"
          style={{ flex: 1 }}
          onPress={() => router.push({ pathname: '/transaction/new', params: { accountId: id } })}
          disabled={!account.isActive}
        />
        {liability ? (
          <Button
            title="Pay"
            icon="arrow-down"
            size="md"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/transaction/new', params: { type: 'transfer' } })}
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
          <EmptyState compact icon="receipt-outline" title="No transactions yet" />
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
