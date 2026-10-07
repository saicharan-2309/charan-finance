import { useState } from 'react';
import { Alert, View } from 'react-native';

import { Button, ListRow, SwitchRow, TextField } from '@/components/ui/controls';
import { useToast } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, Text } from '@/components/ui/primitives';
import { PasscodeSheet, type PasscodeSheetMode } from '@/features/security/PasscodeSheet';
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

  const [sheet, setSheet] = useState<PasscodeSheetMode | null>(null);

  const toggleFaceId = async (v: boolean) => {
    const ok = await lock.setBiometricsEnabled(v);
    if (!ok) toast.show('Authentication was cancelled.', 'info');
  };

  // Face ID can't run inside Expo Go (an iOS rule), so say exactly what happens.
  const faceIdSubtitle = !lock.available
    ? 'Set up Face ID or a passcode on this iPhone first.'
    : lock.faceIdNeedsInstalledApp
      ? 'In Expo Go, iOS shows your iPhone passcode instead. Face ID itself works in the installed app.'
      : `Unlock with ${lock.biometryLabel}. Your iPhone passcode works as a fallback.`;

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
            title={lock.biometryLabel === 'Touch ID' ? 'Touch ID' : 'Face ID'}
            subtitle={faceIdSubtitle}
            value={lock.biometricsEnabled}
            disabled={!lock.available}
            onValueChange={(v) => void toggleFaceId(v)}
          />
          <Divider />
          <SwitchRow
            title="App passcode"
            subtitle="A 6-digit code just for Charan Finance. Works everywhere, Expo Go included."
            value={lock.passcodeEnabled}
            onValueChange={(v) => setSheet(v ? 'create' : 'remove')}
          />
          {lock.passcodeEnabled ? (
            <>
              <Divider />
              <ListRow title="Change passcode" onPress={() => setSheet('change')} />
            </>
          ) : null}
        </Card>
        <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
          {lock.enabled
            ? lock.biometricsEnabled && lock.passcodeEnabled
              ? 'The app locks when it goes to the background. Face ID is offered first; the passcode always works too.'
              : 'The app locks when it goes to the background.'
            : 'Turn on either one — or both — to lock the app when it goes to the background.'}{' '}
          Your screen is hidden in the app switcher either way. Only a salted hash of the passcode is kept, in
          the iOS Keychain on this iPhone; after five wrong tries entry pauses for longer each time.
        </Text>
      </Section>

      <PasscodeSheet
        mode={sheet}
        onClose={() => setSheet(null)}
        onDone={(message) => {
          setSheet(null);
          toast.show(message);
        }}
      />

      <Section title="Account password">
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
