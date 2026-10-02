import { Stack } from 'expo-router';

import { useSessionBootstrap } from '@/hooks/useSessionBootstrap';
import { useUserId } from '@/providers/AuthProvider';
import { useTheme } from '@/theme/ThemeProvider';

export default function AppLayout() {
  const userId = useUserId();
  const { colors } = useTheme();
  useSessionBootstrap(userId);

  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: colors.text,
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.text },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="transaction/new" options={{ presentation: 'modal', title: 'New transaction' }} />
      <Stack.Screen name="transaction/[id]" options={{ title: 'Transaction' }} />
      <Stack.Screen name="receipt-scan" options={{ presentation: 'modal', title: 'Scan receipt' }} />
      <Stack.Screen name="accounts/index" options={{ title: 'Accounts' }} />
      <Stack.Screen name="accounts/[id]" options={{ title: 'Account' }} />
      <Stack.Screen name="accounts/edit" options={{ presentation: 'modal', title: 'Account' }} />
      <Stack.Screen name="categories/index" options={{ title: 'Categories' }} />
      <Stack.Screen name="categories/edit" options={{ presentation: 'modal', title: 'Category' }} />
      <Stack.Screen name="merchants/index" options={{ title: 'Merchants' }} />
      <Stack.Screen name="merchants/[id]" options={{ title: 'Merchant' }} />
      <Stack.Screen name="budgets/index" options={{ title: 'Budgets' }} />
      <Stack.Screen name="budgets/edit" options={{ presentation: 'modal', title: 'Budget' }} />
      <Stack.Screen name="goals/[id]" options={{ title: 'Goal' }} />
      <Stack.Screen name="goals/edit" options={{ presentation: 'modal', title: 'Savings goal' }} />
      <Stack.Screen name="recurring/index" options={{ title: 'Recurring' }} />
      <Stack.Screen name="recurring/edit" options={{ presentation: 'modal', title: 'Recurring item' }} />
      <Stack.Screen name="subscriptions" options={{ title: 'Subscriptions' }} />
      <Stack.Screen name="calendar" options={{ title: 'Calendar' }} />
      <Stack.Screen name="net-worth" options={{ title: 'Net worth' }} />
      <Stack.Screen name="insights" options={{ title: 'Insights' }} />
      <Stack.Screen name="report-detail" options={{ title: 'Details' }} />
      <Stack.Screen name="import" options={{ title: 'Import CSV' }} />
      <Stack.Screen name="export" options={{ title: 'Export data' }} />
      <Stack.Screen name="settings/notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="settings/security" options={{ title: 'Security' }} />
      <Stack.Screen name="settings/appearance" options={{ title: 'Appearance' }} />
      <Stack.Screen name="settings/preferences" options={{ title: 'Currency & region' }} />
      <Stack.Screen name="settings/about" options={{ title: 'About' }} />
      <Stack.Screen name="settings/privacy" options={{ title: 'Privacy' }} />
    </Stack>
  );
}
