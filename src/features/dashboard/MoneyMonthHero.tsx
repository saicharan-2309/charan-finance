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
 *   [↓ In ₹85,000] [↑ Out ₹21,400] [Kept 75%]   (three glass tiles)
 *
 * Drawn as a violet gradient card — the one rich surface on Home.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';

import { AnimatedMoney, Skeleton, useReducedMotion } from '@/components/ui/feedback';
import { CardRings, GradientFill } from '@/components/ui/gradient';
import { Icon, Row, Text } from '@/components/ui/primitives';
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
import { continuous, radius, spacing } from '@/theme/tokens';

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
  const { colors, elevation } = useTheme();
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

  const negative = headline !== null && headline < 0;

  return (
    <Pressable
      onPress={() => router.push('/reports')}
      accessibilityRole="button"
      accessibilityHint="Opens spending reports"
      style={({ pressed }) => [
        {
          borderRadius: radius.xxl,
          ...continuous,
          marginBottom: spacing.xxl,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        elevation.hero(colors.hero),
      ]}
    >
      <View style={{ borderRadius: radius.xxl, ...continuous, overflow: 'hidden', padding: spacing.xl }}>
        <GradientFill colors={colors.heroGradient} sheen />
        <CardRings />

        <Row justify="space-between" align="center">
          <Text variant="subhead" style={{ color: colors.heroMuted }}>
            {safeToSpend !== null ? 'Safe to spend' : 'Spent this month'}
          </Text>
          <Row
            gap={5}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: radius.pill,
              backgroundColor: colors.heroTrack,
            }}
          >
            <Icon name="calendar-clear-outline" size={12} color={colors.heroText} />
            <Text variant="caption" style={{ color: colors.heroText, fontWeight: '600' }}>
              {left === 1 ? 'Last day' : `${left} days left`}
            </Text>
          </Row>
        </Row>

        {headline === null ? (
          <Skeleton width={210} height={50} style={{ marginTop: spacing.sm, opacity: 0.3 }} />
        ) : (
          <AnimatedMoney
            minor={headline}
            from={0}
            currency={currency}
            variant="display"
            style={{ color: negative ? colors.highlight : colors.heroText, marginTop: spacing.sm }}
            numberOfLines={1}
            adjustsFontSizeToFit
          />
        )}

        <Text variant="subhead" style={{ color: colors.heroMuted, marginTop: 2, fontWeight: '400' }}>
          {safeToSpend === null
            ? `Until ${endLabel}`
            : safeToSpend <= 0
              ? `Bills and card dues already use your balance until ${endLabel}`
              : `About ${formatMoney(perDay ?? 0, currency, { decimals: 'never' })} a day until ${endLabel}`}
        </Text>

        {/* Pace track */}
        <View
          style={{ marginTop: spacing.xl, height: 8, borderRadius: 4, backgroundColor: colors.heroTrack }}
          accessibilityRole="progressbar"
          accessibilityLabel={
            hasPrev
              ? `Spent ${Math.round(spentFrac * 100)}% of last month's total with ${Math.round(elapsedFrac * 100)}% of the month gone`
              : `Spent ${Math.round(fill * 100)}%`
          }
        >
          <Animated.View
            style={{
              height: 8,
              borderRadius: 4,
              backgroundColor: spentFrac > 1 ? colors.highlight : colors.heroText,
              width: grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: `${elapsedFrac * 100}%`,
              top: -4,
              bottom: -4,
              width: 4,
              marginLeft: -2,
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

        <Row gap={spacing.sm} align="stretch" style={{ marginTop: spacing.lg }}>
          <HeroStat icon="arrow-down" label="In" value={income === null ? '—' : short(income)} />
          <HeroStat icon="arrow-up" label="Out" value={spent === null ? '—' : short(spent)} />
          <HeroStat icon="leaf-outline" label="Kept" value={kept === null ? '—' : `${kept}%`} />
        </Row>
      </View>
    </Pressable>
  );

  function short(v: Minor) {
    return formatMoney(v, currency, { decimals: 'never' });
  }
}

/** One of the three glass tiles along the bottom of the hero. */
function HeroStat({ icon, label, value }: { icon: string; label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        gap: 6,
        padding: spacing.md,
        borderRadius: radius.lg,
        ...continuous,
        backgroundColor: colors.heroTrack,
      }}
    >
      <Row gap={5}>
        <Icon name={icon} size={13} color={colors.heroMuted} />
        <Text variant="caption" style={{ color: colors.heroMuted }}>
          {label}
        </Text>
      </Row>
      <Text
        variant="bodyStrong"
        style={{ color: colors.heroText, fontVariant: ['tabular-nums'] }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </View>
  );
}
