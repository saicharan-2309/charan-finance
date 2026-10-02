import { useState } from 'react';
import { View } from 'react-native';

import { Button, Chip, TextField } from '@/components/ui/controls';
import { QueryState } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Row, Text } from '@/components/ui/primitives';
import { CURRENCIES } from '@/features/shared/ColorPicker';
import { useAppMutation, useProfile } from '@/hooks/data';
import { deviceTimeZone } from '@/lib/dates';
import { useUserId } from '@/providers/AuthProvider';
import { updateProfile } from '@/services/core';
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
