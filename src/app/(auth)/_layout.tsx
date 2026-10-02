import { Stack } from 'expo-router';

import { useTheme } from '@/theme/ThemeProvider';

export default function AuthLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitle: '',
        headerTransparent: true,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}
