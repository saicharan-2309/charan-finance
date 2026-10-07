/**
 * The top of Home, built on balance groups:
 *
 *   ┌ Cash ─────────────────────────┐   the first group, on the BUD gradient
 *   │ ₹1,73,000                     │   (cash adds up; a card limit never does)
 *   │ Safe to spend ₹34,459 · ₹1,325/day until 31 Oct
 *   └───────────────────────────────┘
 *   [ Credit cards  ₹25,000 owed · ₹1,25,000 available ]   further groups
 *   ( Expense )( Money in )( Transfer )( Split )           quick actions
 */
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Glass } from '@/components/ui/glass';
import { CardRings, GradientFill } from '@/components/ui/gradient';
import { Skeleton } from '@/components/ui/feedback';
import { Card, Icon, Row, Text } from '@/components/ui/primitives';
import { CategoryAvatar } from '@/components/CategoryAvatar';
import { groupHeadline, summariseGroup } from '@/lib/balance-groups';
import type { Insight } from '@/lib/insights';
import { formatMoney, type Minor } from '@/lib/money';
import { useTheme } from '@/theme/ThemeProvider';
import { continuous, radius, spacing, typography } from '@/theme/tokens';
import type { Account, BalanceGroup } from '@/types/domain';

export function BalanceGroupsHero({
  groups,
  accounts,
  currency,
  safe,
}: {
  groups: BalanceGroup[] | undefined;
  accounts: Account[] | undefined;
  currency: string;
  /** Safe to spend until payday, shown on the cash group. */
  safe: { amount: Minor; perDay: Minor | null; until: string } | null;
}) {
  const { colors, elevation } = useTheme();
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });

  if (!groups || !accounts)
    return <Skeleton height={168} rounded={radius.xxl} style={{ marginBottom: spacing.xl }} />;

  const real = accounts.filter((a) => !a.systemKind);
  const summaries = groups.map((g) => ({
    g,
    s: summariseGroup(
      real.filter((a) => g.accountIds.includes(a.id)),
      currency,
    ),
  }));
  const [first, ...rest] = summaries;

  return (
    <View style={{ gap: spacing.md, marginBottom: spacing.xl }}>
      {first ? (
        <Pressable
          onPress={() => router.push('/balance-groups')}
          accessibilityRole="button"
          accessibilityLabel={`${first.g.name}: ${groupHeadline(first.s).label} ${money(groupHeadline(first.s).amount)}`}
          accessibilityHint="Opens your balance groups"
          style={({ pressed }) => [
            { borderRadius: radius.xxl, ...continuous, transform: [{ scale: pressed ? 0.985 : 1 }] },
            elevation.hero(colors.hero),
          ]}
        >
          <View
            style={{
              borderRadius: radius.xxl,
              ...continuous,
              overflow: 'hidden',
              padding: spacing.xl,
              gap: spacing.xs,
            }}
          >
            <GradientFill colors={colors.heroGradient} sheen />
            <CardRings />
            <Row justify="space-between">
              <Text variant="subhead" style={{ color: colors.heroMuted }}>
                {first.g.name}
              </Text>
              <Text variant="caption" style={{ color: colors.heroMuted }}>
                {first.s.cashCount + first.s.cardCount}{' '}
                {first.s.cashCount + first.s.cardCount === 1 ? 'method' : 'methods'}
              </Text>
            </Row>
            <Text
              style={[typography.display, { color: colors.heroText }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {money(groupHeadline(first.s).amount)}
            </Text>
            {first.s.cardCount && first.s.cashCount ? (
              <Text variant="footnote" style={{ color: colors.heroMuted }}>
                Cards in this group: {money(first.s.owed)} owed — not taken off your cash
              </Text>
            ) : null}
            {safe && first.g.kind === 'cash' ? (
              <View
                style={{
                  marginTop: spacing.md,
                  alignSelf: 'flex-start',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: radius.pill,
                  backgroundColor: colors.heroTrack,
                }}
              >
                <Icon
                  name={safe.amount < 0 ? 'alert-circle' : 'shield-checkmark'}
                  size={14}
                  color={colors.heroText}
                />
                <Text variant="footnote" style={{ color: colors.heroText, fontWeight: '600', flexShrink: 1 }}>
                  {safe.amount < 0
                    ? `Bills and card dues exceed this by ${money(-safe.amount)}`
                    : `Safe to spend ${money(safe.amount)}${safe.perDay !== null ? ` · ${money(safe.perDay)}/day` : ''} until ${safe.until}`}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      ) : null}

      {rest.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          {rest.map(({ g, s }) => {
            const head = groupHeadline(s);
            return (
              <Card
                key={g.id}
                onPress={() => router.push('/balance-groups')}
                accessibilityLabel={`${g.name}, ${head.label} ${money(head.amount)}`}
                style={{ flexBasis: rest.length === 1 ? '100%' : '47%', flexGrow: 1, gap: 2 }}
              >
                <Text variant="footnote" tone="secondary" numberOfLines={1}>
                  {g.name}
                </Text>
                <Text
                  style={[typography.headline, { fontWeight: '700' }]}
                  tone={s.cashCount === 0 && s.cardCount ? 'negative' : 'primary'}
                >
                  {money(head.amount)}
                </Text>
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                  {s.cashCount === 0 && s.cardCount
                    ? s.creditLimit
                      ? `owed · ${money(s.availableCredit)} available`
                      : 'owed'
                    : head.label.toLowerCase()}
                </Text>
              </Card>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const ACTIONS = [
  {
    icon: 'remove',
    label: 'Expense',
    go: () => router.push({ pathname: '/transaction/new', params: { type: 'expense' } }),
  },
  {
    icon: 'add',
    label: 'Money in',
    go: () => router.push({ pathname: '/transaction/new', params: { type: 'income' } }),
  },
  {
    icon: 'swap-horizontal',
    label: 'Transfer',
    go: () => router.push({ pathname: '/transaction/new', params: { type: 'transfer' } }),
  },
  { icon: 'git-branch', label: 'Split', go: () => router.push('/split/new') },
] as const;

export function QuickActions() {
  return (
    <Row justify="space-between" style={{ marginBottom: spacing.xxl, paddingHorizontal: spacing.xs }}>
      {ACTIONS.map((a) => (
        <Pressable
          key={a.label}
          onPress={a.go}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          style={({ pressed }) => ({
            alignItems: 'center',
            gap: spacing.xs,
            width: 72,
            transform: [{ scale: pressed ? 0.92 : 1 }],
          })}
        >
          <Glass
            interactive
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={a.icon} size={22} tone="brand" />
          </Glass>
          <Text variant="caption" tone="secondary">
            {a.label}
          </Text>
        </Pressable>
      ))}
    </Row>
  );
}

export function InsightTeaser({ insight }: { insight: Insight | undefined }) {
  const { colors } = useTheme();
  if (!insight) return null;
  const tint =
    insight.tone === 'positive'
      ? colors.positive
      : insight.tone === 'negative'
        ? colors.expense
        : colors.brand;
  return (
    <Card
      onPress={() => router.push('/insights')}
      accessibilityLabel={`Insight: ${insight.text}`}
      style={{ marginBottom: spacing.xl }}
    >
      <Row gap={spacing.md} align="flex-start">
        <CategoryAvatar icon={insight.icon} color={tint} size={40} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="caption" tone="brand" style={{ fontWeight: '700' }}>
            Insight
          </Text>
          <Text variant="callout">{insight.text}</Text>
        </View>
        <Icon name="chevron-forward" size={16} tone="tertiary" />
      </Row>
    </Card>
  );
}

export function FriendsSummaryCard({ owe, owed, currency }: { owe: Minor; owed: Minor; currency: string }) {
  if (owe === 0 && owed === 0) return null;
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });
  return (
    <Card
      onPress={() => router.push('/friends')}
      accessibilityLabel={`Friends: you owe ${money(owe)}, owed to you ${money(owed)}`}
      style={{ marginBottom: spacing.xl }}
    >
      <Row justify="space-between">
        <Row gap={spacing.sm}>
          <Icon name="people" size={18} tone="brand" />
          <Text variant="bodyStrong">Friends</Text>
        </Row>
        <Row gap={2}>
          <Text variant="subhead" tone="brand">
            View all
          </Text>
          <Icon name="chevron-forward" size={14} tone="brand" />
        </Row>
      </Row>
      <Row gap={spacing.xl} style={{ marginTop: spacing.md }}>
        <View>
          <Text variant="caption" tone="secondary">
            You owe
          </Text>
          <Text style={typography.headline} tone={owe ? 'negative' : 'secondary'}>
            {money(owe)}
          </Text>
        </View>
        <View>
          <Text variant="caption" tone="secondary">
            Owed to you
          </Text>
          <Text style={typography.headline} tone={owed ? 'positive' : 'secondary'}>
            {money(owed)}
          </Text>
        </View>
      </Row>
    </Card>
  );
}
