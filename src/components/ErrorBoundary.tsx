import type { ErrorBoundaryProps } from 'expo-router';
import { Pressable, Text as RNText, View } from 'react-native';

import { lightPalette, spacing } from '@/theme/tokens';

/**
 * Route-level error boundary. Rendered outside providers in the worst case,
 * so it uses static tokens and plain RN components. Never shows stack traces
 * or raw error messages to the user.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  if (__DEV__) console.error('[route-error]', error.name);
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xxl,
        gap: spacing.md,
        backgroundColor: lightPalette.background,
      }}
    >
      <RNText style={{ fontSize: 22, fontWeight: '700', color: lightPalette.text }}>
        Something went wrong
      </RNText>
      <RNText style={{ fontSize: 15, color: lightPalette.textSecondary, textAlign: 'center' }}>
        This screen hit an unexpected problem. Your data is safe.
      </RNText>
      <Pressable
        onPress={retry}
        accessibilityRole="button"
        style={{
          marginTop: spacing.md,
          backgroundColor: lightPalette.brand,
          paddingHorizontal: 24,
          paddingVertical: 14,
          borderRadius: 14,
        }}
      >
        <RNText style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Try again</RNText>
      </Pressable>
    </View>
  );
}
