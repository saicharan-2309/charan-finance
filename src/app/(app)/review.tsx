/**
 * Review — the inbox for everything bank sync added on its own.
 *
 * Three kinds of item:
 *   * Accounts found in your messages: every waiting SMS for an account that
 *     isn't in the app yet, grouped by bank and digits, added in one tap.
 *   * Messages the app could not place on its own (unknown card digits, a card
 *     payment with no matching bank side). One tap puts each in the right
 *     account, and the app remembers the digits for next time.
 *   * Transactions it added, waiting for a glance. Changing a category here
 *     teaches the merchant: the next Swiggy order files itself.
 */
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { CategoryAvatar } from '@/components/CategoryAvatar';
import { Button } from '@/components/ui/controls';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { SelectSheet } from '@/components/ui/pickers';
import { Card, Divider, Icon, MoneyText, Row, Text } from '@/components/ui/primitives';
import {
  accountOptions,
  categoryLabel,
  categoryOptions,
  splitCategoryValue,
} from '@/features/shared/options';
import { FoundAccountsList, useFoundAccounts } from '@/features/bank-sync/FoundAccounts';
import { signedAmount, transactionTitle } from '@/features/transactions/TransactionRow';
import {
  useAccounts,
  useAppMutation,
  useCategoryIndex,
  usePendingMessages,
  useReviewQueue,
} from '@/hooks/data';
import { formatDayLabel, formatTime } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { invalidateFinancialData } from '@/lib/query';
import {
  assignMessage,
  dismissMessage,
  markReviewed,
  reviewTransaction,
  settleMessageExternally,
} from '@/services/bank-sync';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';
import type { BankMessage, Transaction } from '@/types/domain';

