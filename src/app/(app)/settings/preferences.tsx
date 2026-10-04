import { useState } from 'react';
import { View } from 'react-native';

import { Button, Chip, TextField } from '@/components/ui/controls';
import { QueryState } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Row, Text } from '@/components/ui/primitives';
import { CURRENCIES } from '@/features/shared/ColorPicker';
import { useAppMutation, useProfile, useSettings } from '@/hooks/data';
import { deviceTimeZone } from '@/lib/dates';
import { useUserId } from '@/providers/AuthProvider';
import { qk } from '@/lib/query';
import { updateProfile, updateSettings } from '@/services/core';
import { spacing } from '@/theme/tokens';
import type { Profile } from '@/types/domain';

export default function PreferencesScreen() {
  const profile = useProfile();
  return (
    <Screen>
      <QueryState query={profile}>{(p) => <Form profile={p} />}</QueryState>
    </Screen>
  );
}

function Form({ profile }: { profile: Profile }) {
  const userId = useUserId();
  const [name, setName] = useState(profile.displayName ?? '');
  const [currency, setCurrency] = useState(profile.defaultCurrency);
  const save = useAppMutation(
    () => updateProfile(userId, { displayName: name.trim() || null, defaultCurrency: currency }),
    {
      invalidate: 'financial',
      success: 'Preferences saved',
      context: 'preferences',
    },
  );
  // Profile changes affect reports/dashboard, which also read the profile.
  return (
    <>
      <TextField label="Your name" value={name} onChangeText={setName} maxLength={80} />
      <Section title="Default currency" style={{ marginTop: spacing.xxl }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {CURRENCIES.map((c) => (
            <Chip key={c} label={c} selected={currency === c} onPress={() => setCurrency(c)} />
          ))}
        </View>
        <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
          Dashboard, reports, budgets and net worth use this currency. Accounts in other currencies are shown
          separately — no exchange rates are assumed.
        </Text>
      </Section>
      <PaydaySection />
      <Section title="Region">
        <Card>
          <Row justify="space-between">
            <Text>Time zone</Text>
            <Text tone="secondary">{profile.timezone}</Text>
          </Row>
          {profile.timezone !== deviceTimeZone() ? (
            <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
              Updates to {deviceTimeZone()} automatically next time the app starts.
            </Text>
          ) : (
            <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
              Follows this iPhone. Used to decide which day a transaction belongs to in reports.
            </Text>
          )}
        </Card>
      </Section>
      <Button title="Save" onPress={() => save.mutate(undefined)} loading={save.isPending} />
    </>
  );
}

/** The money month: when the user is paid, the app's "this month" starts. */
function PaydaySection() {
  const userId = useUserId();
  const settings = useSettings();
  const current = settings.data?.cycleStartDay ?? 1;
  const save = useAppMutation((day: number) => updateSettings(userId, { cycleStartDay: day }), {
    context: 'preferences.payday',
    invalidate: [qk.settings, ['dashboard'], ['budget-status']],
  });
  const days = Array.from({ length: 28 }, (_, i) => i + 1);
  return (
    <Section title="Your money month">
      <Card style={{ gap: spacing.md }}>
        <Text variant="footnote" tone="secondary">
          Pick the day your salary usually arrives. Home, budgets and “safe to spend” then run payday to
          payday instead of the 1st to the 31st.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {days.map((d) => (
            <Chip
              key={d}
              label={d === 1 ? '1st' : String(d)}
              selected={current === d}
              onPress={() => save.mutate(d)}
            />
          ))}
        </View>
        <Text variant="footnote">
          {current === 1
            ? 'Using calendar months.'
            : `Each month runs from the ${ordinal(current)} to the ${ordinal(current - 1)} of the next month.`}
        </Text>
      </Card>
    </Section>
  );
}

function ordinal(n: number): string {
  const s =
    n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  return `${n}${s}`;
}
