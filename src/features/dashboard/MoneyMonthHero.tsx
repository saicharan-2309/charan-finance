/**
 * The Home hero: how much is safe to spend until payday, and whether spending
 * is running ahead of or behind last month.
 *
 * The pace track is the one piece of motion on Home that plays by itself: the
 * spent bar grows to its value while the figure counts up, once, on load.
 * Everything else moves only in answer to a tap.
 *
 *   Safe to spend                       22 days left
 *   ₹18,240
 *   About ₹830 a day until 24 Oct
 *   ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░│░░░░░░░░░░░░░░   (bar = spent vs last month, notch = today)
 *   ₹21,400 spent · slower than last month
 *   ───────────────────────────────────
 *   In ₹85,000      Out ₹21,400      Kept 75%
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';

import { AnimatedMoney, Skeleton, useReducedMotion } from '@/components/ui/feedback';
import { Row, Text } from '@/components/ui/primitives';
import { useAnimatedValue } from '@/lib/animation';
import {
  daysBetweenInclusive,
  daysLeft,
  elapsedDays,
  fromISODate,
  type DateRange,
  type ISODate,
} from '@/lib/dates';
import { formatMoney, type Minor } from '@/lib/money';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export interface HeroProps {
  currency: string;
  cycle: DateRange;
  today: ISODate;
  /** Money that can be spent before payday after bills and card dues; null until known. */
  safeToSpend: Minor | null;
  spent: Minor | null;
  income: Minor | null;
  /** Total spending in the previous cycle (for pace). */
  previousSpent: Minor | null;
}

function paceCopy(spentFrac: number, elapsedFrac: number): string {
  if (spentFrac > elapsedFrac + 0.06) return 'faster than last month';
  if (spentFrac < elapsedFrac - 0.06) return 'slower than last month';
  return 'on last month’s pace';
}

export function MoneyMonthHero({
  currency,
  cycle,
  today,
  safeToSpend,
  spent,
  income,
  previousSpent,
}: HeroProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const grow = useAnimatedValue(0);

  const length = daysBetweenInclusive(cycle.start, cycle.end);
  const left = daysLeft(cycle, today);
  const elapsedFrac = length ? elapsedDays(cycle, today) / length : 0;
  const hasPrev = previousSpent !== null && previousSpent > 0;
  const spentFrac =
    spent === null
      ? 0
      : hasPrev
        ? spent / previousSpent!
        : safeToSpend !== null && spent + Math.max(safeToSpend, 0) > 0
          ? spent / (spent + Math.max(safeToSpend, 0))
          : 0;
  const fill = Math.max(0, Math.min(spentFrac, 1));

  useEffect(() => {
    Animated.timing(grow, {
      toValue: fill,
      duration: reduced ? 0 : 900,
      delay: reduced ? 0 : 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [grow, fill, reduced]);

  const headline = safeToSpend ?? spent;
  const perDay = safeToSpend !== null && left > 0 ? Math.max(safeToSpend, 0) / left : null;
  const endLabel = fromISODate(cycle.end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const kept = income && spent !== null && income > 0 ? Math.round(((income - spent) / income) * 100) : null;

  return (
    <Pressable
      onPress={() => router.push('/reports')}
      accessibilityRole="button"
      accessibilityHint="Opens spending reports"
      style={({ pressed }) => ({
        backgroundColor: colors.hero,
        borderRadius: radius.xxl,
        padding: spacing.xl,
        paddingTop: spacing.xl + 2,
        marginBottom: spacing.xxl,
        transform: [{ scale: pressed ? 0.995 : 1 }],
      })}
    >
      <Row justify="space-between" align="center">
        <Text variant="subhead" style={{ color: colors.heroMuted }}>
          {safeToSpend !== null ? 'Safe to spend' : 'Spent this month'}
        </Text>
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 3,
            borderRadius: radius.pill,
            backgroundColor: colors.heroTrack,
          }}
        >
          <Text variant="caption" style={{ color: colors.heroText }}>
            {left === 1 ? 'Last day' : `${left} days left`}
          </Text>
        </View>
      </Row>

      {headline === null ? (
        <Skeleton width={210} height={48} style={{ marginTop: spacing.sm, opacity: 0.25 }} />
      ) : (
        <AnimatedMoney
          minor={headline}
          from={0}
          currency={currency}
          variant="display"
          style={{ color: headline < 0 ? '#FFB4AB' : colors.heroText, marginTop: spacing.xs }}
          numberOfLines={1}
          adjustsFontSizeToFit
        />
      )}

      <Text variant="footnote" style={{ color: colors.heroMuted, marginTop: 2 }}>
        {safeToSpend === null
          ? `Until ${endLabel}`
          : safeToSpend <= 0
            ? `Bills and card dues already use your balance until ${endLabel}`
            : `About ${formatMoney(perDay ?? 0, currency, { decimals: 'never' })} a day until ${endLabel}`}
      </Text>

      {/* Pace track */}
      <View
        style={{ marginTop: spacing.xl, height: 10, borderRadius: 5, backgroundColor: colors.heroTrack }}
        accessibilityRole="progressbar"
        accessibilityLabel={
          hasPrev
            ? `Spent ${Math.round(spentFrac * 100)}% of last month's total with ${Math.round(elapsedFrac * 100)}% of the month gone`
            : `Spent ${Math.round(fill * 100)}%`
        }
      >
        <Animated.View
          style={{
            height: 10,
            borderRadius: 5,
            backgroundColor: spentFrac > 1 ? '#FFB4AB' : colors.heroText,
            width: grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: `${elapsedFrac * 100}%`,
            top: -4,
            bottom: -4,
            width: 3,
            marginLeft: -1.5,
            borderRadius: 2,
            backgroundColor: colors.highlight,
          }}
        />
      </View>
      <Text variant="footnote" style={{ color: colors.heroMuted, marginTop: spacing.sm }}>
        {spent === null
          ? ' '
          : `${formatMoney(spent, currency, { decimals: 'never' })} spent${
              hasPrev ? `, ${paceCopy(spentFrac, elapsedFrac)}` : ''
            }`}
      </Text>

      <View style={{ height: 1, backgroundColor: colors.heroTrack, marginVertical: spacing.lg }} />

      <Row justify="space-between" align="flex-start">
        <HeroStat label="In" value={income} currency={currency} />
        <HeroStat label="Out" value={spent} currency={currency} />
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text variant="caption" style={{ color: colors.heroMuted }}>
            Kept
          </Text>
          <Text variant="bodyStrong" style={{ color: colors.heroText }}>
            {kept === null ? '—' : `${kept}%`}
          </Text>
        </View>
      </Row>
    </Pressable>
  );
}

function HeroStat({ label, value, currency }: { label: string; value: Minor | null; currency: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 2, flex: 1 }}>
      <Text variant="caption" style={{ color: colors.heroMuted }}>
        {label}
      </Text>
      <Text variant="bodyStrong" style={{ color: colors.heroText }} numberOfLines={1}>
        {value === null ? '—' : formatMoney(value, currency, { decimals: 'never' })}
      </Text>
    </View>
  );
}
