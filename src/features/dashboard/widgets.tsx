/**
 * Reusable dashboard/report building blocks.
 */
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { CategoryAvatar } from '@/components/CategoryAvatar';
import { ShareBar } from '@/components/charts';
import { ProgressBar } from '@/components/ui/feedback';
import { Card, Icon, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { ACCOUNT_TYPE_LABELS } from '@/lib/accounts';
import { budgetProgress } from '@/lib/budget';
import type { ProjectedItem } from '@/lib/cashflow';
import { formatDayLabel, todayISO } from '@/lib/dates';
import type { Insight } from '@/lib/insights';
import { formatMoney, percentOf } from '@/lib/money';
import { accountVisual, balanceDisplay, cardStanding, providerByKey } from '@/lib/payment-methods';
import { useTheme } from '@/theme/ThemeProvider';
import { chartColorsDark, chartColorsLight, chartOther, fonts, GUTTER, radius, spacing } from '@/theme/tokens';
import type { Account, BudgetStatusRow, CategoryTotal } from '@/types/domain';

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
                  <Text variant="caption" tone="tertiary" style={{ width: 34, textAlign: 'right', color: colors.textSecondary }}>
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
 * Horizontal strip of payment methods, each drawn as the thing it is: cards
 * carry their last digits and how much of the limit is used; bank, cash and
 * wallet tiles carry their balance. Tapping opens that method; the last tile
 * adds a new one.
 */
export function AccountStrip({ accounts }: { accounts: Account[] }) {
  const { colors } = useTheme();
  const active = accounts.filter((a) => a.isActive);
  if (active.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -GUTTER }}
      contentContainerStyle={{ gap: spacing.md, paddingHorizontal: GUTTER }}
    >
      {active.map((a) => {
        const visual = accountVisual(a);
        const tint = visual.color ?? colors.textSecondary;
        const display = balanceDisplay(a);
        const card = a.type === 'credit_card' ? cardStanding(a) : null;
        const issuer = providerByKey(a.provider)?.label ?? a.institution ?? ACCOUNT_TYPE_LABELS[a.type];
        const util = card?.utilisation ?? null;
        const utilColor =
          util === null ? colors.brand : util < 0.3 ? colors.positive : util < 0.7 ? colors.warning : colors.negative;
        return (
          <Pressable
            key={a.id}
            onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: a.id } })}
            accessibilityRole="button"
            accessibilityLabel={`${a.name}, ${formatMoney(display.amount, a.currency)} ${display.caption ?? ''}`}
            style={({ pressed }) => ({
              width: 176,
              minHeight: 118,
              padding: spacing.lg,
              justifyContent: 'space-between',
              borderRadius: radius.xl,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
              overflow: 'hidden',
            })}
          >
            <View
              style={{
                position: 'absolute',
                left: 0,
                top: 16,
                bottom: 16,
                width: 3,
                borderTopRightRadius: 3,
                borderBottomRightRadius: 3,
                backgroundColor: tint,
              }}
            />
            <Row justify="space-between">
              <Row gap={6} style={{ flex: 1 }}>
                <Icon name={visual.icon} size={15} color={tint} />
                <Text variant="caption" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {issuer}
                </Text>
              </Row>
              {a.last4 ? (
                <Text variant="caption" tone="tertiary" style={{ fontVariant: ['tabular-nums'] }}>
                  •• {a.last4}
                </Text>
              ) : null}
            </Row>
            <View style={{ gap: 2, marginTop: spacing.md }}>
              <Text variant="footnote" numberOfLines={1} style={{ fontWeight: '600' }}>
                {a.name}
              </Text>
              <Text
                style={{ fontFamily: fonts.displayMedium, fontSize: 21, lineHeight: 26, color: colors.text, letterSpacing: -0.3 }}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {formatMoney(display.amount, a.currency, { decimals: 'never' })}
              </Text>
              {card && card.available !== null ? (
                <View style={{ gap: 4, marginTop: 2 }}>
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.surfaceMuted, overflow: 'hidden' }}>
                    <View
                      style={{
                        height: 4,
                        width: `${Math.min(Math.max(util ?? 0, 0), 1) * 100}%`,
                        backgroundColor: utilColor,
                      }}
                    />
                  </View>
                  <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {formatMoney(card.available, a.currency, { decimals: 'never' })} available
                  </Text>
                </View>
              ) : (
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                  {display.caption ?? ACCOUNT_TYPE_LABELS[a.type]}
                </Text>
              )}
            </View>
          </Pressable>
        );
      })}
      <Pressable
        onPress={() => router.push('/accounts/edit')}
        accessibilityRole="button"
        accessibilityLabel="Add payment method"
        style={({ pressed }) => ({
          width: 120,
          minHeight: 118,
          padding: spacing.lg,
          gap: spacing.sm,
          justifyContent: 'center',
          alignItems: 'flex-start',
          borderRadius: radius.xl,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: colors.borderStrong,
          backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
        })}
      >
        <Icon name="add" size={22} tone="brand" />
        <Text variant="footnote" tone="brand" style={{ fontWeight: '600' }}>
          Add method
        </Text>
      </Pressable>
    </ScrollView>
  );
}