export default function ReviewScreen() {
  const pending = usePendingMessages();
  const found = useFoundAccounts();
  const queue = useReviewQueue();
  const accounts = useAccounts();
  const { index } = useCategoryIndex();
  const [refreshing, setRefreshing] = useState(false);
  const [picking, setPicking] = useState<BankMessage | null>(null);
  const [recat, setRecat] = useState<Transaction | null>(null);

  const assign = useAppMutation(
    (v: { id: string; accountId: string }) => assignMessage(v.id, v.accountId, true),
    {
      context: 'review.assign',
      invalidate: 'financial',
      success: 'Added — these digits are remembered now.',
    },
  );
  const settle = useAppMutation(settleMessageExternally, {
    context: 'review.settle',
    invalidate: 'financial',
    success: 'Recorded as a payment from outside the app.',
  });
  const dismiss = useAppMutation(dismissMessage, { context: 'review.dismiss', invalidate: 'financial' });
  const review = useAppMutation(reviewTransaction, {
    context: 'review.categorise',
    invalidate: 'financial',
  });
  const allGood = useAppMutation((ids?: string[]) => markReviewed(ids), {
    context: 'review.all',
    invalidate: 'financial',
    success: (n) => (n > 1 ? `${n} transactions confirmed` : null),
  });

  const pickOptions = useMemo(() => {
    const all = accounts.data ?? [];
    if (!picking) return [];
    if (picking.status === 'awaiting_pair') {
      return accountOptions(
        all,
        (a) =>
          a.id !== picking.accountId &&
          (picking.direction === 'credit' ? a.type !== 'credit_card' : a.type === 'credit_card'),
      );
    }
    if (picking.instrument === 'credit_card') {
      const cards = accountOptions(all, (a) => a.type === 'credit_card');
      if (cards.length) return cards;
    }
    return accountOptions(all);
  }, [accounts.data, picking]);

  // Messages for an account in "Found in your messages" are handled there, as
  // a group — they're not asked about one by one.
  const foundKeys = new Set(found.items.map((d) => `${d.bank ?? ''}:${d.last4}`));
  const msgs = (pending.data ?? []).filter(
    (m) => !(m.status === 'needs_account' && m.last4 && foundKeys.has(`${m.bank ?? ''}:${m.last4}`)),
  );
  const txns = queue.data ?? [];
  // A query is "done" once it has data, has failed, or is paused offline with
  // nothing cached. Waiting only for data left this screen on a skeleton
  // forever whenever one source failed (e.g. a database function missing).
  const sources = [pending, queue, found];
  const done = (q: (typeof sources)[number]) =>
    q.data !== undefined || !!q.error || (q.fetchStatus === 'paused' && q.data === undefined);
  const loading = !sources.every(done);
  const failed = sources.find((q) => q.error)?.error ?? null;
  const offline = sources.some((q) => q.fetchStatus === 'paused' && q.data === undefined);

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await invalidateFinancialData();
        setRefreshing(false);
      }}
    >
      <Stack.Screen
        options={{
          headerRight: () =>
            txns.length > 0 ? (
              <Pressable
                onPress={() => allGood.mutate(undefined)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Mark everything as checked"
              >
                <Text variant="bodyStrong" tone="brand">
                  All good
                </Text>
              </Pressable>
            ) : null,
        }}
      />

      {!loading && (failed || offline) ? (
        <Card style={{ marginBottom: spacing.xl }}>
          <ErrorState
            compact
            error={failed ?? new Error('offline')}
            onRetry={() => sources.forEach((q) => void q.refetch())}
          />
        </Card>
      ) : null}

      {loading ? (
        <SkeletonList rows={6} />
      ) : failed &&
        msgs.length === 0 &&
        txns.length === 0 &&
        found.items.length === 0 ? null : msgs.length === 0 &&
        txns.length === 0 &&
        found.items.length === 0 ? (
        <EmptyState
          icon="checkmark-done-circle-outline"
          title="All caught up"
          message="New transactions from your bank texts appear here for a quick check."
          actionLabel="Bank sync settings"
          onAction={() => router.push('/bank-sync')}
        />
      ) : (
        <>
          {found.items.length > 0 ? (
            <Section title="Found in your messages">
              <Text variant="footnote" tone="secondary" style={{ marginBottom: spacing.md }}>
                Your bank texts mention {found.items.length === 1 ? 'this' : 'these'} — add{' '}
                {found.items.length === 1 ? 'it' : 'each one'} and all of its transactions come in at once.
              </Text>
              <FoundAccountsList />
            </Section>
          ) : null}

          {msgs.length > 0 ? (
            <Section title="Needs your help">
              <View style={{ gap: spacing.md }}>
                {msgs.map((m) => (
                  <PendingCard
                    key={m.id}
                    m={m}
                    accountName={accounts.data?.find((a) => a.id === m.accountId)?.name ?? null}
                    onChoose={() => setPicking(m)}
                    onOutside={() => settle.mutate(m.id)}
                    onDismiss={() => dismiss.mutate(m.id)}
                  />
                ))}
              </View>
            </Section>
          ) : null}

          {txns.length > 0 ? (
            <Section title={`Check ${txns.length === 1 ? 'this' : `these ${txns.length}`}`}>
              <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                {txns.map((t, i) => (
                  <View key={t.id}>
                    {i > 0 ? <Divider inset={54} /> : null}
                    <ReviewRow
                      t={t}
                      label={categoryLabel(index, t.categoryId, t.subcategoryId)}
                      onCategory={() => setRecat(t)}
                      onConfirm={() => review.mutate({ id: t.id })}
                    />
                  </View>
                ))}
              </Card>
              <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.md }}>
                Change a category and that merchant is filed the same way from now on.
              </Text>
            </Section>
          ) : null}
        </>
      )}

      <SelectSheet
        visible={!!picking}
        title={
          picking?.status === 'awaiting_pair'
            ? picking.direction === 'credit'
              ? 'Which account paid it?'
              : 'Which card was paid?'
            : picking?.instrument === 'credit_card'
              ? 'Which card is this?'
              : 'Which account is this?'
        }
        options={pickOptions}
        onSelect={(value) => {
          if (picking && value) assign.mutate({ id: picking.id, accountId: value });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
        addAction={{
          label: 'Add a new payment method',
          icon: 'add-circle-outline',
          onPress: () => {
            setPicking(null);
            router.push('/accounts/edit');
          },
        }}
      />

      <SelectSheet
        visible={!!recat}
        title="Category"
        searchable
        options={recat ? categoryOptions(index, recat.type === 'income' ? 'income' : 'expense') : []}
        selected={
          recat
            ? recat.subcategoryId
              ? `${recat.categoryId}:${recat.subcategoryId}`
              : recat.categoryId
            : null
        }
        onSelect={(value) => {
          if (recat && value) {
            const { categoryId, subcategoryId } = splitCategoryValue(value);
            review.mutate({ id: recat.id, categoryId, subcategoryId, remember: true });
          }
          setRecat(null);
        }}
        onClose={() => setRecat(null)}
      />
    </Screen>
  );
}

