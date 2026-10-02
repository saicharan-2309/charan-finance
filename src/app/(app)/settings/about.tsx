import Constants from 'expo-constants';
import { View } from 'react-native';

import { BrandMark } from '@/components/BrandMark';
import { Screen } from '@/components/ui/layout';
import { Card, Divider, Row, Text } from '@/components/ui/primitives';
import { spacing } from '@/theme/tokens';

export default function About() {
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const build = Constants.expoConfig?.ios?.buildNumber ?? '—';
  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: spacing.md, marginVertical: spacing.xxl }}>
        <BrandMark size={84} />
        <Text variant="title">Charan Finance</Text>
        <Text variant="footnote" tone="secondary">
          A private personal finance tracker.
        </Text>
      </View>
      <Card style={{ paddingVertical: spacing.xs }}>
        <Row justify="space-between" style={{ paddingVertical: spacing.md }}>
          <Text>Version</Text>
          <Text tone="secondary">{version}</Text>
        </Row>
        <Divider />
        <Row justify="space-between" style={{ paddingVertical: spacing.md }}>
          <Text>Build</Text>
          <Text tone="secondary">{build}</Text>
        </Row>
      </Card>
      <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.xl }}>
        Charan Finance records and describes your own finances. It does not provide financial, investment, tax
        or legal advice, and it does not connect to your bank.
      </Text>
    </Screen>
  );
}
