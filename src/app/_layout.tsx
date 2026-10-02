import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components/ui/feedback';
import { isConfigured } from '@/constants/env';
import { configureNotificationHandler } from '@/lib/notifications';
import { allowedGroups } from '@/lib/route-guard';
import { CACHE_BUSTER, queryClient, queryPersister, wireReactQueryToPlatform } from '@/lib/query';
import { AppLockProvider } from '@/providers/AppLockProvider';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

void SplashScreen.preventAutoHideAsync();
wireReactQueryToPlatform();
configureNotificationHandler();

export { ErrorBoundary } from '@/components/ErrorBoundary';

function RootNavigator() {
  const { session, initializing, recovering } = useAuth();
  const { colors, scheme } = useTheme();

  useEffect(() => {
    if (!initializing) void SplashScreen.hideAsync();
  }, [initializing]);

  const navTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.brand,
        background: colors.background,
        card: colors.background,
        text: colors.text,
        border: colors.border,
      },
    };
  }, [scheme, colors]);

  if (initializing) return null;
  const allowed = allowedGroups({ isConfigured, hasSession: !!session, recovering });
  const signedIn = allowed.has('(app)');

  return (
    <NavThemeProvider value={navTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <AppLockProvider active={signedIn}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Protected guard={allowed.has('setup-required')}>
            <Stack.Screen name="setup-required" />
          </Stack.Protected>
          <Stack.Protected guard={allowed.has('(auth)')}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
          {/* Reachable from the password-reset email link, signed in or not. */}
          <Stack.Screen name="reset-password" />
        </Stack>
      </AppLockProvider>
    </NavThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister: queryPersister,
            maxAge: 1000 * 60 * 60 * 24 * 7,
            buster: CACHE_BUSTER,
          }}
        >
          <ThemeProvider>
            <ToastProvider>
              <AuthProvider>
                <RootNavigator />
              </AuthProvider>
            </ToastProvider>
          </ThemeProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
