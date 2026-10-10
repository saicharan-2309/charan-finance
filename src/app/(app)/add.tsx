/**
 * The add sheet. The + button means "record something", not only "expense":
 * money out, money in, money moved between accounts, a monthly commitment, or
 * a new place money lives.
 */
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '@/components/ui/controls';
import { Divider, IconBadge, Row, Text } from '@/components/ui/primitives';
import { AuroraBackground } from '@/components/ui/gradient';
import { useTheme } from '@/theme/ThemeProvider';
import { GUTTER, radius, spacing } from '@/theme/tokens';

interface Action {
  label: string;
  hint: string;
  icon: string;
  color: 'brand' | 'positive' | 'transfer' | 'info' | 'warning' | 'textSecondary';
  go: () => void;
}

export default function AddScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const actions: Action[] = [
    {
      label: 'Expense',
      hint: 'Money spent, from any payment method',
      icon: 'arrow-up-circle-outline',
      color: 'brand',
      go: () => router.replace('/transaction/new'),
    },
    {
      label: 'Money in',
      hint: 'Salary, deposit, refund — adds to the account’s balance',
      icon: 'arrow-down-circle-outline',
      color: 'positive',
      go: () => router.replace({ pathname: '/transaction/new', params: { type: 'income' } }),
    },
    {
      label: 'Split a bill',
      hint: 'You paid for friends, or they paid for you',
      icon: 'git-branch-outline',
      color: 'info',
      go: () => router.replace('/split/new'),
    },
    {
      label: 'Transfer or card payment',
      hint: 'Move money between your accounts — never counted as spending',
      icon: 'swap-horizontal',
      color: 'transfer',
      go: () => router.replace({ pathname: '/transaction/new', params: { type: 'transfer' } }),
    },
    {
      label: 'EMI or loan',
      hint: 'A monthly instalment paid from any account',
      icon: 'calendar-number-outline',
      color: 'info',
      go: () => router.replace('/emi/edit'),
    },
    {
      label: 'Account or payment method',
      hint: 'Bank, card, cash, UPI, investment',
      icon: 'wallet-outline',
      color: 'warning',
      go: () => router.replace('/accounts/edit'),
    },
    {
      label: 'Scan a receipt',
      hint: 'Read the amount from a photo, then confirm',
      icon: 'scan-outline',
      color: 'textSecondary',
      go: () => router.replace('/receipt-scan'),
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <AuroraBackground />
      <View style={{ paddingHorizontal: GUTTER, paddingTop: spacing.xl, paddingBottom: spacing.md }}>
        <Row justify="space-between">
          <Text variant="title">Add</Text>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
            <Text variant="bodyStrong" tone="brand">
              Cancel
            </Text>
          </Pressable>
        </Row>
      </View>
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: insets.bottom + spacing.xl }}>
        {actions.map((a, i) => (
          <View key={a.label}>
            {i > 0 ? <Divider inset={60} /> : null}
            <Pressable
              onPress={() => {
                haptic.selection();
                a.go();
              }}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              accessibilityHint={a.hint}
              style={({ pressed }) => ({
                borderRadius: radius.lg,
                backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
              })}
            >
              <Row gap={spacing.md} style={{ paddingVertical: spacing.md, paddingHorizontal: spacing.xs }}>
                <IconBadge icon={a.icon} color={colors[a.color]} size={44} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{a.label}</Text>
                  <Text variant="footnote" tone="secondary">
                    {a.hint}
                  </Text>
                </View>
              </Row>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}
