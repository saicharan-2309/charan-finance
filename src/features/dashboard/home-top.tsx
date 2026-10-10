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
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { CardWave, GradientFill } from '@/components/ui/gradient';
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
  month,
}: {
  groups: BalanceGroup[] | undefined;
  accounts: Account[] | undefined;
  currency: string;
  /** Safe to spend until payday, shown on the cash group. */
  safe: { amount: Minor; perDay: Minor | null; until: string } | null;
  /**
   * This money month so far, and last month up to the same day — for the
   * Income / Expenses / Savings tiles. Null while loading.
   */
  month?: { income: Minor; expense: Minor; prevIncome: Minor; prevExpense: Minor } | null;
}) {
  const { colors, elevation } = useTheme();
  // The eye button hides the amounts on screen (e.g. in public); nothing else changes.
  const [hidden, setHidden] = useState(false);
  const money = (v: number) => (hidden ? '₹ ••••' : formatMoney(v, currency, { decimals: 'never' }));
  const change = (now: number, before: number) =>
    before > 0 ? Math.round(((now - before) / before) * 100) : null;
  const kept =
    month && month.income > 0
      ? Math.max(Math.round(((month.income - month.expense) / month.income) * 100), 0)
      : null;

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
            <CardWave />
            <Row justify="space-between">
              <Row gap={6}>
                <Text variant="subhead" style={{ color: colors.heroMuted }}>
                  {first.g.kind === 'cash' ? 'Total balance' : first.g.name}
                </Text>
                <Pressable
                  onPress={() => setHidden((v) => !v)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={hidden ? 'Show amounts' : 'Hide amounts'}
                >
                  <Icon
                    name={hidden ? 'eye-off-outline' : 'eye-outline'}
                    size={16}
                    color={colors.heroMuted}
                  />
                </Pressable>
              </Row>
              {kept !== null ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 3,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: radius.pill,
                    backgroundColor: colors.income,
                  }}
                  accessibilityLabel={`Kept ${kept} percent of this month's income`}
                >
                  <Icon name="arrow-up" size={12} color={colors.heroText} />
                  <Text variant="caption" style={{ color: colors.heroText, fontWeight: '700' }}>
                    {kept}% saved
                  </Text>
                </View>
              ) : null}
            </Row>
            <Text
              style={[typography.display, { color: colors.heroText, marginTop: 2 }]}
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
                  marginTop: spacing.sm,
                  alignSelf: 'flex-start',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: radius.pill,
                  backgroundColor: colors.heroTrack,
                }}
              >
                <Icon
                  name={safe.amount < 0 ? 'alert-circle' : 'shield-checkmark'}
                  size={14}
                  color={colors.gaugeGradient[0]}
                />
                <Text variant="footnote" style={{ color: colors.heroText, fontWeight: '600', flexShrink: 1 }}>
                  {safe.amount < 0
                    ? `Bills and card dues exceed this by ${money(-safe.amount)}`
                    : `Safe to spend ${money(safe.amount)}${safe.perDay !== null ? ` · ${money(safe.perDay)}/day` : ''} until ${safe.until}`}
                </Text>
              </View>
            ) : null}
            {month ? (
              <Row gap={spacing.sm} style={{ marginTop: spacing.lg }}>
                {(
                  [
                    ['Income', month.income, month.prevIncome, true],
                    ['Expenses', month.expense, month.prevExpense, false],
                    [
                      'Savings',
                      Math.max(month.income - month.expense, 0),
                      Math.max(month.prevIncome - month.prevExpense, 0),
                      true,
                    ],
                  ] as const
                ).map(([label, now, before, upIsGood]) => {
                  const c = change(now, before);
                  const good = c !== null && (upIsGood ? c >= 0 : c <= 0);
                  return (
                    <View
                      key={label}
                      style={{
                        flex: 1,
                        padding: spacing.md,
                        borderRadius: radius.lg,
                        ...continuous,
                        backgroundColor: colors.heroTrack,
                        gap: 2,
                      }}
                    >
                      <Text variant="caption" style={{ color: colors.heroMuted }}>
                        {label}
                      </Text>
                      <Text
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        style={[typography.bodyStrong, { color: colors.heroText, fontSize: 15 }]}
                      >
                        {money(now)}
                      </Text>
                      <Text
                        variant="caption"
                        style={{
                          color: c === null ? colors.heroMuted : good ? colors.heroUp : colors.heroDown,
                          fontWeight: '700',
                        }}
                        accessibilityLabel={
                          c === null
                            ? 'No comparison yet'
                            : `${Math.abs(c)} percent ${c >= 0 ? 'more' : 'less'} than by this day last month`
                        }
                      >
                        {c === null ? '—' : `${c >= 0 ? '↑' : '↓'} ${Math.abs(c)}%`}
                      </Text>
                    </View>
                  );
                })}
              </Row>
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

type Tint = 'expense' | 'brand' | 'violet' | 'warm';
const ACTIONS: { icon: string; label: string; tint: Tint; solid?: boolean; go: () => void }[] = [
  {
    icon: 'add',
    label: 'Add Expense',
    tint: 'expense',
    solid: true,
    go: () => router.push({ pathname: '/transaction/new', params: { type: 'expense' } }),
  },
  {
    icon: 'arrow-down',
    label: 'Money In',
    tint: 'brand',
    go: () => router.push({ pathname: '/transaction/new', params: { type: 'income' } }),
  },
  {
    icon: 'swap-horizontal',
    label: 'Transfer',
    tint: 'violet',
    go: () => router.push({ pathname: '/transaction/new', params: { type: 'transfer' } }),
  },
  { icon: 'people', label: 'Split Bill', tint: 'warm', go: () => router.push('/split/new') },
];

/** Four white tiles, icon and label inside, like the reference. */
export function QuickActions() {
  const { colors, elevation } = useTheme();
  const tintOf = (t: Tint) =>
    t === 'expense'
      ? colors.expense
      : t === 'brand'
        ? colors.brand
        : t === 'violet'
          ? colors.heroGradient[2]
          : colors.warm;
  return (
    <Row gap={spacing.sm} style={{ marginBottom: spacing.xxl }}>
      {ACTIONS.map((a) => {
        const tint = tintOf(a.tint);
        return (
          <Pressable
            key={a.label}
            onPress={a.go}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            style={({ pressed }) => [
              {
                flex: 1,
                alignItems: 'center',
                gap: spacing.sm,
                paddingVertical: spacing.md,
                borderRadius: radius.lg,
                ...continuous,
                backgroundColor: colors.surface,
                transform: [{ scale: pressed ? 0.94 : 1 }],
              },
              elevation.card,
            ]}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: a.solid ? tint : `${tint}1F`,
              }}
            >
              <Icon name={a.icon} size={20} color={a.solid ? colors.heroText : tint} />
            </View>
            <Text variant="caption" numberOfLines={1} adjustsFontSizeToFit style={{ fontWeight: '600' }}>
              {a.label}
            </Text>
          </Pressable>
        );
      })}
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
        : colors.warm;
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