function PendingCard({
  m,
  accountName,
  onChoose,
  onOutside,
  onDismiss,
}: {
  m: BankMessage;
  accountName: string | null;
  onChoose: () => void;
  onOutside: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const awaiting = m.status === 'awaiting_pair';
  const headline = awaiting
    ? m.direction === 'credit'
      ? `${accountName ?? 'Card'} bill paid`
      : `Card bill paid from ${accountName ?? 'your account'}`
    : m.isCardPayment
      ? 'Card bill payment'
      : (m.merchant ?? (m.direction === 'credit' ? 'Money in' : 'Payment'));
  const isCard = m.instrument === 'credit_card' || m.instrument === 'debit_card' || m.instrument === 'card';
  const question = awaiting
    ? m.direction === 'credit'
      ? 'Which account did the money come from?'
      : 'Which card did this pay?'
    : m.last4
      ? `Which of your ${isCard ? 'cards' : 'accounts'} ends in ${m.last4}?`
      : `Which ${isCard ? 'card' : 'account'} is this?`;

  return (
    <Card style={{ gap: spacing.md }}>
      <Row gap={spacing.md} align="flex-start">
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 15,
            backgroundColor: colors.warningSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={awaiting ? 'git-compare-outline' : 'help'} size={20} tone="warning" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Row justify="space-between" align="flex-start">
            <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {headline}
            </Text>
            {m.amount !== null ? (
              <Text variant="amount" tone={m.direction === 'credit' ? 'positive' : 'primary'}>
                {formatMoney(m.amount, 'INR')}
              </Text>
            ) : null}
          </Row>
          <Text variant="footnote" tone="secondary">
            {formatDayLabel(new Date(m.receivedAt))}, {formatTime(m.receivedAt)}
            {m.bank ? `, ${m.bank.toUpperCase()}` : ''}
          </Text>
          <Text variant="callout" style={{ marginTop: spacing.xs }}>
            {question}
          </Text>
        </View>
      </Row>
      <Row gap={spacing.sm} wrap>
        <Button
          title={awaiting && m.direction === 'debit' ? 'Choose card' : 'Choose account'}
          size="sm"
          onPress={onChoose}
        />
        {awaiting ? (
          <Button title="Not in the app" size="sm" variant="secondary" onPress={onOutside} />
        ) : (
          <Button title="Not mine" size="sm" variant="secondary" onPress={onDismiss} />
        )}
        <Pressable
          onPress={() => setOpen((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          style={{ justifyContent: 'center', paddingHorizontal: spacing.sm }}
        >
          <Text variant="subhead" tone="brand">
            {open ? 'Hide SMS' : 'Show SMS'}
          </Text>
        </Pressable>
      </Row>
      {open ? (
        <Text
          variant="footnote"
          tone="secondary"
          selectable
          style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: spacing.md }}
        >
          {m.body}
        </Text>
      ) : null}
    </Card>
  );
}

function ReviewRow({
  t,
  label,
  onCategory,
  onConfirm,
}: {
  t: Transaction;
  label: string;
  onCategory: () => void;
  onConfirm: () => void;
}) {
  const { colors } = useTheme();
  const transfer = t.type === 'transfer' || t.type === 'adjustment';
  return (
    <View style={{ paddingVertical: spacing.md, gap: spacing.sm }}>
      <Pressable
        onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: t.id } })}
        accessibilityRole="button"
      >
        <Row gap={spacing.md}>
          <CategoryAvatar
            icon={transfer ? 'swap-horizontal' : t.categoryIcon}
            color={transfer ? colors.transfer : t.categoryColor}
            size={42}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {transactionTitle(t)}
            </Text>
            <Text variant="footnote" tone="secondary" numberOfLines={1}>
              {t.accountName}, {formatDayLabel(new Date(t.occurredAt)).toLowerCase()}{' '}
              {formatTime(t.occurredAt)}
            </Text>
          </View>
          <MoneyText
            minor={signedAmount(t)}
            currency={t.currency}
            tone={t.type === 'income' ? 'positive' : t.type === 'transfer' ? 'transfer' : 'primary'}
            options={{ signed: t.type === 'income' }}
          />
        </Row>
      </Pressable>
      <Row gap={spacing.sm} style={{ marginLeft: 54 }}>
        {transfer ? (
          <View style={{ flex: 1 }}>
            <Text variant="footnote" tone="secondary">
              Moved between your accounts — not counted as spending.
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={onCategory}
            accessibilityRole="button"
            accessibilityLabel={`Category ${label}. Change`}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: spacing.md,
              height: 34,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
            })}
          >
            <Text variant="subhead" numberOfLines={1} style={{ flex: 1 }}>
              {label}
            </Text>
            <Icon name="chevron-down" size={14} tone="tertiary" />
          </Pressable>
        )}
        <Pressable
          onPress={onConfirm}
          accessibilityRole="button"
          accessibilityLabel="Confirm category"
          style={({ pressed }) => ({
            height: 34,
            paddingHorizontal: spacing.md,
            borderRadius: radius.pill,
            backgroundColor: pressed ? colors.positive : colors.positiveSoft,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          })}
        >
          <Icon name="checkmark" size={16} tone="positive" />
          <Text variant="subhead" tone="positive">
            Confirm
          </Text>
        </Pressable>
      </Row>
    </View>
  );
}
