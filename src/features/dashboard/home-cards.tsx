/**
 * Home, drawn after the reference: a carousel of payment-method cards, a
 * "This week" income/expense chart, transactions as individual cards and
 * gradient category tiles with period pills.
 *
 * Every figure comes from the database. Colour never carries meaning alone:
 * the chart has a legend and exact values on tap, tiles are named, money is
 * signed or labelled.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { Chip, haptic } from '@/components/ui/controls';
import { Skeleton } from '@/components/ui/feedback';
import { CardSwoosh, GradientFill } from '@/components/ui/gradient';
import { Icon, Row, Text } from '@/components/ui/primitives';
import { signedAmount, transactionTitle } from '@/features/transactions/TransactionRow';
import { useCategorySpend, useWeekSeries, type SpendPeriod } from '@/hooks/data';
import { ACCOUNT_TYPE_LABELS } from '@/lib/accounts';
import { formatDayLabel, formatShortDate, formatTime, fromISODate, todayISO, toISODate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { balanceDisplay, cardDates, FLOW_ICONS, providerByKey, transactionFlow } from '@/lib/payment-methods';
import { useTheme } from '@/theme/ThemeProvider';
import { cardGradientFor, continuous, GUTTER, radius, spacing, typography } from '@/theme/tokens';
import type { Account, Transaction } from '@/types/domain';

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

// ---------------------------------------------------------------------------
// Payment-method carousel
// ---------------------------------------------------------------------------

/** Full-width cards that snap one at a time, the next one peeking in. */
export function AccountCarousel({ accounts }: { accounts: Account[] }) {
  const { colors } = useTheme();
  const { width: screen } = useWindowDimensions();
  // The system "Friends" balance is shown in Friends, not as a card.
  const active = accounts.filter((a) => a.isActive && !a.systemKind);
  const cardW = Math.min(screen - GUTTER * 2 - 28, 360);
  const cardH = Math.round(cardW * 0.58);
  const today = todayISO();
  if (active.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={cardW + spacing.md}
      decelerationRate="fast"
      // Generous vertical padding so the cards' glow is never clipped by the scroller.
      style={{ marginHorizontal: -GUTTER, marginVertical: -spacing.xxxl }}
      contentContainerStyle={{ gap: spacing.md, paddingHorizontal: GUTTER, paddingVertical: spacing.xxxl }}
    >
      {active.map((a) => {
        // The colour you chose for this payment method, always — never one picked by position.
        const grad = cardGradientFor(a.color, colors.cardGradient);
        const display = balanceDisplay(a);
        const issuer = providerByKey(a.provider)?.label ?? a.institution ?? ACCOUNT_TYPE_LABELS[a.type];
        const isCard = a.type === 'credit_card';
        const due = isCard ? cardDates(a, today).nextDue : null;
        const amount = formatMoney(display.amount, a.currency, { decimals: 'never' });
        return (
          <Pressable
            key={a.id}
            onPress={() => router.push({ pathname: '/accounts/[id]', params: { id: a.id } })}
            accessibilityRole="button"
            accessibilityLabel={`${a.name}, ${issuer}, ${amount}${display.caption ? ` ${display.caption}` : ''}`}
            style={({ pressed }) => [
              { width: cardW, height: cardH, borderRadius: radius.xl, ...continuous },
              cardGlow(grad[1]),
              { transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
          >
            <View
              style={{
                flex: 1,
                borderRadius: radius.xl,
                ...continuous,
                overflow: 'hidden',
                padding: spacing.xl,
                justifyContent: 'space-between',
              }}
            >
              <GradientFill colors={grad} />
              <CardSwoosh />
              <Row justify="space-between" align="flex-start">
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.heroText,
                    fontSize: 20,
                    fontWeight: '800',
                    fontStyle: 'italic',
                    letterSpacing: -0.3,
                    flexShrink: 1,
                    marginRight: spacing.md,
                  }}
                >
                  {issuer}
                </Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text
                    style={[typography.headline, { color: colors.heroText, fontWeight: '700' }]}
                    numberOfLines={1}
                  >
                    {amount}
                  </Text>
                  {display.caption ? (
                    <Text variant="caption" style={{ color: colors.heroMuted }}>
                      {display.caption}
                    </Text>
                  ) : null}
                </View>
              </Row>
              <View style={{ gap: spacing.sm }}>
                <Text
                  numberOfLines={1}
                  style={{ color: colors.heroText, fontFamily: mono, fontSize: 14, letterSpacing: 1 }}
                >
                  {a.name}
                </Text>
                <Row justify="space-between">
                  <Text style={{ color: colors.heroText, fontFamily: mono, fontSize: 14, letterSpacing: 1 }}>
                    {a.last4 ? `•••• ${a.last4}` : ACCOUNT_TYPE_LABELS[a.type]}
                  </Text>
                  <Text style={{ color: colors.heroMuted, fontFamily: mono, fontSize: 13 }}>
                    {isCard
                      ? due
                        ? `due ${formatShortDate(due)}`
                        : 'credit'
                      : a.last4
                        ? ACCOUNT_TYPE_LABELS[a.type]
                        : ''}
                  </Text>
                </Row>
              </View>
            </View>
          </Pressable>
        );
      })}
      <Pressable
        onPress={() => router.push('/accounts/edit')}
        accessibilityRole="button"
        accessibilityLabel="Add payment method"
        style={({ pressed }) => ({
          width: 112,
          height: cardH,
          borderRadius: radius.xl,
          ...continuous,
          borderWidth: 1.5,
          borderStyle: 'dashed',
          borderColor: colors.borderStrong,
          backgroundColor: pressed ? colors.fill : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
        })}
      >
        <Icon name="add-circle" size={30} tone="brand" />
        <Text variant="footnote" tone="brand" style={{ fontWeight: '600' }}>
          Add card
        </Text>
      </Pressable>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// This week
// ---------------------------------------------------------------------------

/**
 * Seven day columns, each a recessed track with income (blue) and spending
 * (coral) as rounded bars from the bottom, on one shared scale. Tap a day for
 * its exact figures; today's letter is in the accent.
 */
export function WeekChart({ currency }: { currency: string }) {
  const { colors, scheme, elevation } = useTheme();
  const week = useWeekSeries();
  const [selected, setSelected] = useState<string | null>(null);
  const trackH = 112;
  const max = Math.max(1, ...week.days.map((d) => d.income + d.expense));
  const totals = week.days.reduce((s, d) => ({ in: s.in + d.income, out: s.out + d.expense }), {
    in: 0,
    out: 0,
  });
  const sel = week.days.find((d) => d.date === selected) ?? null;
  const money = (v: number) => formatMoney(v, currency, { decimals: 'never' });

  return (
    <View>
      <Row justify="space-between" style={{ marginBottom: spacing.md, paddingHorizontal: 2 }}>
        <Text variant="headline" accessibilityRole="header">
          This week
        </Text>
        <Row gap={spacing.md}>
          <Legend color={colors.income} label="Income" />
          <Legend color={colors.expense} label="Expense" />
        </Row>
      </Row>
      <View
        style={[
          {
            backgroundColor: colors.surface,
            borderRadius: radius.xl,
            ...continuous,
            padding: spacing.lg,
            paddingBottom: spacing.md,
          },
          scheme === 'light' ? elevation.card : null,
        ]}
      >
        <Text variant="footnote" tone="secondary" style={{ marginBottom: spacing.md }}>
          {sel
            ? `${formatDayLabel(sel.date)} · In ${money(sel.income)} · Out ${money(sel.expense)}`
            : `In ${money(totals.in)} · Out ${money(totals.out)}`}
        </Text>
        {week.data === undefined && !week.error ? (
          <Skeleton height={trackH + 22} rounded={radius.md} />
        ) : (
          <Row justify="space-between" align="flex-end">
            {week.days.map((d) => {
              const date = fromISODate(d.date);
              const isToday = d.date === week.today;
              const future = d.date > week.today;
              const hIn = d.income > 0 ? Math.max((d.income / max) * (trackH - 8), 6) : 0;
              const hOut = d.expense > 0 ? Math.max((d.expense / max) * (trackH - 8), 6) : 0;
              const letter = date.toLocaleDateString('en-IN', { weekday: 'narrow' });
              const on = selected === d.date;
              return (
                <Pressable
                  key={d.date}
                  onPress={() => {
                    haptic.selection();
                    setSelected(on ? null : d.date);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatDayLabel(d.date)}: income ${money(d.income)}, spent ${money(d.expense)}`}
                  style={{ alignItems: 'center', gap: spacing.sm, flex: 1 }}
                >
                  <View
                    style={{
                      width: 10,
                      height: trackH,
                      borderRadius: 5,
                      backgroundColor: on ? colors.brandSoft : colors.fill,
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      gap: 3,
                      paddingBottom: 0,
                      opacity: future ? 0.6 : 1,
                    }}
                  >
                    {hOut ? (
                      <View
                        style={{ width: 10, height: hOut, borderRadius: 5, backgroundColor: colors.expense }}
                      />
                    ) : null}
                    {hIn ? (
                      <View
                        style={{ width: 10, height: hIn, borderRadius: 5, backgroundColor: colors.income }}
                      />
                    ) : null}
                  </View>
                  <Text
                    variant="caption"
                    style={{
                      color: isToday ? colors.brand : colors.textTertiary,
                      fontWeight: isToday ? '800' : '600',
                    }}
                  >
                    {letter}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
        )}
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <Row gap={6}>
      <View style={{ width: 12, height: 4, borderRadius: 2, backgroundColor: color }} />
      <Text variant="footnote" tone="secondary">
        {label}
      </Text>
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Transactions as cards
// ---------------------------------------------------------------------------

/** Recent transactions grouped under day headings, one white card each. */
export function TransactionCards({ transactions }: { transactions: Transaction[] }) {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const day = toISODate(new Date(t.occurredAt));
    groups.set(day, [...(groups.get(day) ?? []), t]);
  }
  return (
    <View style={{ gap: spacing.lg }}>
      {[...groups.entries()].map(([day, list]) => (
        <View key={day} style={{ gap: spacing.sm + 2 }}>
          <Text variant="subhead" tone="secondary" style={{ paddingHorizontal: 2 }}>
            {formatDayLabel(day)}
          </Text>
          {list.map((t) => (
            <TransactionCard key={t.id} t={t} />
          ))}
        </View>
      ))}
    </View>
  );
}

export function TransactionCard({ t }: { t: Transaction }) {
  const { colors, scheme, elevation } = useTheme();
  const title = transactionTitle(t);
  const flow = transactionFlow(t);
  const isMove = t.type === 'transfer' || t.type === 'adjustment';
  const icon = isMove ? FLOW_ICONS[flow] : (t.categoryIcon ?? 'receipt-outline');
  const tint = isMove ? colors.transfer : (t.categoryColor ?? colors.brand);
  const amount = signedAmount(t);
  const subtitle = [formatTime(t.occurredAt), isMove ? t.accountName : t.categoryName]
    .filter(Boolean)
    .join(' · ');
  const text = formatMoney(amount, t.currency, { signed: t.type === 'income' });

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: t.id } })}
      disabled={t.pending}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${text.replace('−', 'minus ')}, ${subtitle}`}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.md,
          paddingRight: spacing.lg,
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          ...continuous,
          opacity: t.pending ? 0.7 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        scheme === 'light' ? elevation.card : null,
      ]}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: 15,
          ...continuous,
          backgroundColor: tint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={22} color={colors.heroText} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Row gap={6}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {title}
          </Text>
          {t.needsReview ? (
            <View
              accessibilityLabel="New from your bank, not reviewed yet"
              style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.highlight }}
            />
          ) : null}
        </Row>
        <Text variant="footnote" tone="tertiary" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Text
        style={[
          typography.amount,
          {
            fontWeight: '700',
            color:
              t.type === 'income' ? colors.positive : t.type === 'transfer' ? colors.transfer : colors.text,
          },
        ]}
      >
        {text}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Expenses: period pills + gradient category tiles
// ---------------------------------------------------------------------------

const PERIODS: { value: SpendPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '1w', label: '1W' },
  { value: '1m', label: '1M' },
  { value: '1y', label: '1Y' },
];

export function ExpenseTiles({
  currency,
  bleed = GUTTER,
}: {
  currency: string;
  /** How far the tile row scrolls past its container's padding (page gutter, or a card's padding). */
  bleed?: number;
}) {
  const { colors } = useTheme();
  const [period, setPeriod] = useState<SpendPeriod>('1m');
  const q = useCategorySpend(period);
  const cats = q.data ?? [];

  return (
    <View>
      <Row justify="space-between" style={{ marginBottom: spacing.md, paddingHorizontal: 2 }}>
        <Text variant="headline" accessibilityRole="header">
          Expenses
        </Text>
        <Pressable
          onPress={() => router.push('/reports')}
          hitSlop={12}
          accessibilityRole="link"
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Text variant="subhead" tone="brand">
            View all
          </Text>
          <Icon name="chevron-forward" size={14} tone="brand" />
        </Pressable>
      </Row>
      <Row gap={spacing.sm} style={{ marginBottom: spacing.lg }}>
        {PERIODS.map((p) => (
          <Chip
            key={p.value}
            label={p.label}
            selected={period === p.value}
            onPress={() => setPeriod(p.value)}
          />
        ))}
      </Row>
      {q.data === undefined && !q.error ? (
        <Skeleton height={150} rounded={radius.xl} />
      ) : cats.length === 0 ? (
        <View
          style={{
            height: 96,
            borderRadius: radius.xl,
            ...continuous,
            backgroundColor: colors.surfaceMuted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="callout" tone="secondary">
            {period === 'today' ? 'Nothing spent today' : 'No spending in this period'}
          </Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -bleed, marginVertical: -spacing.xxxl }}
          contentContainerStyle={{ gap: spacing.md, paddingHorizontal: bleed, paddingVertical: spacing.xxxl }}
        >
          {cats.map((c, i) => {
            const grad = colors.tileGradients[i % colors.tileGradients.length];
            const amount = formatMoney(c.total, currency, { decimals: 'auto' });
            return (
              <Pressable
                key={c.categoryId ?? c.name}
                onPress={() =>
                  c.categoryId
                    ? router.push({
                        pathname: '/report-detail',
                        params: { categoryId: c.categoryId, start: q.start, end: q.end },
                      })
                    : router.push('/reports')
                }
                accessibilityRole="button"
                accessibilityLabel={`${c.name}, ${amount}`}
                style={({ pressed }) => [
                  { width: 132, height: 156, borderRadius: radius.xl, ...continuous },
                  cardGlow(grad[1]),
                  { transform: [{ scale: pressed ? 0.96 : 1 }] },
                ]}
              >
                <View
                  style={{
                    flex: 1,
                    borderRadius: radius.xl,
                    ...continuous,
                    overflow: 'hidden',
                    padding: spacing.lg,
                    justifyContent: 'space-between',
                  }}
                >
                  <GradientFill colors={grad} angle="vertical" />
                  <Icon name={c.icon ?? 'pricetag-outline'} size={28} color={colors.heroText} />
                  <View style={{ gap: 2 }}>
                    <Text variant="footnote" numberOfLines={1} style={{ color: colors.heroMuted }}>
                      {c.name}
                    </Text>
                    <Text
                      style={[typography.headline, { color: colors.heroText, fontWeight: '700' }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      {amount}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

/** A soft glow in the card's own colour, kept tight enough not to need a huge scroll margin. */
function cardGlow(color: string) {
  return Platform.select({
    ios: { shadowColor: color, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
    web: { boxShadow: `0 8px 18px ${color}4D` } as object,
    default: { elevation: 6 },
  });
}
