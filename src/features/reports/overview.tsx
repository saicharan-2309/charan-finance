/**
 * Reports, Overview — a consumer view of the period, not a dashboard:
 *
 *   Spent ₹39,905  ↓12% vs last period      ( ring: of ₹1,85,000 in, 78% kept )
 *   Where it went      donut by category, legend you can tap
 *   Top merchants      share bars
 *   Paid with          donut by payment method
 *
 * Every series is named next to its colour; amounts carry their labels.
 */
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { DonutChart, ShareBar } from '@/components/charts';
import { Skeleton } from '@/components/ui/feedback';
import { Card, Icon, Row, Text } from '@/components/ui/primitives';
import { CategoryAvatar } from '@/components/CategoryAvatar';
import { foldOther, useSeriesColor } from '@/features/dashboard/widgets';
import { ACCOUNT_TYPE_LABELS } from '@/lib/accounts';
import { formatMoney } from '@/lib/money';
import { useTheme } from '@/theme/ThemeProvider';
import { chartOther, spacing, typography } from '@/theme/tokens';
import type { AccountTotal, CategoryTotal, MerchantTotal, PeriodSummary } from '@/types/domain';

export function SpendHero({
  current,
  previous,
  currency,
}: {
  current: PeriodSummary | undefined;
  previous: PeriodSummary | undefined;
  currency: string;
}) {
  const { colors } = useTheme();
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });
  if (!current) return <Skeleton height={190} style={{ marginBottom: spacing.xxl }} />;
  const change =
    previous && previous.expense > 0
      ? Math.round(((current.expense - previous.expense) / previous.expense) * 100)
      : null;
  const kept = current.income > 0 ? Math.max(current.income - current.expense, 0) : 0;
  const keptPct = current.income > 0 ? Math.round((kept / current.income) * 100) : null;

  return (
    <Card variant="elevated" style={{ padding: spacing.xl, marginBottom: spacing.xxl }}>
      <Row gap={spacing.lg} align="center">
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text variant="footnote" tone="secondary">
            Spent
          </Text>
          <Text
            style={[typography.display, { fontSize: 36, lineHeight: 42, color: colors.text }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {money(current.expense)}
          </Text>
          {change !== null ? (
            <Row gap={4}>
              <Icon
                name={change > 0 ? 'arrow-up' : change < 0 ? 'arrow-down' : 'remove'}
                size={14}
                color={change > 0 ? colors.expense : colors.positive}
              />
              <Text
                variant="footnote"
                style={{ color: change > 0 ? colors.expense : colors.positive, fontWeight: '600' }}
              >
                {change === 0
                  ? 'Same as the previous period'
                  : `${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than the previous period`}
              </Text>
            </Row>
          ) : (
            <Text variant="footnote" tone="tertiary">
              No previous period to compare
            </Text>
          )}
          <Row gap={spacing.lg} style={{ marginTop: spacing.md }}>
            <View>
              <Text variant="caption" tone="secondary">
                Money in
              </Text>
              <Text style={typography.headline} tone="positive">
                {money(current.income)}
              </Text>
            </View>
            <View>
              <Text variant="caption" tone="secondary">
                Kept
              </Text>
              <Text style={typography.headline}>{money(kept)}</Text>
            </View>
          </Row>
        </View>
        <DonutChart
          size={118}
          thickness={14}
          segments={
            current.income > 0
              ? [
                  {
                    key: 'spent',
                    label: 'Spent',
                    value: Math.min(current.expense, current.income),
                    color: colors.expense,
                  },
                  { key: 'kept', label: 'Kept', value: kept, color: colors.income },
                ]
              : []
          }
          center={
            <View style={{ alignItems: 'center' }}>
              <Text style={[typography.headline, { fontWeight: '800' }]}>
                {keptPct === null ? '—' : `${keptPct}%`}
              </Text>
              <Text variant="caption" tone="secondary">
                kept
              </Text>
            </View>
          }
        />
      </Row>
    </Card>
  );
}

export function CategoryDonut({
  categories,
  currency,
  range,
}: {
  categories: CategoryTotal[] | undefined;
  currency: string;
  range: { start: string; end: string };
}) {
  const { scheme } = useTheme();
  const seriesColor = useSeriesColor();
  if (!categories) return <Skeleton height={260} />;
  if (categories.length === 0) {
    return (
      <Card>
        <Text variant="callout" tone="secondary" align="center">
          No spending in this period.
        </Text>
      </Card>
    );
  }
  const folded = foldOther(categories, 6);
  const total = folded.reduce((s, c) => s + c.total, 0);
  const rows = folded.map((c, i) => ({
    ...c,
    color: c.categoryId === null && c.name.startsWith('Other') ? chartOther[scheme] : seriesColor(i),
  }));
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });

  return (
    <Card style={{ gap: spacing.xl }}>
      <View style={{ alignItems: 'center' }}>
        <DonutChart
          size={200}
          thickness={26}
          segments={rows.map((c) => ({
            key: c.categoryId ?? c.name,
            label: c.name,
            value: c.total,
            color: c.color,
          }))}
          center={
            <View style={{ alignItems: 'center' }}>
              <Text variant="caption" tone="secondary">
                {categories.length} {categories.length === 1 ? 'category' : 'categories'}
              </Text>
              <Text style={[typography.title, { fontSize: 24 }]}>{money(total)}</Text>
            </View>
          }
        />
      </View>
      <View style={{ gap: spacing.md }}>
        {rows.map((c) => {
          const share = total ? c.total / total : 0;
          const content = (
            <Row gap={spacing.md}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.color }} />
              <CategoryAvatar icon={c.icon ?? 'ellipsis-horizontal'} color={c.color} size={32} />
              <Text variant="callout" style={{ flex: 1, fontWeight: '500' }} numberOfLines={1}>
                {c.name}
              </Text>
              <Text variant="footnote" tone="secondary" style={{ width: 38, textAlign: 'right' }}>
                {Math.round(share * 100)}%
              </Text>
              <Text style={[typography.amount, { minWidth: 80, textAlign: 'right' }]}>{money(c.total)}</Text>
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
              accessibilityLabel={`${c.name}, ${money(c.total)}, ${Math.round(share * 100)} percent`}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              {content}
            </Pressable>
          ) : (
            <View key={c.name}>{content}</View>
          );
        })}
      </View>
    </Card>
  );
}

