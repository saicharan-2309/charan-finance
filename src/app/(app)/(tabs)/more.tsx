import { router } from 'expo-router';
import { Alert, View } from 'react-native';

import { useToast } from '@/components/ui/feedback';
import { GradientFill } from '@/components/ui/gradient';
import { ListRow } from '@/components/ui/controls';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, IconBadge, Row, Text } from '@/components/ui/primitives';
import { useProfile } from '@/hooks/data';
import { describeError } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { hasUnsyncedChanges, signOut } from '@/services/auth';
import { useTheme } from '@/theme/ThemeProvider';
import { BUD_SWATCHES, spacing } from '@/theme/tokens';

/** BUD palette colours by name, for the menu icons. */
const SW = Object.fromEntries(BUD_SWATCHES.map((s) => [s.name, s.base])) as Record<
  (typeof BUD_SWATCHES)[number]['name'],
  string
>;

type Item = { title: string; icon: string; href: string; color?: string; subtitle?: string };

export default function MoreScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const profile = useProfile();

  const groups: { title: string; items: Item[] }[] = [
    {
      title: 'Automatic',
      items: [
        { title: 'Bank sync', icon: 'flash-outline', href: '/bank-sync', color: SW.Gold },
        { title: 'Review inbox', icon: 'file-tray-full-outline', href: '/review', color: SW.Indigo },
        { title: 'Auto-categorise rules', icon: 'git-branch-outline', href: '/rules', color: SW.Rose },
      ],
    },
    {
      title: 'Money',
      items: [
        {
          title: 'Accounts & payment methods',
          icon: 'wallet-outline',
          href: '/accounts',
          color: SW.Indigo,
        },
        { title: 'Balance groups', icon: 'albums-outline', href: '/balance-groups', color: SW.Blue },
        { title: 'Categories', icon: 'pricetags-outline', href: '/categories', color: SW.Gold },
        { title: 'Merchants', icon: 'storefront-outline', href: '/merchants', color: SW.Peach },
        { title: 'Budgets', icon: 'speedometer-outline', href: '/budgets', color: SW.Cyan },
      ],
    },
    {
      title: 'Planning',
      items: [
        { title: 'Savings goals', icon: 'flag-outline', href: '/goals', color: SW.Coral },
        { title: 'Loans & EMIs', icon: 'calendar-number-outline', href: '/emi', color: SW.Navy },
        { title: 'Recurring payments', icon: 'repeat', href: '/recurring', color: SW.Blue },
        { title: 'Subscriptions', icon: 'albums-outline', href: '/subscriptions', color: SW.Rose },
        { title: 'Calendar', icon: 'calendar-outline', href: '/calendar', color: SW.Indigo },
        { title: 'Net worth', icon: 'trending-up-outline', href: '/net-worth', color: SW.Cyan },
        { title: 'Insights', icon: 'sparkles-outline', href: '/insights', color: SW.Peach },
      ],
    },
    {
      title: 'Data',
      items: [
        { title: 'Import CSV', icon: 'cloud-upload-outline', href: '/import', color: SW.Slate },
        { title: 'Export data', icon: 'cloud-download-outline', href: '/export', color: SW.Slate },
      ],
    },
    {
      title: 'Settings',
      items: [
        {
          title: 'Notifications',
          icon: 'notifications-outline',
          href: '/settings/notifications',
          color: SW.Cyan,
        },
        {
          title: 'Security & app lock',
          icon: 'lock-closed-outline',
          href: '/settings/security',
          color: SW.Cyan,
        },
        { title: 'Appearance', icon: 'contrast-outline', href: '/settings/appearance', color: SW.Royal },
        {
          title: 'Money month & region',
          icon: 'globe-outline',
          href: '/settings/preferences',
          color: SW.Indigo,
        },
        { title: 'Privacy', icon: 'shield-checkmark-outline', href: '/settings/privacy', color: SW.Slate },
        { title: 'About', icon: 'information-circle-outline', href: '/settings/about', color: SW.Slate },
      ],
    },
  ];

  const confirmSignOut = () => {
    const unsynced = hasUnsyncedChanges();
    Alert.alert(
      'Sign out?',
      unsynced
        ? 'You have changes that haven’t synced yet. Signing out now will discard them from this device.'
        : 'Your data stays safely in your account.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
            } catch (e) {
              toast.show(describeError(e).message, 'error');
            }
          },
        },
      ],
    );
  };

  return (
    <Screen safeTop tabBarInset title="More">
      <Card style={{ marginBottom: spacing.xxl }}>
        <Row gap={spacing.md}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <GradientFill colors={colors.heroGradient} sheen />
            <Text variant="title" style={{ color: colors.heroText }}>
              {(profile.data?.displayName ?? user?.email ?? '?').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="headline">{profile.data?.displayName ?? 'Your account'}</Text>
            <Text variant="footnote" tone="secondary">
              {user?.email}
            </Text>
          </View>
        </Row>
      </Card>

      {groups.map((g) => (
        <Section key={g.title} title={g.title}>
          <Card style={{ paddingVertical: spacing.xs }}>
            {g.items.map((item, i) => (
              <View key={item.href}>
                {i > 0 ? <Divider inset={48} /> : null}
                <ListRow
                  title={item.title}
                  subtitle={item.subtitle}
                  leading={<IconBadge icon={item.icon} color={item.color} size={34} />}
                  onPress={() => router.push(item.href as never)}
                />
              </View>
            ))}
          </Card>
        </Section>
      ))}

      <Card style={{ paddingVertical: spacing.xs }}>
        <ListRow
          title="Sign out"
          destructive
          chevron={false}
          onPress={confirmSignOut}
          leading={<IconBadge icon="log-out-outline" color={colors.negative} size={34} />}
        />
      </Card>
    </Screen>
  );
}
