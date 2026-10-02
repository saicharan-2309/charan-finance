import { useState } from 'react';
import { Alert, View } from 'react-native';

import { Button, SwitchRow, TextField } from '@/components/ui/controls';
import { useToast } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Text } from '@/components/ui/primitives';
import { describeError } from '@/lib/errors';
import { useAppLock } from '@/providers/AppLockProvider';
import { useAuth } from '@/providers/AuthProvider';
import { deleteMyAccount, sendPasswordReset } from '@/services/auth';
import { verifyBalances } from '@/services/reports';
import { spacing } from '@/theme/tokens';

export default function SecuritySettings() {
  const toast = useToast();
  const { user } = useAuth();
  const lock = useAppLock();
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [checking, setChecking] = useState(false);

  const toggleLock = async (v: boolean) => {
    const ok = await lock.setEnabled(v);
    if (!ok) toast.show('Authentication was cancelled.', 'info');
  };

  const removeAccount = () =>
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your account, all transactions, accounts, budgets, goals and receipts. This cannot be undone. Export your data first if you want a copy.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteMyAccount();
            } catch (e) {
              toast.show(describeError(e).message, 'error');
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );

  return (
    <Screen>
      <Section title="App lock">
        <Card style={{ paddingVertical: spacing.xs }}>
          <SwitchRow
            title={`Require ${lock.biometryLabel}`}
            subtitle={
              lock.available
                ? 'Locks when the app goes to the background. Your device passcode works as a fallback.'
                : 'Set up Face ID, Touch ID or a passcode on this iPhone to use app lock.'
            }
            value={lock.enabled}
            disabled={!lock.available}
            onValueChange={(v) => void toggleLock(v)}
          />
        </Card>
        <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
          Your screen is hidden in the app switcher whether or not app lock is on.
        </Text>
      </Section>

      <Section title="Password">
        <Button
          title="Send password reset email"
          variant="secondary"
          onPress={async () => {
            try {
              if (user?.email) await sendPasswordReset(user.email);
              toast.show('Reset link sent to your email');
            } catch (e) {
              toast.show(describeError(e).message, 'error');
            }
          }}
        />
      </Section>

      <Section title="Data integrity">
        <Button
          title="Verify account balances"
          variant="secondary"
          loading={checking}
          onPress={async () => {
            setChecking(true);
            try {
              const r = await verifyBalances();
              toast.show(
                r.consistent
                  ? `All ${r.checked} account balances match their transactions`
                  : 'A balance mismatch was found — please contact support',
                r.consistent ? 'success' : 'error',
              );
            } catch (e) {
              toast.show(describeError(e).message, 'error');
            } finally {
              setChecking(false);
            }
          }}
        />
        <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
          Recomputes every balance from the opening balance plus all transactions on the server and compares.
        </Text>
      </Section>

      <Section title="What we store">
        <Card variant="muted" style={{ gap: spacing.xs }}>
          <Text variant="footnote" tone="secondary">
            • Your data is isolated by Row Level Security in the database — no other user can read it.{'\n'}•
            Your session is kept in the iOS Keychain.{'\n'}• Charan Finance never asks for or stores bank
            passwords, UPI PINs, card numbers or CVVs — only an optional last four digits.
          </Text>
        </Card>
      </Section>

      <Section title="Delete account">
        <View style={{ gap: spacing.md }}>
          <TextField
            label='Type "DELETE" to confirm'
            value={confirmText}
            onChangeText={setConfirmText}
            autoCapitalize="characters"
          />
          <Button
            title="Delete my account"
            variant="destructive"
            disabled={confirmText !== 'DELETE'}
            loading={deleting}
            onPress={removeAccount}
          />
        </View>
      </Section>
    </Screen>
  );
}
