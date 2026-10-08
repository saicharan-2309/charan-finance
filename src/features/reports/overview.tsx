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

import { DonutChart, ProgressRing, RingStack } from '@/components/charts';
import { Skeleton } from '@/components/ui/feedback';
import { Card, Divider, Icon, Row, Text } from '@/components/ui/primitives';
import { CategoryAvatar } from '@/components/CategoryAvatar';
import { foldOther, useSeriesColor } from '@/features/dashboard/widgets';
import { useAccounts } from '@/hooks/data';
import { ACCOUNT_TYPE_LABELS } from '@/lib/accounts';
import { METHOD_ICONS } from '@/lib/payment-methods';
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
  if (!merchants) return <Skeleton height={180} />;
  if (merchants.length === 0) return null;
  return (
    <MerchantRings
      merchants={merchants.slice(0, 5)}
      total={merchants.reduce((s, m) => s + m.total, 0)}
      currency={currency}
    />
  );
}

export function PaidWith({ accounts, currency }: { accounts: AccountTotal[] | undefined; currency: string }) {
  const seriesColor = useSeriesColor();
  // Each payment method in the colour its owner picked for it, not by position.
  const methods = useAccounts();
  if (!accounts) return <Skeleton height={200} />;
  const spent = accounts.filter((a) => a.expense > 0).sort((a, b) => b.expense - a.expense);
  if (spent.length === 0) return null;
  const total = spent.reduce((s, a) => s + a.expense, 0);
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });
  const rows = spent.slice(0, 7).map((a, i) => ({
    ...a,
    color: methods.data?.find((m) => m.id === a.accountId)?.color ?? seriesColor(i),
  }));
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

/**
 * This period against the previous one as concentric rings (Activity-style):
 * money in now / before, spent now / before, all on one scale so the longest
 * arc is the largest figure. Each ring is named with its amount beside it.
 */
export function MoneyRings({
  current,
  previous,
  currency,
}: {
  current: PeriodSummary | undefined;
  previous: PeriodSummary | undefined;
  currency: string;
}) {
  const { colors } = useTheme();
  if (!current || !previous) return <Skeleton height={190} />;
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });
  const max = Math.max(current.income, previous.income, current.expense, previous.expense, 1);
  const rows = [
    { key: 'in', label: 'Money in', sub: 'This period', value: current.income, color: colors.income },
    {
      key: 'in-prev',
      label: 'Money in',
      sub: 'Previous period',
      value: previous.income,
      color: `${colors.income}66`,
    },
    { key: 'out', label: 'Spent', sub: 'This period', value: current.expense, color: colors.expense },
    {
      key: 'out-prev',
      label: 'Spent',
      sub: 'Previous period',
      value: previous.expense,
      color: `${colors.expense}66`,
    },
  ];
  if (rows.every((r) => r.value === 0)) {
    return (
      <Card>
        <Text variant="callout" tone="secondary" align="center">
          No money in or out in either period.
        </Text>
      </Card>
    );
  }
  return (
    <Card>
      <Row gap={spacing.xl} align="center">
        <RingStack
          size={136}
          thickness={11}
          spacing={3}
          rings={rows.map((r) => ({
            key: r.key,
            label: `${r.label}, ${r.sub}`,
            fraction: r.value / max,
            color: r.color,
          }))}
        />
        <View style={{ flex: 1, gap: spacing.md }}>
          {rows.map((r) => (
            <Row key={r.key} gap={spacing.sm}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: r.color }} />
              <View style={{ flex: 1 }}>
                <Text variant="footnote" style={{ fontWeight: '600' }}>
                  {r.label}
                </Text>
                <Text variant="caption" tone="secondary">
                  {r.sub}
                </Text>
              </View>
              <Text variant="footnote" style={{ fontVariant: ['tabular-nums'], fontWeight: '600' }}>
                {money(r.value)}
              </Text>
            </Row>
          ))}
        </View>
      </Row>
    </Card>
  );
}

