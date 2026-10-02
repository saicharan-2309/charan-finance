import { Pressable, View } from 'react-native';

import { Screen } from '@/components/ui/layout';
import { Card, Divider, Icon, Row, Text } from '@/components/ui/primitives';
import { useTheme, type AppearancePreference } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

const OPTIONS: { value: AppearancePreference; label: string; icon: string; detail: string }[] = [
  { value: 'system', label: 'Automatic', icon: 'phone-portrait-outline', detail: 'Match iPhone settings' },
  { value: 'light', label: 'Light', icon: 'sunny-outline', detail: 'Always light' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline', detail: 'Always dark' },
];

export default function AppearanceSettings() {
  const { preference, setPreference } = useTheme();
  return (
    <Screen>
      <Card style={{ paddingVertical: spacing.xs }}>
        {OPTIONS.map((o, i) => (
          <View key={o.value}>
            {i > 0 ? <Divider /> : null}
            <Pressable
              onPress={() => setPreference(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: preference === o.value }}
              style={{ paddingVertical: spacing.md }}
            >
              <Row gap={spacing.md}>
                <Icon name={o.icon} size={22} tone="secondary" />
                <View style={{ flex: 1 }}>
                  <Text variant="body">{o.label}</Text>
                  <Text variant="footnote" tone="secondary">
                    {o.detail}
                  </Text>
                </View>
                {preference === o.value ? <Icon name="checkmark" size={20} tone="brand" /> : null}
              </Row>
            </Pressable>
          </View>
        ))}
      </Card>
      <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.md }}>
        Text size follows your iPhone’s Dynamic Type setting.
      </Text>
    </Screen>
  );
}
