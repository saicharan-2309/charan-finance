import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, TextField } from '@/components/ui/controls';
import { EmptyState } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/layout';
import { Text } from '@/components/ui/primitives';
import { describeError } from '@/lib/errors';
import { signUp, validateEmail, validatePassword } from '@/services/auth';
import { spacing } from '@/theme/tokens';

export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const next = {
      name: name.trim() ? null : 'Enter your name.',
      email: validateEmail(email),
      password: validatePassword(password),
      confirm: password === confirm ? null : "Passwords don't match.",
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setLoading(true);
    setFormError(null);
    try {
      const { needsConfirmation } = await signUp(email, password, name);
      if (needsConfirmation) setSent(true);
    } catch (e) {
      setFormError(describeError(e).message);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <Screen safeTop>
        <EmptyState
          icon="mail-unread-outline"
          title="Check your email"
          message={`We sent a confirmation link to ${email.trim()}. Open it on this iPhone, then sign in.`}
          actionLabel="Back to sign in"
          onAction={() => router.replace('/sign-in')}
        />
      </Screen>
    );
  }

  return (
    <Screen safeTop>
      <View style={{ marginTop: spacing.huge + spacing.lg, marginBottom: spacing.xxl, gap: spacing.xs }}>
        <Text variant="largeTitle">Create account</Text>
        <Text variant="callout" tone="secondary">
          Your data is private to your account and protected at the database level.
        </Text>
      </View>
      <View style={{ gap: spacing.lg }}>
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          autoComplete="name"
          textContentType="name"
          error={errors.name}
          placeholder="Charan"
        />
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="username"
          error={errors.email}
          placeholder="you@example.com"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
          error={errors.password}
          helper="At least 8 characters, with letters and numbers."
        />
        <TextField
          label="Confirm password"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          textContentType="newPassword"
          error={errors.confirm}
        />
        {formError ? (
          <Text variant="footnote" tone="negative">
            {formError}
          </Text>
        ) : null}
        <Button title="Create account" onPress={submit} loading={loading} />
      </View>
    </Screen>
  );
}