/** Essential / discretionary / unclassified as a donut, with recurring and subscriptions as rings. */
export function SpendingMix({ s, currency }: { s: PeriodSummary; currency: string }) {
  const { colors } = useTheme();
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });
  const pct = (v: number) => (s.expense ? Math.round((v / s.expense) * 100) : 0);
  const parts = [
    { key: 'essential', label: 'Essential', value: s.essentialExpense, color: colors.info },
    { key: 'discretionary', label: 'Discretionary', value: s.discretionaryExpense, color: colors.expense },
    {
      key: 'unclassified',
      label: 'Unclassified',
      value: Math.max(s.expense - s.essentialExpense - s.discretionaryExpense, 0),
      color: colors.textTertiary,
    },
  ];
  return (
    <Card style={{ gap: spacing.xl }}>
      <Row gap={spacing.xl} align="center">
        <DonutChart
          size={124}
          thickness={16}
          segments={parts}
          center={
            <View style={{ alignItems: 'center' }}>
              <Text style={[typography.headline, { fontWeight: '800' }]}>{pct(s.essentialExpense)}%</Text>
              <Text variant="caption" tone="secondary">
                essential
              </Text>
            </View>
          }
        />
        <View style={{ flex: 1, gap: spacing.sm }}>
          {parts.map((p) => (
            <Row key={p.key} gap={spacing.sm}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.color }} />
              <Text variant="footnote" style={{ flex: 1, fontWeight: '600' }}>
                {p.label}
              </Text>
              <Text variant="footnote" tone="secondary" style={{ fontVariant: ['tabular-nums'] }}>
                {money(p.value)} · {pct(p.value)}%
              </Text>
            </Row>
          ))}
        </View>
      </Row>
      <Row gap={spacing.lg}>
        {[
          { key: 'recurring', label: 'Recurring', value: s.recurringExpense },
          { key: 'subs', label: 'Subscriptions', value: s.subscriptionExpense },
        ].map((r) => (
          <Row key={r.key} gap={spacing.sm} style={{ flex: 1 }}>
            <ProgressRing fraction={s.expense ? r.value / s.expense : 0} color={colors.brand} size={44}>
              <Text variant="caption" style={{ fontSize: 10, fontWeight: '700' }}>
                {pct(r.value)}%
              </Text>
            </ProgressRing>
            <View style={{ flex: 1 }}>
              <Text variant="footnote" style={{ fontWeight: '600' }}>
                {r.label}
              </Text>
              <Text variant="caption" tone="secondary">
                {money(r.value)}
              </Text>
            </View>
          </Row>
        ))}
      </Row>
      <Text variant="caption" tone="tertiary">
        Essential/discretionary follows how you classify categories (More → Categories).
      </Text>
    </Card>
  );
}

/** Merchants ranked, each with a ring showing its share of the listed spending. */
export function MerchantRings({
  merchants,
  currency,
  detailed = false,
  total: totalOf,
}: {
  merchants: MerchantTotal[];
  currency: string;
  detailed?: boolean;
  /** What each share is out of; defaults to the merchants listed. */
  total?: number;
}) {
  const seriesColor = useSeriesColor();
  const total = totalOf ?? merchants.reduce((s, m) => s + m.total, 0);
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });
  return (
    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
      {merchants.map((m, i) => {
        const share = total ? m.total / total : 0;
        return (
          <View key={m.merchantId}>
            {i > 0 ? <Divider inset={56} /> : null}
            <Pressable
              onPress={() => router.push({ pathname: '/merchants/[id]', params: { id: m.merchantId } })}
              accessibilityRole="button"
              accessibilityLabel={`${m.name}, ${money(m.total)}, ${Math.round(share * 100)} percent, ${m.count} payments`}
              style={({ pressed }) => ({ paddingVertical: spacing.md, opacity: pressed ? 0.6 : 1 })}
            >
              <Row gap={spacing.md}>
                <ProgressRing fraction={share} color={seriesColor(Math.min(i, 6))} size={44}>
                  <Text variant="caption" style={{ fontSize: 10, fontWeight: '700' }}>
                    {Math.round(share * 100)}%
                  </Text>
                </ProgressRing>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="callout" style={{ fontWeight: '600' }} numberOfLines={1}>
                    {m.name}
                  </Text>
                  <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {detailed
                      ? `${m.count} × · avg ${money(m.average)} · largest ${money(m.largest)}`
                      : `${m.count} ${m.count === 1 ? 'payment' : 'payments'}`}
                  </Text>
                </View>
                <Text style={typography.amount}>{money(m.total)}</Text>
              </Row>
            </Pressable>
          </View>
        );
      })}
    </Card>
  );
}

/** Spending per payment method: a ring per row, in the colour the method was given. */
export function AccountRings({ accounts, currency }: { accounts: AccountTotal[]; currency: string }) {
  const seriesColor = useSeriesColor();
  const methods = useAccounts();
  const total = accounts.reduce((s, a) => s + a.expense, 0);
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });
  return (
    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
      {accounts.map((a, i) => {
        const share = total ? a.expense / total : 0;
        const color = methods.data?.find((m) => m.id === a.accountId)?.color ?? seriesColor(Math.min(i, 6));
        return (
          <View key={a.accountId}>
            {i > 0 ? <Divider inset={56} /> : null}
            <Pressable
              onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: a.accountId } })}
              accessibilityRole="button"
              accessibilityLabel={`${a.name}, spent ${money(a.expense)}, ${Math.round(share * 100)} percent`}
              style={({ pressed }) => ({ paddingVertical: spacing.md, opacity: pressed ? 0.6 : 1 })}
            >
              <Row gap={spacing.md}>
                <ProgressRing fraction={share} color={color} size={44}>
                  <Icon name={METHOD_ICONS[a.type]} size={16} color={color} />
                </ProgressRing>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="callout" style={{ fontWeight: '600' }} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {ACCOUNT_TYPE_LABELS[a.type]} · {a.count} transactions · {Math.round(share * 100)}%
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={typography.amount}>{money(a.expense)}</Text>
                  {a.income ? (
                    <Text variant="caption" tone="positive">
                      +{money(a.income)}
                    </Text>
                  ) : null}
                </View>
              </Row>
            </Pressable>
          </View>
        );
      })}
    </Card>
  );
}
