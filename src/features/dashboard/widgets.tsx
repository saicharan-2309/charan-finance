/**
 * Reusable dashboard/report building blocks.
 */
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { CategoryAvatar } from '@/components/CategoryAvatar';
import { ShareBar } from '@/components/charts';
import { Gauge } from '@/components/charts/Gauge';
import { ProgressBar } from '@/components/ui/feedback';
import { Card, Icon, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { budgetProgress } from '@/lib/budget';
import type { ProjectedItem } from '@/lib/cashflow';
import { daysLeft, formatDayLabel, todayISO } from '@/lib/dates';
import type { Insight } from '@/lib/insights';
import { formatMoney, percentOf } from '@/lib/money';
import { useTheme } from '@/theme/ThemeProvider';
import {
  chartColorsDark,
  chartColorsLight,
  chartOther,
  continuous,
  radius,
  spacing,
  typography,
} from '@/theme/tokens';
import type { BudgetStatusRow, CategoryTotal } from '@/types/domain';

/**
 * Chart series colour: the validated categorical palette, in fixed order and
 * never cycled past the end.
 *
 * A category's own colour is deliberately NOT used here. Those colours are
 * muted on purpose — right for an avatar or a badge beside its name, but too
 * close together to tell two chart segments apart, especially with colour
 * vision deficiency. The chart palette is checked for exactly that. Legends
 * always use the same colour as the segment, so the two still agree.
 */
export function useSeriesColor() {
  const { scheme } = useTheme();
  const palette = scheme === 'dark' ? chartColorsDark : chartColorsLight;
  return (index: number) => palette[index] ?? chartOther[scheme];
}

/** Folds categories beyond `max` into "Other" so no hue is ever generated. */
export function foldOther(items: CategoryTotal[], max = 6): CategoryTotal[] {
  if (items.length <= max) return items;
  const head = items.slice(0, max - 1);
  const rest = items.slice(max - 1);
  return [
    ...head,
    {
      categoryId: null,
      name: `Other (${rest.length})`,
      icon: 'ellipsis-horizontal',
      color: null,
      classification: null,
      total: rest.reduce((s, c) => s + c.total, 0) as CategoryTotal['total'],
      count: rest.reduce((s, c) => s + c.count, 0),
    },
  ];
}

/**
 * Where the money went: one segmented bar (the whole month, split by
 * category) above a ranked list. Each row names its category next to its own
 * amount and share, so nothing depends on matching a colour to a legend.
 */
export function CategoryBreakdown({
  categories,
  currency,
  onPressCategory,
  max = 6,
}: {
  categories: CategoryTotal[];
  currency: string;
  onPressCategory?: (c: CategoryTotal) => void;
  max?: number;
}) {
  const seriesColor = useSeriesColor();
  const { colors, scheme } = useTheme();
  const folded = foldOther(categories, max);
  const total = folded.reduce((s, c) => s + c.total, 0);
  const colored = folded.map((c, i) => ({
    ...c,
    color: c.categoryId === null && c.name.startsWith('Other') ? chartOther[scheme] : seriesColor(i),
  }));

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.sm }}>
        <Row justify="space-between" align="flex-end">
          <Text variant="footnote" tone="secondary">
            Spent across {categories.length} {categories.length === 1 ? 'category' : 'categories'}
          </Text>
          <MoneyText minor={total} currency={currency} variant="headline" options={{ decimals: 'never' }} />
        </Row>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 }}
        >
          {colored.map((c) => (
            <View
              key={c.categoryId ?? c.name}
              style={{ flex: Math.max(c.total, total * 0.012), backgroundColor: c.color, minWidth: 3 }}
            />
          ))}
        </View>
      </View>
      <View style={{ gap: spacing.md }}>
        {colored.map((c) => {
          const share = total ? c.total / total : 0;
          const content = (
            <Row gap={spacing.md}>
              <CategoryAvatar icon={c.icon ?? 'ellipsis-horizontal'} color={c.color} size={36} />
              <View style={{ flex: 1, gap: 5 }}>
                <Row justify="space-between">
                  <Text variant="callout" numberOfLines={1} style={{ flexShrink: 1, fontWeight: '500' }}>
                    {c.name}
                  </Text>
                  <MoneyText
                    minor={c.total}
                    currency={currency}
                    variant="subhead"
                    options={{ decimals: 'never' }}
                  />
                </Row>
                <Row gap={spacing.sm}>
                  <View style={{ flex: 1 }}>
                    <ShareBar fraction={share} color={c.color} />
                  </View>
                  <Text
                    variant="caption"
                    tone="tertiary"
                    style={{ width: 34, textAlign: 'right', color: colors.textSecondary }}
                  >
                    {Math.round(share * 100)}%
                  </Text>
                </Row>
              </View>
            </Row>
          );
          return onPressCategory && c.categoryId ? (
            <Pressable
              key={c.categoryId}
              onPress={() => onPressCategory(c)}
              accessibilityRole="button"
              accessibilityLabel={`${c.name}, ${formatMoney(c.total, currency)}, ${Math.round(share * 100)} percent`}
            >
              {content}
            </Pressable>
          ) : (
            <View key={c.categoryId ?? c.name}>{content}</View>
          );
        })}
      </View>
    </View>
  );
}

