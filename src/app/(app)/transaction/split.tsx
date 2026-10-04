/**
 * Split one payment across categories — a ₹2,400 supermarket bill that was
 * ₹1,900 of groceries and ₹500 of household things. The parts must add up to
 * the exact amount; the account balance never moves.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, TextField } from '@/components/ui/controls';
import { QueryState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { SelectField, SelectSheet } from '@/components/ui/pickers';
import { Card, Icon, MoneyText, Row, Text } from '@/components/ui/primitives';
import { categoryLabel, categoryOptions, splitCategoryValue } from '@/features/shared/options';
import { transactionTitle } from '@/features/transactions/TransactionRow';
import { useAppMutation, useCategoryIndex, useTransaction } from '@/hooks/data';
import { formatMoney, minorToInput, parseAmountInput, type Minor } from '@/lib/money';
import { splitTransaction } from '@/services/bank-sync';
import { spacing } from '@/theme/tokens';
import type { Transaction } from '@/types/domain';

interface Part {
  key: number;
  amount: string;
  category: string | null;
}

export default function SplitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useTransaction(id);
  return (
    <Screen>
      <QueryState query={q}>{(t) => (t ? <SplitForm t={t} /> : null)}</QueryState>
    </Screen>
  );
}

function SplitForm({ t }: { t: Transaction }) {
  const { index } = useCategoryIndex();
  const kind = t.type === 'income' ? 'income' : 'expense';
  const original = t.categoryId
    ? t.subcategoryId
      ? `${t.categoryId}:${t.subcategoryId}`
      : t.categoryId
    : null;
  const [parts, setParts] = useState<Part[]>([
    { key: 1, amount: minorToInput(t.amount), category: original },
    { key: 2, amount: '', category: null },
  ]);
  const [picking, setPicking] = useState<number | null>(null);

  const amounts = parts.map((p) => parseAmountInput(p.amount) ?? 0);
  const used = amounts.reduce((s, a) => s + a, 0);
  const remaining = (t.amount - used) as Minor;
  const valid = remaining === 0 && parts.every((p, i) => amounts[i] > 0 && p.category) && parts.length >= 2;

  const save = useAppMutation(
    () =>
      splitTransaction(
        t.id,
        parts.map((p, i) => ({ amount: amounts[i] as Minor, ...splitCategoryValue(p.category!) })),
      ),
    {
      context: 'transaction.split',
      invalidate: 'financial',
      success: `Split into ${parts.length}`,
      onSuccess: () => router.back(),
    },
  );

  const update = (key: number, patch: Partial<Part>) =>
    setParts((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  return (
    <View style={{ gap: spacing.lg }}>
      <Card style={{ gap: 2 }}>
        <Text variant="footnote" tone="secondary">
          {transactionTitle(t)}, {t.accountName}
        </Text>
        <MoneyText minor={t.amount} currency={t.currency} variant="amountLarge" />
      </Card>

      {parts.map((p, i) => {
        const value = p.category ? splitCategoryValue(p.category) : null;
        const cat = value ? index.byId.get(value.subcategoryId ?? value.categoryId) : null;
        return (
          <Card key={p.key} style={{ gap: spacing.md }}>
            <Row justify="space-between">
              <Text variant="bodyStrong">Part {i + 1}</Text>
              {parts.length > 2 ? (
                <Pressable
                  onPress={() => setParts((ps) => ps.filter((x) => x.key !== p.key))}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove part ${i + 1}`}
                >
                  <Icon name="trash-outline" size={18} tone="negative" />
                </Pressable>
              ) : null}
            </Row>
            <TextField
              label="Amount"
              value={p.amount}
              onChangeText={(v) => update(p.key, { amount: v })}
              keyboardType="decimal-pad"
              placeholder="0"
            />
            <SelectField
              label="Category"
              value={value ? categoryLabel(index, value.categoryId, value.subcategoryId) : null}
              icon={cat?.icon}
              color={cat?.color}
              placeholder="Choose a category"
              onPress={() => setPicking(p.key)}
            />
          </Card>
        );
      })}

      {parts.length < 10 ? (
        <Button
          title="Add another part"
          variant="ghost"
          icon="add"
          onPress={() =>
            setParts((ps) => [
              ...ps,
              {
                key: Math.max(...ps.map((x) => x.key)) + 1,
                amount: remaining > 0 ? minorToInput(remaining) : '',
                category: null,
              },
            ])
          }
        />
      ) : null}

      <Text variant="callout" tone={remaining === 0 ? 'positive' : 'warning'} align="center">
        {remaining === 0
          ? 'Adds up exactly'
          : remaining > 0
            ? `${formatMoney(remaining, t.currency)} still to assign`
            : `${formatMoney(-remaining, t.currency)} too much`}
      </Text>

      <Button
        title="Split"
        disabled={!valid}
        loading={save.isPending}
        onPress={() => save.mutate(undefined)}
      />

      <SelectSheet
        visible={picking !== null}
        title="Category"
        searchable
        options={categoryOptions(index, kind)}
        selected={parts.find((p) => p.key === picking)?.category ?? null}
        onSelect={(v) => {
          if (picking !== null) update(picking, { category: v });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </View>
  );
}
