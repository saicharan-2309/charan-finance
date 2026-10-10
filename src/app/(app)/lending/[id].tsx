/**
 * One loan: what's still owed, its history, and recording a repayment — in
 * full or part, into an account or "outside BUD" (e.g. cash you don't track).
 * Undoing a repayment, or deleting the loan, puts every balance back exactly.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Button, TextField, haptic } from '@/components/ui/controls';
import { EmptyState, QueryState } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { DateTimeField, SelectField, SelectSheet } from '@/components/ui/pickers';
import { Card, Divider, Icon, Row, Text } from '@/components/ui/primitives';
import { accountOptions } from '@/features/shared/options';
import { useAccounts, useAppMutation, useIous } from '@/hooks/data';
import { formatShortDate, toISODate } from '@/lib/dates';
import { formatMoney, parseAmountInput, toDecimalString } from '@/lib/money';
import { deleteIou, deleteRepayment, recordRepayment } from '@/services/lending';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing, typography } from '@/theme/tokens';

const OUTSIDE = '__outside__';

export default function IouScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const ious = useIous();
  const accounts = useAccounts();
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState(new Date());
  const [target, setTarget] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repay = useAppMutation(recordRepayment, {
    context: 'lending.repay',
    invalidate: 'financial',
    success: 'Repayment recorded',
    onSuccess: () => {
      setAmountText('');
      setTarget(null);
    },
  });
  const undo = useAppMutation(deleteRepayment, {
    context: 'lending.undo',
    invalidate: 'financial',
    success: 'Undone',
  });
  const remove = useAppMutation(deleteIou, {
    context: 'lending.delete',
    invalidate: 'financial',
    success: 'Deleted',
    onSuccess: () => router.back(),
  });
  const accountName = (accountId: string | null) =>
    accountId ? ((accounts.data ?? []).find((a) => a.id === accountId)?.name ?? 'an account') : null;

  return (
    <Screen>
      <QueryState query={ious}>
        {(list) => {
          const i = list.find((x) => x.id === id);
          if (!i)
            return <EmptyState icon="search-outline" title="Not found" message="This loan was deleted." />;
          const lent = i.direction === 'lent';
          const money = (v: number) => formatMoney(v, i.currency, { decimals: 'auto' });
          const submit = () => {
            const amount = parseAmountInput(amountText) ?? (amountText.trim() ? null : i.outstanding);
            if (!amount || amount <= 0) {
              setError('Enter the amount');
              haptic.error();
              return;
            }
            if (amount > i.outstanding) {
              setError(`That’s more than the ${money(i.outstanding)} still owed`);
              haptic.error();
              return;
            }
            if (!target) {
              setError(lent ? 'Where did the money go?' : 'Where did you pay it from?');
              haptic.error();
              return;
            }
            setError(null);
            repay.mutate({
              iouId: i.id,
              amount,
              occurredOn: toISODate(date),
              accountId: target === OUTSIDE ? null : target,
            });
          };
          return (
            <>
              <Stack.Screen options={{ title: i.person }} />
              <Card style={{ gap: spacing.xs, marginBottom: spacing.xl }}>
                <Text variant="subhead" tone="secondary">
                  {i.outstanding === 0
                    ? 'Settled'
                    : lent
                      ? `${i.person} still owes you`
                      : `You still owe ${i.person}`}
                </Text>
                <Text
                  style={[typography.display, { fontSize: 38, lineHeight: 44 }]}
                  tone={i.outstanding === 0 ? 'secondary' : lent ? 'positive' : 'negative'}
                >
                  {money(i.outstanding)}
                </Text>
                <Text variant="footnote" tone="secondary">
                  {lent ? 'Lent' : 'Borrowed'} {money(i.amount)} on {formatShortDate(i.occurredOn)} ·{' '}
                  {i.accountId
                    ? lent
                      ? `from ${accountName(i.accountId)}`
                      : `into ${accountName(i.accountId)}`
                    : 'before BUD'}
                </Text>
                {i.note ? (
                  <Text variant="footnote" tone="tertiary">
                    {i.note}
                  </Text>
                ) : null}
              </Card>

              {i.outstanding > 0 ? (
                <Section title={lent ? 'They paid you back' : 'You paid back'}>
                  <Card style={{ gap: spacing.md }}>
                    <TextField
                      label="Amount"
                      value={amountText}
                      onChangeText={setAmountText}
                      placeholder={toDecimalString(i.outstanding).replace(/\.00$/, '')}
                      keyboardType="decimal-pad"
                      leading={<Text variant="bodyStrong">₹</Text>}
                      helper="Leave empty for the full amount, or enter part of it."
                    />
                    <DateTimeField label="When" value={date} onChange={setDate} maximumDate={new Date()} />
                    <SelectField
                      label={lent ? 'Where did the money go?' : 'Paid from'}
                      value={
                        target === OUTSIDE
                          ? lent
                            ? 'Outside BUD (cash I don’t track)'
                            : 'Outside BUD'
                          : (accountName(target) ?? null)
                      }
                      placeholder="Choose"
                      onPress={() => setPicking(true)}
                      error={error}
                    />
                    <Button
                      title={lent ? 'Record repayment' : 'Record what I paid back'}
                      loading={repay.isPending}
                      onPress={submit}
                    />
                  </Card>
                </Section>
              ) : null}

              <Section title="History">
                <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                  <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                    <Icon name={lent ? 'arrow-up-circle' : 'arrow-down-circle'} size={22} tone="brand" />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong">{lent ? 'Lent' : 'Borrowed'}</Text>
                      <Text variant="caption" tone="secondary">
                        {formatShortDate(i.occurredOn)} ·{' '}
                        {i.accountId ? accountName(i.accountId) : 'before BUD'}
                      </Text>
                    </View>
                    <Text style={typography.amount}>{money(i.amount)}</Text>
                  </Row>
                  {i.repayments.map((p) => (
                    <View key={p.id}>
                      <Divider inset={34} />
                      <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                        <Icon name="checkmark-circle" size={22} tone="positive" />
                        <View style={{ flex: 1 }}>
                          <Text variant="bodyStrong">{lent ? 'Paid back to you' : 'You paid back'}</Text>
                          <Text variant="caption" tone="secondary">
                            {formatShortDate(p.occurredOn)} ·{' '}
                            {p.accountId ? accountName(p.accountId) : 'outside BUD'}
                          </Text>
                        </View>
                        <Text style={typography.amount} tone="positive">
                          {money(p.amount)}
                        </Text>
                        <Pressable
                          onPress={() =>
                            Alert.alert('Undo this repayment?', 'The balances go back to how they were.', [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Undo', style: 'destructive', onPress: () => undo.mutate(p.id) },
                            ])
                          }
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel="Undo this repayment"
                        >
                          <Icon name="arrow-undo-outline" size={18} tone="tertiary" />
                        </Pressable>
                      </Row>
                    </View>
                  ))}
                </Card>
              </Section>

              <Button
                title="Delete"
                variant="destructive"
                loading={remove.isPending}
                onPress={() =>
                  Alert.alert(
                    `Delete this ${lent ? 'loan' : 'debt'}?`,
                    'It and its repayments are removed, and every balance goes back to how it was.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(i.id) },
                    ],
                  )
                }
              />
              <SelectSheet
                visible={picking}
                title={lent ? 'Where did the money go?' : 'Paid from'}
                options={[
                  {
                    value: OUTSIDE,
                    label: 'Outside BUD',
                    subtitle: lent
                      ? 'Cash you don’t track — only what’s owed changes'
                      : 'Only what you owe changes',
                    icon: 'cash-outline',
                    color: colors.textSecondary,
                  },
                  ...accountOptions(accounts.data ?? []),
                ]}
                selected={target}
                onSelect={(v) => {
                  setTarget(v);
                  setPicking(false);
                }}
                onClose={() => setPicking(false)}
              />
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}