const STATUS_COPY = {
  on_track: { label: 'On track', tone: 'positive' as const, icon: 'checkmark-circle' },
  warning: { label: 'Close to limit', tone: 'warning' as const, icon: 'alert-circle' },
  projected_over: { label: 'Trending over', tone: 'warning' as const, icon: 'trending-up' },
  over: { label: 'Over budget', tone: 'negative' as const, icon: 'close-circle' },
};

export function BudgetRow({
  row,
  currency,
  warningPercent,
}: {
  row: BudgetStatusRow;
  currency: string;
  warningPercent: number;
}) {
  const { colors } = useTheme();
  const p = budgetProgress(
    row.amount,
    row.spent,
    { start: row.periodStart, end: row.periodEnd },
    todayISO(),
    warningPercent,
  );
  const status = STATUS_COPY[p.status];
  const barColor =
    p.status === 'over'
      ? colors.negative
      : p.status === 'on_track'
        ? (row.categoryColor ?? colors.positive)
        : colors.warning;
  return (
    <View
      style={{ gap: spacing.sm }}
      accessible
      accessibilityLabel={`${row.categoryName ?? 'Overall'}: ${formatMoney(row.spent, currency)} of ${formatMoney(row.amount, currency)}, ${status.label}`}
    >
      <Row justify="space-between">
        <Row gap={spacing.sm} style={{ flex: 1 }}>
          <CategoryAvatar icon={row.categoryIcon ?? 'wallet-outline'} color={row.categoryColor} size={30} />
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {row.categoryName ?? 'Overall spending'}
          </Text>
        </Row>
        <Text variant="subhead" tone="secondary">
          {formatMoney(row.spent, currency, { decimals: 'never' })} /{' '}
          {formatMoney(row.amount, currency, { decimals: 'never' })}
        </Text>
      </Row>
      <ProgressBar
        progress={row.amount ? row.spent / row.amount : 0}
        color={barColor}
        marker={p.timeElapsed}
      />
      <Row justify="space-between">
        <Row gap={4}>
          <Icon name={status.icon} size={14} tone={status.tone} />
          <Text variant="caption" tone={status.tone}>
            {status.label} · {Math.round(p.percentUsed)}%
          </Text>
        </Row>
        <Text variant="caption" tone="secondary">
          {p.remaining >= 0
            ? `${formatMoney(p.remaining, currency, { decimals: 'never' })} left`
            : `${formatMoney(-p.remaining, currency, { decimals: 'never' })} over`}
          {p.status === 'projected_over'
            ? ` · projected ${formatMoney(p.projected, currency, { decimals: 'never' })}`
            : ''}
        </Text>
      </Row>
    </View>
  );
}

export function UpcomingRow({
  item,
  currency,
  onPress,
  color,
}: {
  item: ProjectedItem;
  currency: string;
  onPress?: () => void;
  /** Category tint, when the caller knows it. */
  color?: string | null;
}) {
  const icon =
    item.kind === 'subscription'
      ? 'repeat'
      : item.type === 'income'
        ? 'arrow-down-circle-outline'
        : item.type === 'transfer'
          ? 'swap-horizontal'
          : 'receipt-outline';
  const content = (
    <Row gap={spacing.md} style={{ paddingVertical: spacing.sm }}>
      <CategoryAvatar icon={icon} color={color ?? null} size={38} animateOnMount />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {item.name}
        </Text>
        <Text variant="footnote" tone={item.overdue ? 'negative' : 'secondary'}>
          {item.overdue ? `Overdue · ${formatDayLabel(item.date)}` : formatDayLabel(item.date)}
        </Text>
      </View>
      <MoneyText
        minor={item.type === 'income' ? item.amount : -item.amount}
        currency={currency}
        tone={item.type === 'income' ? 'positive' : item.type === 'transfer' ? 'transfer' : 'primary'}
        options={{ signed: item.type === 'income', decimals: 'never' }}
      />
    </Row>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button">
      {content}
    </Pressable>
  ) : (
    content
  );
}