export function TopMerchants({
  merchants,
  currency,
}: {
  merchants: MerchantTotal[] | undefined;
  currency: string;
}) {
  const { colors } = useTheme();
  if (!merchants) return <Skeleton height={180} />;
  if (merchants.length === 0) return null;
  const top = merchants.slice(0, 5);
  const max = Math.max(...top.map((m) => m.total), 1);
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });
  return (
    <Card style={{ gap: spacing.lg }}>
      {top.map((m) => (
        <Pressable
          key={m.merchantId}
          onPress={() => router.push({ pathname: '/merchants/[id]', params: { id: m.merchantId } })}
          accessibilityRole="button"
          accessibilityLabel={`${m.name}, ${money(m.total)}, ${m.count} payments`}
          style={({ pressed }) => ({ gap: 6, opacity: pressed ? 0.6 : 1 })}
        >
          <Row justify="space-between">
            <Text variant="callout" style={{ fontWeight: '600', flex: 1 }} numberOfLines={1}>
              {m.name}
            </Text>
            <Text style={typography.amount}>{money(m.total)}</Text>
          </Row>
          <Row gap={spacing.sm}>
            <View style={{ flex: 1 }}>
              <ShareBar fraction={m.total / max} color={colors.brand} />
            </View>
            <Text variant="caption" tone="tertiary">
              {m.count}×
            </Text>
          </Row>
        </Pressable>
      ))}
    </Card>
  );
}

export function PaidWith({ accounts, currency }: { accounts: AccountTotal[] | undefined; currency: string }) {
  const seriesColor = useSeriesColor();
  if (!accounts) return <Skeleton height={200} />;
  const spent = accounts.filter((a) => a.expense > 0).sort((a, b) => b.expense - a.expense);
  if (spent.length === 0) return null;
  const total = spent.reduce((s, a) => s + a.expense, 0);
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });
  const rows = spent.slice(0, 7).map((a, i) => ({ ...a, color: seriesColor(i) }));
  return (
    <Card>
      <Row gap={spacing.xl} align="center">
        <DonutChart
          size={130}
          thickness={18}
          segments={rows.map((a) => ({ key: a.accountId, label: a.name, value: a.expense, color: a.color }))}
        />
        <View style={{ flex: 1, gap: spacing.sm }}>
          {rows.map((a) => (
            <Row key={a.accountId} gap={spacing.sm}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: a.color }} />
              <View style={{ flex: 1 }}>
                <Text variant="footnote" numberOfLines={1} style={{ fontWeight: '600' }}>
                  {a.name}
                </Text>
                <Text variant="caption" tone="secondary">
                  {ACCOUNT_TYPE_LABELS[a.type]} · {Math.round((a.expense / total) * 100)}%
                </Text>
              </View>
              <Text variant="footnote" style={{ fontVariant: ['tabular-nums'] }}>
                {money(a.expense)}
              </Text>
            </Row>
          ))}
        </View>
      </Row>
    </Card>
  );
}
