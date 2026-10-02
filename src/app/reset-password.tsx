import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button, TextField } from '@/components/ui/controls';
import { EmptyState, SkeletonList, useToast } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Text } from '@/components/ui/primitives';
import { describeError } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { exchangeCode, updatePassword, validatePassword } from '@/services/auth';
import { spacing } from '@/theme/tokens';

/**
 * Landing screen for the password-reset email link
 * (charanfinance://reset-password?code=…, PKCE flow).
 */
export default function ResetPassword() {
  const { code, error_description } = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const { session, clearRecovery } = useAuth();
  const toast = useToast();
  const [stage, setStage] = useState<'exchanging' | 'form' | 'invalid'>(
    code ? 'exchanging' : session ? 'form' : 'invalid',
  );
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!code) return;
    exchangeCode(code)
      .then(() => setStage('form'))
      .catch(() => setStage('invalid'));
  }, [code]);

  const submit = async () => {
    const v = validatePassword(password);
    if (v) return setError(v);
    if (password !== confirm) return setError("Passwords don't match.");
    setLoading(true);
    try {
      await updatePassword(password);
      clearRecovery();
      toast.show('Password updated');
      router.replace('/');
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setLoading(false);
    }
  };

  if (stage === 'exchanging') {
    return (
      <Screen safeTop>
        <SkeletonList rows={2} />
      </Screen>
    );
  }

  if (stage === 'invalid') {
    return (
      <Screen safeTop>
        <EmptyState
          icon="link-outline"
          title="Link expired"
          message={
            error_description
              ? 'This reset link is no longer valid.'
              : 'This reset link is invalid or has already been used. Request a new one.'
          }
          actionLabel="Back"
          onAction={() => router.replace('/')}
        />
      </Screen>
    );
  }

  return (
    <Screen safeTop>
      <View style={{ marginTop: spacing.huge, marginBottom: spacing.xxl, gap: spacing.xs }}>
        <Text variant="largeTitle">New password</Text>
        <Text variant="callout" tone="secondary">
          Choose a new password for your account.
        </Text>
      </View>
      <View style={{ gap: spacing.lg }}>
        <TextField
          label="New password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="newPassword"
        />
        <TextField
          label="Confirm password"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          textContentType="newPassword"
          error={error}
        />
        <Button title="Update password" onPress={submit} loading={loading} />
      </View>
    </Screen>
  );
}
