import { Link, router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, View, type TextInput } from 'react-native';

import { BrandMark } from '@/components/BrandMark';
import { Button, TextField } from '@/components/ui/controls';
import { Screen } from '@/components/ui/layout';
import { Text } from '@/components/ui/primitives';
import { describeError } from '@/lib/errors';
import { signInWithPassword, validateEmail } from '@/services/auth';
import { spacing } from '@/theme/tokens';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
    const emailError = validateEmail(email);
    if (emailError) return setError(emailError);
    if (!password) return setError('Enter your password.');
    setError(null);
    setLoading(true);
    try {
      await signInWithPassword(email, password);
      // The protected route guard switches to the app automatically.
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen safeTop>
      <View style={{ marginTop: spacing.huge, marginBottom: spacing.xxxl, gap: spacing.lg }}>
        <BrandMark size={64} />
        <View style={{ gap: spacing.xs }}>
          <Text variant="largeTitle">Welcome back</Text>
          <Text variant="callout" tone="secondary">
            Sign in to Charan Finance.
          </Text>
        </View>
      </View>

      <View style={{ gap: spacing.lg }}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          placeholder="you@example.com"
        />
        <TextField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          placeholder="Your password"
        />
        {error ? (
          <Text variant="footnote" tone="negative" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button title="Sign in" onPress={submit} loading={loading} />
        <Pressable
          onPress={() => router.push('/forgot-password')}
          accessibilityRole="link"
          style={{ alignSelf: 'center', padding: spacing.sm }}
        >
          <Text variant="subhead" tone="brand">
            Forgot password?
          </Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.xxxl }}>
        <Text variant="callout" tone="secondary">
          New here?
        </Text>
        <Link href="/sign-up" accessibilityRole="link">
          <Text variant="callout" tone="brand" style={{ fontWeight: '600' }}>
            Create an account
          </Text>
        </Link>
      </View>
    </Screen>
  );
}
