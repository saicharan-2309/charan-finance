import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, TextField } from '@/components/ui/controls';
import { EmptyState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Text } from '@/components/ui/primitives';
import { describeError } from '@/lib/errors';
import { sendPasswordReset, validateEmail } from '@/services/auth';
import { spacing } from '@/theme/tokens';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const e = validateEmail(email);
    if (e) return setError(e);
    setLoading(true);
    setError(null);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <Screen safeTop>
        <EmptyState
          icon="mail-outline"
          title="Check your email"
          message="If an account exists for that address, we've sent a link to reset your password. Open it on this iPhone."
          actionLabel="Back to sign in"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  return (
    <Screen safeTop>
      <View style={{ marginTop: spacing.huge + spacing.lg, marginBottom: spacing.xxl, gap: spacing.xs }}>
        <Text variant="largeTitle">Reset password</Text>
        <Text variant="callout" tone="secondary">
          Enter your email and we’ll send you a reset link.
        </Text>
      </View>
      <View style={{ gap: spacing.lg }}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          error={error}
          onSubmitEditing={submit}
          returnKeyType="send"
        />
        <Button title="Send reset link" onPress={submit} loading={loading} />
      </View>
    </Screen>
  );
}
