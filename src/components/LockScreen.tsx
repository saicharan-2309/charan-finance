import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { Button } from './ui/controls';
import { BrandMark } from './BrandMark';
import { Text } from './ui/primitives';

export function LockScreen({ label, onUnlock }: { label: string; onUnlock: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      accessibilityViewIsModal
      style={{
        flex: 1,
        backgroundColor: colors.background,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: spacing.xxl,
        paddingBottom: insets.bottom,
        gap: spacing.lg,
      }}
    >
      <BrandMark size={72} />
      <Text variant="title" align="center">
        Charan Finance is locked
      </Text>
      <Text variant="callout" tone="secondary" align="center">
        Unlock with {label} to see your finances.
      </Text>
      <Button
        title={`Unlock with ${label}`}
        icon={label === 'Face ID' ? 'scan-outline' : 'finger-print-outline'}
        onPress={onUnlock}
        style={{ alignSelf: 'stretch', marginTop: spacing.lg }}
      />
    </View>
  );
}
