/**
 * Insights cards in the reference design (Charan's mock-ups, Oct 10):
 *
 *   ┌ Total spending ───────────────────────┐
 *   │ ₹45,230   ↑ 5% from last period        │
 *   │  ▂ ▃ ▅ ▆ █ ← month bars, tap for value  │
 *   └────────────────────────────────────────┘
 *   Top categories        ( Amount | % share )
 *   [icon] Food & Dining          ₹12,450
 *          ▬▬▬▬▬▬▬───────────        28%
 *
 * Visual only: the figures come from the same report queries as before.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { CategoryAvatar } from '@/components/CategoryAvatar';
import { Skeleton } from '@/components/ui/feedback';
import { GradientFill } from '@/components/ui/gradient';
import { Card, Icon, Row, Text } from '@/components/ui/primitives';
import { foldOther, useSeriesColor } from '@/features/dashboard/widgets';
import { formatMoney } from '@/lib/money';
import { useTheme } from '@/theme/ThemeProvider';
import { chartOther, continuous, radius, spacing, typography } from '@/theme/tokens';
import type { CategoryTotal } from '@/types/domain';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthShort = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1] ?? iso;

/** The big figure, its change against the previous period, and month bars. */
export function TotalCard({
  title,
  amount,
  previous,
  upIsGood,
  currency,
  bars,
}: {
  title: string;
  amount: number | undefined;
  previous: number | undefined;
  /** Spending going up is bad; income and savings going up is good. */
  upIsGood: boolean;
  currency: string;
  bars: { label: string; value: number }[] | undefined;
}) {
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });
  if (amount === undefined)
    return <Skeleton height={250} rounded={radius.xxl} style={{ marginBottom: spacing.xl }} />;
  const change = previous && previous > 0 ? Math.round(((amount - previous) / previous) * 100) : null;
  const good = change !== null && (upIsGood ? change >= 0 : change <= 0);
  return (
    <Card style={{ marginBottom: spacing.xxl, padding: spacing.xl, borderRadius: radius.xxl }}>
      <Text variant="subhead" tone="secondary">
        {title}
      </Text>
      <Text
        style={[typography.display, { fontSize: 38, lineHeight: 44 }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {money(amount)}
      </Text>
      {change !== null ? (
        <Row gap={4} style={{ marginTop: 2 }}>
          <Icon
            name={change >= 0 ? 'arrow-up' : 'arrow-down'}
            size={14}
            tone={good ? 'positive' : 'negative'}
          />
          <Text variant="footnote" tone={good ? 'positive' : 'negative'} style={{ fontWeight: '700' }}>
            {Math.abs(change)}%
          </Text>
          <Text variant="footnote" tone="secondary">
            from last period
          </Text>
        </Row>
      ) : (
        <Text variant="footnote" tone="tertiary" style={{ marginTop: 2 }}>
          No previous period to compare
        </Text>
      )}
      {bars ? (
        <MonthBars bars={bars} currency={currency} />
      ) : (
        <Skeleton height={150} style={{ marginTop: spacing.lg }} />
      )}
    </Card>
  );
}

/** Rounded month bars; the latest (or the tapped one) is the blue-violet one with its value above. */
function MonthBars({ bars, currency }: { bars: { label: string; value: number }[]; currency: string }) {
  const { colors } = useTheme();
  const [sel, setSel] = useState(bars.length - 1);
  const max = Math.max(1, ...bars.map((b) => Math.max(b.value, 0)));
  const H = 110;
  const selected = bars[Math.min(sel, bars.length - 1)];
  if (!bars.length) return null;
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Row justify="space-around" align="flex-end" style={{ height: H + 34 }}>
        {bars.map((b, i) => {
          const on = i === Math.min(sel, bars.length - 1);
          const h = Math.max(6, Math.round((Math.max(b.value, 0) / max) * H));
          return (
            <Pressable
              key={`${b.label}${i}`}
              onPress={() => setSel(i)}
              accessibilityRole="button"
              accessibilityLabel={`${b.label}: ${formatMoney(b.value, currency, { decimals: 'never' })}`}
              style={{ alignItems: 'center', flex: 1 }}
            >
              {on ? (
                <View
                  style={{
                    marginBottom: 6,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: radius.sm,
                    backgroundColor: colors.text,
                  }}
                >
                  <Text
                    variant="caption"
                    style={{ color: colors.background, fontWeight: '700', fontSize: 11 }}
                  >
                    {formatMoney(selected?.value ?? 0, currency, { decimals: 'never' })}
                  </Text>
                </View>
              ) : null}
              <View
                style={{
                  width: 16,
                  height: h,
                  borderRadius: 8,
                  overflow: 'hidden',
                  backgroundColor: i % 2 ? `${colors.heroGradient[2]}33` : `${colors.brand}33`,
                }}
              >
                {on ? (
                  <GradientFill colors={[colors.heroGradient[0], colors.heroGradient[2]]} angle="vertical" />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </Row>
      <Row justify="space-around" style={{ marginTop: spacing.sm }}>
        {bars.map((b, i) => (
          <Text
            key={`${b.label}l${i}`}
            variant="caption"
            tone={i === Math.min(sel, bars.length - 1) ? 'primary' : 'secondary'}
            style={{
              flex: 1,
              textAlign: 'center',
              fontWeight: i === Math.min(sel, bars.length - 1) ? '700' : '500',
            }}
          >
            {b.label}
          </Text>
        ))}
      </Row>
    </View>
  );
}

/** "Top categories" with an Amount / % share switch and a coloured bar per row. */
export function CategoryBars({
  title,
  categories,
  currency,
  range,
}: {
  title: string;
  categories: CategoryTotal[] | undefined;
  currency: string;
  range: { start: string; end: string };
}) {
  const { colors, scheme } = useTheme();
  const seriesColor = useSeriesColor();
  const [mode, setMode] = useState<'amount' | 'share'>('amount');
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });

  const header = (
    <Row justify="space-between" style={{ marginBottom: spacing.md }}>
      <Text variant="headline" accessibilityRole="header">
        {title}
      </Text>
      <Row style={{ backgroundColor: colors.fill, borderRadius: radius.pill, padding: 3 }}>
        {(
          [
            ['amount', 'Amount'],
            ['share', '% share'],
          ] as const
        ).map(([m, label]) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            accessibilityRole="radio"
            accessibilityState={{ selected: mode === m }}
            style={{
              paddingHorizontal: spacing.md,
              height: 28,
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: mode === m ? colors.text : 'transparent',
            }}
          >
            <Text
              variant="caption"
              style={{ color: mode === m ? colors.background : colors.textSecondary, fontWeight: '700' }}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </Row>
    </Row>
  );

  if (!categories) return <Skeleton height={300} rounded={radius.xl} style={{ marginBottom: spacing.xxl }} />;
  if (!categories.length) {
    return (
      <View style={{ marginBottom: spacing.xxl }}>
        {header}
        <Card>
          <Text variant="callout" tone="secondary" align="center">
            Nothing in this period.
          </Text>
        </Card>
      </View>
    );
  }
  const rows = foldOther(categories, 6);
  const total = rows.reduce((s, c) => s + c.total, 0);
  const max = Math.max(...rows.map((r) => r.total), 1);

  return (
    <View style={{ marginBottom: spacing.xxl }}>
      {header}
      <Card padded={false} style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.xs }}>
        {rows.map((c, i) => {
          const other = c.categoryId === null && c.name.startsWith('Other');
          const color = other ? chartOther[scheme] : (c.color ?? seriesColor(i));
          const share = total ? Math.round((c.total / total) * 100) : 0;
          const content = (
            <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
              <CategoryAvatar
                icon={other ? 'ellipsis-horizontal' : (c.icon ?? 'pricetag-outline')}
                color={color}
                size={44}
              />
              <View style={{ flex: 1, gap: 6 }}>
                <Row justify="space-between">
                  <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1, fontSize: 15 }}>
                    {c.name}
                  </Text>
                  <Text style={[typography.amount, { fontSize: 15 }]}>
                    {mode === 'amount' ? money(c.total) : `${share}%`}
                  </Text>
                </Row>
                <Row gap={spacing.md}>
                  <View
                    style={{
                      flex: 1,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: colors.fill,
                      overflow: 'hidden',
                    }}
                  >
                    <View
                      style={{
                        width: `${Math.max(2, Math.round(((mode === 'amount' ? c.total / max : c.total / total) || 0) * 100))}%`,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: color,
                      }}
                    />
                  </View>
                  <Text variant="caption" tone="secondary" style={{ minWidth: 52, textAlign: 'right' }}>
                    {mode === 'amount' ? `${share}%` : money(c.total)}
                  </Text>
                </Row>
              </View>
            </Row>
          );
          return c.categoryId ? (
            <Pressable
              key={c.categoryId}
              onPress={() =>
                router.push({
                  pathname: '/report-detail',
                  params: { categoryId: c.categoryId!, start: range.start, end: range.end },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`${c.name}, ${money(c.total)}, ${share} percent`}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              {content}
            </Pressable>
          ) : (
            <View key={c.name}>{content}</View>
          );
        })}
      </Card>
    </View>
  );
}

/** A tinted rounded square, for icons in lists (the reference's category tiles). */
export function SquareIcon({ icon, color, size = 44 }: { icon: string; color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        ...continuous,
        backgroundColor: `${color}1F`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={size * 0.5} color={color} />
    </View>
  );
}
