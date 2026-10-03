/**
 * Reusable dashboard/report building blocks.
 */
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { CategoryAvatar } from '@/components/CategoryAvatar';
import { DonutChart, ShareBar } from '@/components/charts';
import { ProgressBar } from '@/components/ui/feedback';
import { Card, Icon, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { ACCOUNT_TYPE_LABELS } from '@/lib/accounts';
import { budgetProgress } from '@/lib/budget';
import type { ProjectedItem } from '@/lib/cashflow';
import { formatDayLabel, todayISO } from '@/lib/dates';
import type { Insight } from '@/lib/insights';
import { formatMoney, percentOf } from '@/lib/money';
import { accountVisual, balanceDisplay, cardStanding } from '@/lib/payment-methods';
import { useTheme } from '@/theme/ThemeProvider';
import { chartColorsDark, chartColorsLight, GUTTER, radius, spacing } from '@/theme/tokens';
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
  const { scheme, colors } = useTheme();
  const palette = scheme === 'dark' ? chartColorsDark : chartColorsLight;
  return (index: number) => palette[index] ?? colors.textTertiary;
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
  const { colors } = useTheme();
  const folded = foldOther(categories, max);
  const total = folded.reduce((s, c) => s + c.total, 0);
  const colored = folded.map((c, i) => ({
    ...c,
    color: c.categoryId === null && c.name.startsWith('Other') ? colors.textTertiary : seriesColor(i),
  }));

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{ alignItems: 'center' }}>
        <DonutChart
          segments={colored.map((c) => ({
            key: c.categoryId ?? c.name,
            label: c.name,
            value: c.total,
            color: c.color!,
          }))}
          center={
            <>
              <Text variant="caption" tone="secondary">
                Spent
              </Text>
              <MoneyText
                minor={total}
                currency={currency}
                variant="headline"
                options={{ decimals: 'never', compact: total >= 10_000_000 }}
              />
            </>
          }
        />
      </View>
      <View style={{ gap: spacing.md }}>
        {colored.map((c) => {
          const share = total ? c.total / total : 0;
          const content = (
            <View style={{ gap: 6 }}>
              <Row justify="space-between">
                <Row gap={spacing.sm} style={{ flex: 1 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c.color! }} />
                  <Text variant="callout" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {c.name}
                  </Text>
                  <Text variant="footnote" tone="tertiary">
                    {Math.round(share * 100)}%
                  </Text>
                </Row>
                <MoneyText
                  minor={c.total}
                  currency={currency}
                  variant="subhead"
                  options={{ decimals: 'never' }}
                />
              </Row>
              <ShareBar fraction={share} color={c.color!} />
            </View>
          );
          return onPressCategory && c.categoryId ? (
            <Pressable
              key={c.categoryId}
              onPress={() => onPressCategory(c)}
              accessibilityRole="button"
              accessibilityLabel={`${c.name}, ${formatMoney(c.total, currency)}`}
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
 * Horizontal strip of payment methods. A card shows what is used and what is
 * still available; everything else shows its balance. Tapping opens that
 * method; the last card adds a new one.
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
        const display = balanceDisplay(a);
        const card = a.type === 'credit_card' ? cardStanding(a) : null;
        return (
          <Pressable
            key={a.id}
            onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: a.id } })}
            accessibilityRole="button"
            accessibilityLabel={`${a.name}, ${formatMoney(display.amount, a.currency)} ${display.caption ?? ''}`}
            style={({ pressed }) => ({
              width: 168,
              padding: spacing.lg,
              gap: spacing.sm,
              borderRadius: radius.xl,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
            })}
          >
            <IconBadge icon={visual.icon} color={visual.color} size={34} />
            <Text variant="footnote" tone="secondary" numberOfLines={1}>
              {a.name}
            </Text>
            <MoneyText
              minor={display.amount}
              currency={a.currency}
              variant="amount"
              options={{ decimals: 'never' }}
              numberOfLines={1}
              adjustsFontSizeToFit
            />
            <Text variant="caption" tone="tertiary" numberOfLines={1}>
              {card?.available != null
                ? `${formatMoney(card.available, a.currency, { decimals: 'never' })} available`
                : (display.caption ?? ACCOUNT_TYPE_LABELS[a.type])}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        onPress={() => router.push('/accounts/edit')}
        accessibilityRole="button"
        accessibilityLabel="Add payment method"
        style={({ pressed }) => ({
          width: 132,
          padding: spacing.lg,
          gap: spacing.sm,
          justifyContent: 'center',
          borderRadius: radius.xl,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: colors.borderStrong,
          backgroundColor: pressed ? colors.surfaceMuted : 'transparent',
        })}
      >
        <IconBadge icon="add" color={colors.brand} size={34} />
        <Text variant="footnote" tone="brand">
          Add method
        </Text>
      </Pressable>
    </ScrollView>
  );
}
