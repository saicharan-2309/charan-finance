/**
 * Split a bill — the one shared-expense flow, however you got here:
 *   Add → Split a bill · a friend's profile · a chat · a group ·
 *   "Split this expense" on an existing transaction (e.g. one from an SMS).
 *
 * It answers three questions before anything is saved:
 *   Who paid?  Who's in?  How much is each person's share?
 * The shares must add up to the bill exactly (checked here and again by the
 * database). Your own spending becomes only your share; the rest is money
 * owed to you — or, if someone else paid, what you owe them.
 *
 * Params: friendId, groupId, transactionId (link an existing expense), editId.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';

import { Button, Chip, SegmentedControl, TextField } from '@/components/ui/controls';
import { DateTimeField, SelectField, SelectSheet } from '@/components/ui/pickers';
import { SkeletonList } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, Row, Text } from '@/components/ui/primitives';
import { Avatar } from '@/features/friends/Avatar';
import { accountOptions, categoryOptions, splitCategoryValue } from '@/features/shared/options';
import {
  useAccounts,
  useAppMutation,
  useCategoryIndex,
  useFriendships,
  usePeople,
  useProfile,
  useSharedExpense,
  useSplitGroups,
  useTransaction,
} from '@/hooks/data';
import { toISODate } from '@/lib/dates';
import { formatMoney, minorToInput, parseAmountInput, sanitizeAmountKeystrokes } from '@/lib/money';
import { splitBill, type SplitMethod } from '@/lib/splits';
import { useUserId } from '@/providers/AuthProvider';
import { createSharedExpense, updateSharedExpense } from '@/services/friends';
import type { SplitGroup } from '@/types/domain';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing, typography } from '@/theme/tokens';

type Method = Exclude<SplitMethod, 'items'>;

interface Initial {
  totalText: string;
  title: string;
  date: Date;
  categoryId: string | null;
  notes: string;
  paidBy: string;
  people: string[];
  method: Method;
  inputs: Record<string, string>;
}

/**
 * Loads what the form starts from — the friend or group you came from, the
 * payment being split, or the saved split being edited — then mounts the
 * form with it as its initial state.
 */
export default function SplitBill() {
  const params = useLocalSearchParams<{
    friendId?: string;
    groupId?: string;
    transactionId?: string;
    editId?: string;
  }>();
  const me = useUserId()!;
  const groups = useSplitGroups();
  const linked = useTransaction(params.transactionId);
  const editing = useSharedExpense(params.editId);

  const ready =
    (!params.groupId || groups.data !== undefined) &&
    (!params.transactionId || linked.data !== undefined) &&
    (!params.editId || editing.data !== undefined);
  if (!ready) {
    return (
      <Screen>
        <SkeletonList rows={5} />
      </Screen>
    );
  }

  const group = (groups.data ?? []).find((g) => g.id === params.groupId) ?? null;
  const t = linked.data;
  const e = editing.data;
  const initial: Initial = e
    ? {
        totalText: minorToInput(e.total),
        title: e.title,
        date: new Date(e.occurredOn),
        categoryId: null,
        notes: e.notes ?? '',
        paidBy: e.paidBy,
        people: e.shares.map((s) => s.userId),
        method: e.splitMethod === 'items' ? 'amount' : e.splitMethod,
        inputs: Object.fromEntries(
          e.shares.map((s) => [
            s.userId,
            e.splitMethod === 'amount' ? minorToInput(s.amount) : s.input !== null ? String(s.input) : '',
          ]),
        ),
      }
    : {
        // Converting an existing expense keeps its amount, place, date and category.
        totalText: t ? minorToInput(t.amount) : '',
        title: t ? (t.merchantName ?? t.categoryName ?? 'Shared expense') : '',
        date: t ? new Date(t.occurredAt) : new Date(),
        categoryId: t?.categoryId ?? null,
        notes: '',
        paidBy: me,
        people: group
          ? [me, ...group.memberIds.filter((u) => u !== me)]
          : params.friendId
            ? [me, params.friendId]
            : [me],
        method: 'equal',
        inputs: {},
      };
  return <SplitForm initial={initial} group={group} />;
}

