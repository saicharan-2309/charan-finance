/**
 * Add money you lent or borrowed. The one question that matters is where the
 * money moved: "before BUD" changes no balance (it's only tracked as owed);
 * "from / into one of my accounts" moves it on that account now. Neither is
 * ever spending or income.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, SegmentedControl, TextField, haptic } from '@/components/ui/controls';
import { Screen } from '@/components/ui/layout';
import { DateTimeField, SelectField, SelectSheet } from '@/components/ui/pickers';
import { Card, Icon, Row, Text } from '@/components/ui/primitives';
import { accountOptions } from '@/features/shared/options';
import { useAccounts, useAppMutation } from '@/hooks/data';
import { toISODate } from '@/lib/dates';
import { parseAmountInput } from '@/lib/money';
import { createIou } from '@/services/lending';
import { useTheme } from '@/theme/ThemeProvider';
import { continuous, radius, spacing } from '@/theme/tokens';

export default function NewIouScreen() {
  const { colors } = useTheme();
  const accounts = useAccounts();
  const [direction, setDirection] = useState<'lent' | 'borrowed'>('lent');
  const [person, setPerson] = useState('');
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState(new Date());
  const [where, setWhere] = useState<'before' | 'account'>('before');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const save = useAppMutation(createIou, {
    context: 'lending.create',
    invalidate: 'financial',
    success:
      direction === 'lent'
        ? 'Saved — you’ll see what they still owe.'
        : 'Saved — you’ll see what you still owe.',
    onSuccess: () => router.back(),
  });
  const options = accountOptions(accounts.data ?? []);
  const account = (accounts.data ?? []).find((a) => a.id === accountId) ?? null;
  const lent = direction === 'lent';

  const submit = () => {
    const amount = parseAmountInput(amountText);
    const next = {
      person: person.trim() ? null : 'Who was it?',
      amount: amount && amount > 0 ? null : 'Enter the amount',
      account: where === 'account' && !accountId ? 'Choose the account' : null,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean) || !amount) {
      haptic.error();
      return;
    }
    save.mutate({
      direction,
      person,
      amount,
      occurredOn: toISODate(date),
      note: note.trim() || null,
      accountId: where === 'account' ? accountId : null,
    });
  };

  const choice = (key: 'before' | 'account', title: string, body: string, icon: string) => {
    const on = where === key;
    return (
      <Pressable
        onPress={() => setWhere(key)}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        style={{
          flexDirection: 'row',
          gap: spacing.md,
          padding: spacing.lg,
          borderRadius: radius.lg,
          ...continuous,
          borderWidth: on ? 2 : 1,
          borderColor: on ? colors.brand : colors.border,
          backgroundColor: on ? colors.brandSoft : colors.surface,
        }}
      >
        <Icon name={icon} size={22} tone={on ? 'brand' : 'secondary'} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="footnote" tone="secondary">
            {body}
          </Text>
        </View>
        <Icon name={on ? 'radio-button-on' : 'radio-button-off'} size={20} tone={on ? 'brand' : 'tertiary'} />
      </Pressable>
    );
  };

  return (
    <Screen>
      <View style={{ gap: spacing.lg }}>
        <SegmentedControl
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'lent', label: 'I lent money' },
            { value: 'borrowed', label: 'I borrowed money' },
          ]}
        />
        <TextField
          label={lent ? 'Who did you lend to?' : 'Who did you borrow from?'}
          value={person}
          onChangeText={setPerson}
          placeholder="Name"
          autoCapitalize="words"
          error={errors.person}
        />
        <TextField
          label="Amount"
          value={amountText}
          onChangeText={setAmountText}
          placeholder="0"
          keyboardType="decimal-pad"
          leading={<Text variant="bodyStrong">₹</Text>}
          error={errors.amount}
        />
        <DateTimeField label="When" value={date} onChange={setDate} maximumDate={new Date()} />

        <Text variant="subhead" tone="secondary" style={{ marginTop: spacing.sm }}>
          {lent ? 'Where did the money come from?' : 'Where did the money go?'}
        </Text>
        {choice(
          'before',
          'Before I used BUD',
          'Only tracked as owed — none of your balances change.',
          'time-outline',
        )}
        {choice(
          'account',
          lent ? 'From one of my accounts' : 'Into one of my accounts',
          lent
            ? 'The money leaves that account now. It isn’t counted as spending.'
            : 'The money arrives in that account now. It isn’t counted as income.',
          'wallet-outline',
        )}
        {where === 'account' ? (
          <SelectField
            label="Account"
            value={account?.name ?? null}
            placeholder="Choose an account"
            color={account?.color}
            onPress={() => setPicking(true)}
            error={errors.account}
          />
        ) : null}

        <TextField
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="What it was for"
        />

        <Card style={{ backgroundColor: colors.surfaceMuted }}>
          <Row gap={spacing.sm} align="flex-start">
            <Icon name="information-circle-outline" size={18} tone="secondary" />
            <Text variant="footnote" tone="secondary" style={{ flex: 1 }}>
              When they pay you back (or you pay back), record it from this loan — in full or in part.
            </Text>
          </Row>
        </Card>

        <Button title="Save" loading={save.isPending} onPress={submit} />
      </View>

      <SelectSheet
        visible={picking}
        title="Account"
        options={options}
        selected={accountId}
        onSelect={(v) => {
          setAccountId(v);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </Screen>
  );
}