export function InsightCard({ insight, compact }: { insight: Insight; compact?: boolean }) {
  const { colors } = useTheme();
  const tint =
    insight.tone === 'positive'
      ? colors.positive
      : insight.tone === 'negative'
        ? colors.warning
        : colors.info;
  return (
    <Card
      variant="muted"
      style={{
        flexDirection: 'row',
        gap: spacing.md,
        alignItems: 'flex-start',
        width: compact ? 280 : undefined,
      }}
    >
      <IconBadge icon={insight.icon} color={tint} size={34} />
      <Text variant="callout" style={{ flex: 1 }}>
        {insight.text}
      </Text>
    </Card>
  );
}

export function SavingsRatePill({ rate }: { rate: number | null }) {
  const { colors } = useTheme();
  if (rate === null) return null;
  const good = rate >= 20;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: radius.pill,
        backgroundColor: good ? colors.positiveSoft : colors.warningSoft,
      }}
    >
      <Icon name={good ? 'leaf' : 'leaf-outline'} size={13} color={good ? colors.positive : colors.warning} />
      <Text variant="caption" style={{ color: good ? colors.positive : colors.warning }}>
        Savings rate {rate}%
      </Text>
    </View>
  );
}

export function SeeAll({ href, label = 'See all' }: { href: string; label?: string }) {
  return (
    <Pressable onPress={() => router.push(href as never)} hitSlop={10} accessibilityRole="link">
      <Text variant="subhead" tone="brand">
        {label}
      </Text>
    </Pressable>
  );
}

export function percentLabel(part: number, whole: number) {
  return `${Math.round(percentOf(part, whole))}%`;
}

/**
 * The overall budget as an arc gauge: spent of limit in the middle, then what
 * is left to spend today and what was spent today. Category budgets stay as
 * rows below it.
 */
export function BudgetGauge({
  row,
  currency,
  warningPercent,
  spentToday,
  size = 240,
}: {
  row: BudgetStatusRow;
  currency: string;
  warningPercent: number;
  /** Spending recorded today; null while unknown. */
  spentToday: number | null;
  size?: number;
}) {
  const { colors } = useTheme();
  const p = budgetProgress(
    row.amount,
    row.spent,
    { start: row.periodStart, end: row.periodEnd },
    todayISO(),
    warningPercent,
  );
  const status = STATUS_COPY[p.status];
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });
  // Today's allowance: what was left before today, spread over the days left
  // including today, minus what has been spent today.
  const daysIncl = Math.max(daysLeft({ start: row.periodStart, end: row.periodEnd }, todayISO()), 1);
  const leftToday =
    spentToday === null
      ? p.dailyAllowance
      : Math.max(Math.floor((row.amount - (row.spent - spentToday)) / daysIncl) - spentToday, 0);
  return (
    <View style={{ alignItems: 'center', gap: spacing.lg }}>
      <Gauge
        size={size}
        progress={row.amount ? row.spent / row.amount : 0}
        accessibilityLabel={`Budget: ${money(row.spent)} of ${money(row.amount)} spent, ${status.label}`}
      >
        <Text
          style={[typography.display, { fontSize: 40, lineHeight: 46, color: colors.text }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {money(row.spent)}
        </Text>
        <Text variant="callout" tone="secondary">
          of {money(row.amount)}
        </Text>
      </Gauge>
      <Row justify="space-around" style={{ alignSelf: 'stretch', marginTop: -spacing.lg }}>
        <GaugeStat icon="wallet" value={money(leftToday)} label="Left today" />
        <GaugeStat icon="cash" value={spentToday === null ? '—' : money(spentToday)} label="Spent today" />
      </Row>
      <Row gap={4}>
        <Icon name={status.icon} size={14} tone={status.tone} />
        <Text variant="footnote" tone={status.tone}>
          {status.label} · {Math.round(p.percentUsed)}% used
          {p.remaining < 0 ? ` · ${money(-p.remaining)} over` : ` · ${money(p.remaining)} left`}
        </Text>
      </Row>
    </View>
  );
}

function GaugeStat({ icon, value, label }: { icon: string; value: string; label: string }) {
  const { colors } = useTheme();
  return (
    <Row gap={spacing.md}>
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          ...continuous,
          backgroundColor: colors.fill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={22} tone="primary" />
      </View>
      <View>
        <Text
          style={[
            typography.headline,
            { fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
          ]}
        >
          {value}
        </Text>
        <Text variant="footnote" tone="secondary">
          {label}
        </Text>
      </View>
    </Row>
  );
}