function SplitForm({ initial, group }: { initial: Initial; group: SplitGroup | null }) {
  const params = useLocalSearchParams<{
    friendId?: string;
    groupId?: string;
    transactionId?: string;
    editId?: string;
  }>();
  const me = useUserId()!;
  const { colors } = useTheme();
  const profile = useProfile();
  const friendships = useFriendships();
  const accounts = useAccounts();
  const { index } = useCategoryIndex();
  const currency = profile.data?.defaultCurrency ?? 'INR';

  const friendIds = (friendships.data ?? []).filter((f) => f.status === 'accepted').map((f) => f.other.id);
  const groupPeople = usePeople(group ? group.memberIds : []);

  const [totalText, setTotalText] = useState(initial.totalText);
  const [title, setTitle] = useState(initial.title);
  const [date, setDate] = useState(initial.date);
  const [categoryId, setCategoryId] = useState<string | null>(initial.categoryId);
  const [notes, setNotes] = useState(initial.notes);
  const [paidBy, setPaidBy] = useState<string>(initial.paidBy);
  const [people, setPeople] = useState<string[]>(initial.people);
  const [method, setMethod] = useState<Method>(initial.method);
  const [inputs, setInputs] = useState<Record<string, string>>(initial.inputs);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [picking, setPicking] = useState<'category' | 'account' | null>(null);
  const pool = group ? group.memberIds : [me, ...friendIds];
  const names = usePeople(pool.filter((u) => u !== me));
  const nameOf = (u: string) =>
    u === me ? 'You' : (groupPeople.data?.get(u)?.name ?? names.data?.get(u)?.name ?? 'Friend');

  const total = parseAmountInput(totalText);
  const result = useMemo(() => {
    if (total === null || total <= 0) return null;
    return splitBill(
      total,
      method,
      people.map((u) => ({
        userId: u,
        value:
          method === 'amount'
            ? (parseAmountInput(inputs[u] ?? '') ?? 0)
            : method === 'equal'
              ? undefined
              : Number(inputs[u] ?? (method === 'shares' ? '1' : '0')) || 0,
      })),
    );
  }, [total, method, people, inputs]);

  const shareOf = (u: string) => (result?.ok ? (result.shares.find((s) => s.userId === u)?.amount ?? 0) : 0);
  const category = categoryId ? index.byId.get(splitCategoryValue(categoryId).categoryId) : null;
  const iPaid = paidBy === me;
  const needsAccount = iPaid && !params.transactionId && !params.editId;
  const canSave =
    !!result?.ok && title.trim().length > 0 && people.length >= 2 && (!needsAccount || !!accountId);

  const save = useAppMutation(
    async () => {
      if (!result?.ok || total === null) throw new Error('Check the split');
      const input = {
        groupId: group?.id ?? null,
        paidBy,
        title: title.trim(),
        categoryName: category?.name ?? null,
        icon: category?.icon ?? null,
        total,
        currency,
        occurredOn: toISODate(date),
        notes: notes.trim() || null,
        splitMethod: method,
        shares: result.shares.map((s) => ({ userId: s.userId, amount: s.amount, input: s.input })),
        payerAccountId: iPaid && !params.transactionId ? accountId : null,
        payerTransactionId: iPaid ? (params.transactionId ?? null) : null,
        payerCategoryId: category?.id ?? null,
      };
      if (params.editId) {
        await updateSharedExpense(params.editId, input);
        return params.editId;
      }
      return createSharedExpense(input);
    },
    {
      context: 'split.save',
      invalidate: 'financial',
      success: params.editId ? 'Split updated' : 'Split saved — everyone sees their share',
      onSuccess: (id) => router.replace({ pathname: '/shared/[id]', params: { id } }),
    },
  );

  const togglePerson = (u: string) => {
    if (u === me) return;
    setPeople((p) => (p.includes(u) ? p.filter((x) => x !== u) : [...p, u]));
    if (paidBy === u) setPaidBy(me);
  };

  return (
    <Screen
      footer={
        <View style={{ gap: spacing.sm }}>
          {result && !result.ok ? (
            <Text variant="footnote" tone="negative" align="center" accessibilityLiveRegion="polite">
              {result.error}
            </Text>
          ) : null}
          <Button
            title={params.editId ? 'Save changes' : 'Split it'}
            disabled={!canSave}
            loading={save.isPending}
            onPress={() => save.mutate(undefined)}
          />
        </View>
      }
    >
      <Stack.Screen options={{ title: params.editId ? 'Edit split' : 'Split a bill' }} />

      {/* Bill */}
      <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
        <Text variant="footnote" tone="secondary">
          {params.transactionId ? 'Splitting your payment' : 'Bill total'}
        </Text>
        <Row gap={2} align="center">
          <Text style={[typography.display, { color: colors.textSecondary }]}>₹</Text>
          <TextInput
            value={totalText}
            onChangeText={(t) => setTotalText(sanitizeAmountKeystrokes(t))}
            placeholder="0"
            keyboardType="decimal-pad"
            editable={!params.transactionId}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Bill total"
            style={[
              typography.display,
              { color: colors.text, minWidth: 80, maxWidth: 240, textAlign: 'center' },
            ]}
          />
        </Row>
        {params.transactionId ? (
          <Text variant="caption" tone="tertiary">
            The original payment is reused — nothing is added twice.
          </Text>
        ) : null}
      </View>

      <Card style={{ gap: spacing.md, marginBottom: spacing.xl }}>
        <TextField
          label="What was it?"
          value={title}
          onChangeText={setTitle}
          placeholder="Dinner at Absolute Barbecues"
          maxLength={80}
        />
        <SelectField
          label="Category"
          value={category?.name ?? null}
          placeholder="Choose a category"
          icon={category?.icon}
          color={category?.color}
          onPress={() => setPicking('category')}
        />
        <DateTimeField label="Date" value={date} onChange={setDate} maximumDate={new Date()} />
      </Card>

      {/* Who's in */}
      <Section title={group ? group.name : 'Who’s in?'}>
        <Row gap={spacing.sm} wrap>
          {pool.map((u) => (
            <Chip key={u} label={nameOf(u)} selected={people.includes(u)} onPress={() => togglePerson(u)} />
          ))}
        </Row>
        {!group && friendIds.length === 0 ? (
          <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
            Add friends first — Friends → Find friends.
          </Text>
        ) : null}
      </Section>

      {/* Who paid */}
      <Section title="Who paid?">
        <Row gap={spacing.sm} wrap>
          {people.map((u) => (
            <Chip key={u} label={nameOf(u)} selected={paidBy === u} onPress={() => setPaidBy(u)} />
          ))}
        </Row>
        {needsAccount ? (
          <View style={{ marginTop: spacing.md }}>
            <SelectField
              label="Paid from"
              value={(accounts.data ?? []).find((a) => a.id === accountId)?.name ?? null}
              placeholder="Choose the account you paid with"
              onPress={() => setPicking('account')}
            />
          </View>
        ) : null}
        {!iPaid ? (
          <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
            {nameOf(paidBy)} will be asked to add the payment to their own accounts.
          </Text>
        ) : null}
      </Section>

      {/* How */}
      <Section title="How to split">
        <SegmentedControl<Method>
          value={method}
          onChange={setMethod}
          style={{ marginBottom: spacing.md }}
          options={[
            { value: 'equal', label: 'Equally' },
            { value: 'amount', label: 'Amounts' },
            { value: 'percent', label: '%' },
            { value: 'shares', label: 'Shares' },
          ]}
        />
        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
          {people.map((u, i) => (
            <View key={u}>
              {i > 0 ? <Divider inset={52} /> : null}
              <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                <Avatar
                  name={nameOf(u) === 'You' ? (profile.data?.displayName ?? 'You') : nameOf(u)}
                  size={40}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{nameOf(u)}</Text>
                  <Text variant="footnote" tone="secondary">
                    {paidBy === u ? 'Paid the bill' : 'Owes ' + nameOf(paidBy).replace(/^You$/, 'you')}
                  </Text>
                </View>
                {method !== 'equal' ? (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: colors.fill,
                      borderRadius: radius.sm,
                      paddingHorizontal: spacing.sm,
                      minWidth: 72,
                    }}
                  >
                    {method === 'amount' ? <Text tone="secondary">₹</Text> : null}
                    <TextInput
                      value={inputs[u] ?? ''}
                      onChangeText={(t) =>
                        setInputs((m) => ({
                          ...m,
                          [u]: method === 'shares' ? t.replace(/[^0-9]/g, '') : sanitizeAmountKeystrokes(t),
                        }))
                      }
                      placeholder={method === 'shares' ? '1' : '0'}
                      keyboardType={method === 'shares' ? 'number-pad' : 'decimal-pad'}
                      placeholderTextColor={colors.textTertiary}
                      accessibilityLabel={`${nameOf(u)} ${method === 'percent' ? 'percent' : method}`}
                      style={[
                        typography.amount,
                        { color: colors.text, paddingVertical: 8, flex: 1, textAlign: 'right' },
                      ]}
                    />
                    {method === 'percent' ? <Text tone="secondary">%</Text> : null}
                  </View>
                ) : null}
                <Text style={[typography.amount, { minWidth: 76, textAlign: 'right', fontWeight: '700' }]}>
                  {formatMoney(shareOf(u), currency, { decimals: 'auto' })}
                </Text>
              </Row>
            </View>
          ))}
        </Card>
      </Section>

      {/* Plain-language outcome */}
      {result?.ok && total !== null ? (
        <Card variant="muted" style={{ gap: spacing.xs, marginBottom: spacing.xl }}>
          <Text variant="bodyStrong">
            {nameOf(paidBy)} paid {formatMoney(total, currency)}
          </Text>
          {people
            .filter((u) => u !== paidBy && shareOf(u) > 0)
            .map((u) => (
              <Text key={u} variant="callout" tone="secondary">
                {nameOf(u)} {u === me ? 'owe' : 'owes'} {nameOf(paidBy).replace(/^You$/, 'you')}{' '}
                {formatMoney(shareOf(u), currency)}
              </Text>
            ))}
          {people.includes(me) ? (
            <Text variant="footnote" tone="tertiary" style={{ marginTop: spacing.xs }}>
              Your spending counts only your share: {formatMoney(shareOf(me), currency)}.
            </Text>
          ) : null}
        </Card>
      ) : null}

      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} maxLength={500} multiline />

      <SelectSheet
        visible={picking === 'category'}
        title="Category"
        searchable
        options={categoryOptions(index, 'expense').filter((o) => !o.depth)}
        selected={categoryId}
        onSelect={(v) => {
          setCategoryId(v);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
      <SelectSheet
        visible={picking === 'account'}
        title="Paid from"
        options={accountOptions(accounts.data ?? [])}
        selected={accountId}
        onSelect={(v) => {
          setAccountId(v);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </Screen>
  );
}
