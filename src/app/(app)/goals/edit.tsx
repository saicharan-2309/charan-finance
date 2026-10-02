import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, SwitchRow, TextField } from '@/components/ui/controls';
import { SkeletonList } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { DateTimeField, SelectField, SelectSheet } from '@/components/ui/pickers';
import { Card, Text } from '@/components/ui/primitives';
import { ColorPicker, IconPicker } from '@/features/shared/ColorPicker';
import { useAccounts, useAppMutation, useCurrency, useGoals } from '@/hooks/data';
import { fromISODate, toISODate } from '@/lib/dates';
import { minorToInput, parseAmountInput, sanitizeAmountKeystrokes, type Minor } from '@/lib/money';
import { createGoal, updateGoal } from '@/services/planning';
import { spacing } from '@/theme/tokens';
import type { Goal } from '@/types/domain';

export default function GoalEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const goals = useGoals();
  if (id && !goals.data)
    return (
      <Screen>
        <SkeletonList rows={4} />
      </Screen>
    );
  return <GoalForm existing={id ? (goals.data?.find((g) => g.id === id) ?? null) : null} />;
}

function GoalForm({ existing }: { existing: Goal | null }) {
  const currency = useCurrency();
  const accounts = useAccounts().data ?? [];
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [target, setTarget] = useState(existing ? minorToInput(existing.targetAmount) : '');
  const [initial, setInitial] = useState(existing ? minorToInput(existing.initialAmount) : '');
  const [hasDate, setHasDate] = useState(!!existing?.targetDate || !existing);
  const [date, setDate] = useState<Date>(() =>
    existing?.targetDate ? fromISODate(existing.targetDate) : new Date(Date.now() + 180 * 86400000),
  );
  const [today] = useState(() => new Date());
  const [accountId, setAccountId] = useState<string | null>(existing?.accountId ?? null);
  const [icon, setIcon] = useState<string | null>(existing?.icon ?? 'flag-outline');
  const [color, setColor] = useState<string | null>(existing?.color ?? '#16A34A');
  const [picker, setPicker] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const save = useAppMutation(
    () => {
      const input = {
        name,
        description: description || null,
        targetAmount: parseAmountInput(target)!,
        initialAmount: (parseAmountInput(initial) ?? 0) as Minor,
        currency: existing?.currency ?? currency,
        targetDate: hasDate ? toISODate(date) : null,
        accountId,
        icon,
        color,
      };
      return existing ? updateGoal(existing.id, input) : createGoal(input);
    },
    {
      invalidate: 'financial',
      success: existing ? 'Goal updated' : 'Goal created',
      onSuccess: () => router.back(),
      context: 'save-goal',
    },
  );

  const submit = () => {
    const t = parseAmountInput(target);
    const next = {
      name: name.trim() ? null : 'Name your goal.',
      target: t && t > 0 ? null : 'Enter a target amount.',
      initial: initial && parseAmountInput(initial) === null ? 'Enter a valid amount.' : null,
    };
    setErrors(next);
    if (!Object.values(next).some(Boolean)) save.mutate(undefined);
  };

  const account = accounts.find((a) => a.id === accountId);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: existing ? 'Edit goal' : 'New goal',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <Text tone="secondary">Cancel</Text>
            </Pressable>
          ),
        }}
      />
      <View style={{ gap: spacing.lg }}>
        <TextField
          label="Goal"
          value={name}
          onChangeText={setName}
          placeholder="e.g. MacBook"
          maxLength={60}
          error={errors.name}
        />
        <TextField
          label="Target amount"
          value={target}
          onChangeText={(v) => setTarget(sanitizeAmountKeystrokes(v))}
          keyboardType="decimal-pad"
          placeholder="120000"
          error={errors.target}
        />
        <TextField
          label={existing ? 'Starting amount' : 'Already saved (optional)'}
          value={initial}
          onChangeText={(v) => setInitial(sanitizeAmountKeystrokes(v))}
          keyboardType="decimal-pad"
          placeholder="0"
          error={errors.initial}
          helper="Later additions and withdrawals are recorded on the goal screen."
        />
        <Card style={{ paddingVertical: spacing.xs }}>
          <SwitchRow title="Target date" value={hasDate} onValueChange={setHasDate} />
          {hasDate ? (
            <DateTimeField label="Reach by" value={date} onChange={setDate} minimumDate={today} />
          ) : null}
        </Card>
        <SelectField
          label="Linked account (optional)"
          value={account?.name ?? null}
          placeholder="None"
          onPress={() => setPicker(true)}
        />
        <TextField
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={500}
        />
      </View>
      <Section title="Colour" style={{ marginTop: spacing.xxl }}>
        <ColorPicker value={color} onChange={setColor} />
      </Section>
      <Section title="Icon">
        <IconPicker value={icon} color={color} onChange={setIcon} />
      </Section>
      <Button title={existing ? 'Save changes' : 'Create goal'} onPress={submit} loading={save.isPending} />
      <SelectSheet
        visible={picker}
        title="Linked account"
        noneLabel="None"
        options={accounts.filter((a) => a.isActive).map((a) => ({ value: a.id, label: a.name }))}
        selected={accountId}
        onSelect={setAccountId}
        onClose={() => setPicker(false)}
      />
    </Screen>
  );
}
