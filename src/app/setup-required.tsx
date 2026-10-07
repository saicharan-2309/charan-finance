import { View } from 'react-native';

import { BrandMark } from '@/components/BrandMark';
import { Card, Text } from '@/components/ui/primitives';
import { Screen } from '@/components/ui/layout';
import { spacing } from '@/theme/tokens';

/** Shown when the build has no Supabase configuration (instead of crashing). */
export default function SetupRequired() {
  return (
    <Screen safeTop>
      <View style={{ alignItems: 'center', gap: spacing.lg, marginTop: spacing.huge }}>
        <BrandMark size={72} />
        <Text variant="title" align="center">
          Configuration needed
        </Text>
        <Text variant="callout" tone="secondary" align="center">
          This build of BUD doesn’t have its Supabase connection configured.
        </Text>
      </View>
      <Card style={{ marginTop: spacing.xxl, gap: spacing.sm }}>
        <Text variant="bodyStrong">For local development</Text>
        <Text variant="footnote" tone="secondary">
          Copy .env.example to .env, set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then
          restart Expo with “npx expo start --clear”.
        </Text>
        <Text variant="bodyStrong" style={{ marginTop: spacing.md }}>
          For EAS builds
        </Text>
        <Text variant="footnote" tone="secondary">
          Add both variables to the EAS environment for this build profile (see README → EAS setup), then
          rebuild.
        </Text>
      </Card>
    </Screen>
  );
}
