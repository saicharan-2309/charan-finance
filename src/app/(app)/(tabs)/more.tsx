import { router } from 'expo-router';
import { Alert, View } from 'react-native';

import { useToast } from '@/components/ui/feedback';
import { ListRow } from '@/components/ui/controls';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, IconBadge, Row, Text } from '@/components/ui/primitives';
import { useProfile } from '@/hooks/data';
import { describeError } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { hasUnsyncedChanges, signOut } from '@/services/auth';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

type Item = { title: string; icon: string; href: string; color?: string; subtitle?: string };

export default function MoreScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { user } = useAuth();
  const profile = useProfile();

  const groups: { title: string; items: Item[] }[] = [
    {
      title: 'Money',
      items: [
        { title: 'Accounts', icon: 'wallet-outline', href: '/accounts', color: '#2563EB' },
        { title: 'Categories', icon: 'pricetags-outline', href: '/categories', color: '#EA580C' },
        { title: 'Merchants', icon: 'storefront-outline', href: '/merchants', color: '#9333EA' },
        { title: 'Budgets', icon: 'speedometer-outline', href: '/budgets', color: '#DC2626' },
      ],
    },
    {
      title: 'Planning',
      items: [
        { title: 'Recurring payments', icon: 'repeat', href: '/recurring', color: '#0D9488' },
        { title: 'Subscriptions', icon: 'albums-outline', href: '/subscriptions', color: '#DB2777' },
        { title: 'Calendar', icon: 'calendar-outline', href: '/calendar', color: '#0284C7' },
        { title: 'Net worth', icon: 'trending-up-outline', href: '/net-worth', color: '#16A34A' },
        { title: 'Insights', icon: 'sparkles-outline', href: '/insights', color: '#CA8A04' },
      ],
    },
    {
      title: 'Data',
      items: [
        { title: 'Import CSV', icon: 'cloud-upload-outline', href: '/import', color: '#64748B' },
        { title: 'Export data', icon: 'cloud-download-outline', href: '/export', color: '#64748B' },
      ],
    },
    {
      title: 'Settings',
      items: [
        {
          title: 'Notifications',
          icon: 'notifications-outline',
          href: '/settings/notifications',
          color: '#DC2626',
        },
        {
          title: 'Security & app lock',
          icon: 'lock-closed-outline',
          href: '/settings/security',
          color: '#16A34A',
        },
        { title: 'Appearance', icon: 'contrast-outline', href: '/settings/appearance', color: '#4F46E5' },
        {
          title: 'Currency & region',
          icon: 'globe-outline',
          href: '/settings/preferences',
          color: '#0284C7',
        },
        { title: 'Privacy', icon: 'shield-checkmark-outline', href: '/settings/privacy', color: '#64748B' },
        { title: 'About', icon: 'information-circle-outline', href: '/settings/about', color: '#64748B' },
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
              width: 52,
              height: 52,
              borderRadius: 18,
              backgroundColor: colors.brandSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="title" tone="brand">
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
