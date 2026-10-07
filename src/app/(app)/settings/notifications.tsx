import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';

import { Button, Chip, SwitchRow } from '@/components/ui/controls';
import { QueryState, useToast } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, Text } from '@/components/ui/primitives';
import { useAppMutation, useGoals, useRecurring, useSettings } from '@/hooks/data';
import { getPermissionStatus, requestPermission, rescheduleReminders } from '@/lib/notifications';
import { qk } from '@/lib/query';
import { useUserId } from '@/providers/AuthProvider';
import { updateSettings } from '@/services/core';
import { spacing } from '@/theme/tokens';
import type { AppSettings } from '@/types/domain';

export default function NotificationSettings() {
  const userId = useUserId();
  const toast = useToast();
  const settings = useSettings();
  const recurring = useRecurring();
  const goals = useGoals();
  const [permission, setPermission] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');

  useEffect(() => {
    void getPermissionStatus().then(setPermission);
  }, []);

  const update = useAppMutation(
    async (patch: Partial<AppSettings>) => {
      await updateSettings(userId, patch);
      const next = { ...settings.data!, ...patch };
      await rescheduleReminders({ settings: next, recurring: recurring.data ?? [], goals: goals.data ?? [] });
    },
    { invalidate: [qk.settings], context: 'notification-settings' },
  );

  const enable = async () => {
    const ok = await requestPermission();
    setPermission(ok ? 'granted' : await getPermissionStatus());
    if (ok && settings.data) {
      const n = await rescheduleReminders({
        settings: settings.data,
        recurring: recurring.data ?? [],
        goals: goals.data ?? [],
      });
      toast.show(`Notifications on · ${n} reminder${n === 1 ? '' : 's'} scheduled`);
    }
  };

  return (
    <Screen>
      {permission !== 'granted' ? (
        <Card variant="muted" style={{ gap: spacing.md, marginBottom: spacing.xxl }}>
          <Text variant="bodyStrong">Notifications are off</Text>
          <Text variant="footnote" tone="secondary">
            {permission === 'denied'
              ? 'Turn on notifications for BUD in iPhone Settings to receive reminders.'
              : 'Allow notifications to get reminders before bills and renewals.'}
          </Text>
          {permission === 'denied' ? (
            <Button
              title="Open Settings"
              variant="secondary"
              size="md"
              onPress={() => void Linking.openSettings()}
            />
          ) : (
            <Button title="Allow notifications" size="md" onPress={() => void enable()} />
          )}
        </Card>
      ) : null}
      <QueryState query={settings}>
        {(s) => (
          <>
            <Card style={{ paddingVertical: spacing.xs }}>
              <SwitchRow
                title="Upcoming bills"
                subtitle="Before rent, bills and other recurring payments."
                value={s.notifyUpcomingBills}
                onValueChange={(v) => update.mutate({ notifyUpcomingBills: v })}
              />
              <Divider />
              <SwitchRow
                title="Subscription renewals"
                value={s.notifySubscriptionRenewals}
                onValueChange={(v) => update.mutate({ notifySubscriptionRenewals: v })}
              />
              <Divider />
              <SwitchRow
                title="Budget alerts"
                subtitle={`Once when a budget passes ${s.budgetWarningPercent}% and once if it's exceeded.`}
                value={s.notifyBudgetWarnings}
                onValueChange={(v) => update.mutate({ notifyBudgetWarnings: v })}
              />
              <Divider />
              <SwitchRow
                title="Savings goal check-in"
                subtitle="Monthly, on the 25th."
                value={s.notifyGoalReminders}
                onValueChange={(v) => update.mutate({ notifyGoalReminders: v })}
              />
              <Divider />
              <SwitchRow
                title="Monthly summary"
                subtitle="On the 1st of each month."
                value={s.notifyMonthlySummary}
                onValueChange={(v) => update.mutate({ notifyMonthlySummary: v })}
              />
            </Card>
            <Section title="Friends" style={{ marginTop: spacing.xxl }}>
              <Card style={{ paddingVertical: spacing.xs }}>
                <SwitchRow
                  title="Friend requests"
                  subtitle="When someone adds you or accepts your request."
                  value={s.notifyFriendRequests}
                  onValueChange={(v) => update.mutate({ notifyFriendRequests: v })}
                />
                <Divider />
                <SwitchRow
                  title="Messages"
                  value={s.notifyMessages}
                  onValueChange={(v) => update.mutate({ notifyMessages: v })}
                />
                <Divider />
                <SwitchRow
                  title="Shared expenses"
                  subtitle="Added to a split, or a split you’re in changes."
                  value={s.notifySharedExpenses}
                  onValueChange={(v) => update.mutate({ notifySharedExpenses: v })}
                />
                <Divider />
                <SwitchRow
                  title="Payments"
                  subtitle="When someone pays you back or records a payment."
                  value={s.notifySettlements}
                  onValueChange={(v) => update.mutate({ notifySettlements: v })}
                />
                <Divider />
                <SwitchRow
                  title="Reminders"
                  subtitle="A friend’s gentle nudge about what’s owed."
                  value={s.notifyReminders}
                  onValueChange={(v) => update.mutate({ notifyReminders: v })}
                />
              </Card>
            </Section>
            <Section title="Budget alert threshold">
              <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
                {[70, 80, 90, 100].map((p) => (
                  <Chip
                    key={p}
                    label={`${p}%`}
                    selected={s.budgetWarningPercent === p}
                    onPress={() => update.mutate({ budgetWarningPercent: p })}
                  />
                ))}
              </View>
            </Section>
            <Text variant="footnote" tone="secondary">
              Reminders are scheduled on this iPhone from your own data. Amounts are never shown on the lock
              screen.
            </Text>
          </>
        )}
      </QueryState>
    </Screen>
  );
}
