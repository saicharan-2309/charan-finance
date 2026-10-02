/**
 * Financial calendar: actual daily totals for past days, projected recurring
 * items for future days (clearly labelled), and a projected balance.
 */
import { useQuery } from '@tanstack/react-query';
import { addMonths, endOfMonth, getDay, startOfMonth } from 'date-fns';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { LineChart } from '@/components/charts';
import { IconButton } from '@/components/ui/controls';
import { Skeleton } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, MoneyText, Row, Text } from '@/components/ui/primitives';
import { UpcomingRow } from '@/features/dashboard/widgets';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { useAccounts, useCurrency, useRecurring } from '@/hooks/data';
import { isLiquid, liquidBalance } from '@/lib/accounts';
import { projectBalance, upcomingItems } from '@/lib/cashflow';
import { addDaysISO, formatDayLabel, formatMonthLabel, fromISODate, todayISO, toISODate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { qk } from '@/lib/query';
import { fetchTimeSeries } from '@/services/reports';
import { fetchTransactionsPage } from '@/services/transactions';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function CalendarScreen() {
  const { colors } = useTheme();
  const currency = useCurrency();
  const today = todayISO();
  const [monthOffset, setMonthOffset] = useState(0);
  const [selected, setSelected] = useState(today);
  const accounts = useAccounts();
  const recurring = useRecurring();

  const monthDate = addMonths(startOfMonth(new Date()), monthOffset);
  const mStart = toISODate(monthDate);
  const mEnd = toISODate(endOfMonth(monthDate));

  const actual = useQuery({
    queryKey: qk.report('calendar-days', mStart, mEnd),
    queryFn: () => fetchTimeSeries(mStart, mEnd, 'day'),
    enabled: mStart <= today,
  });

  const dayTx = useQuery({
    queryKey: qk.report('calendar-day-tx', selected),
    queryFn: async () => {
      const d = fromISODate(selected);
      const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
      const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();
      return (await fetchTransactionsPage({ from, to }, 0)).items;
    },
    enabled: selected <= today,
  });

  const liquidIds = new Set(
    (accounts.data ?? []).filter((a) => a.isActive && isLiquid(a.type)).map((a) => a.id),
  );
  const startBalance = liquidBalance(accounts.data ?? [], currency);
  const horizon = mEnd > addDaysISO(today, 30) ? mEnd : addDaysISO(today, 30);
  const projected = upcomingItems(recurring.data ?? [], today, horizon);
  const projection = projectBalance(startBalance, projected, liquidIds, today, horizon);
  const monthEndPoint = projection.points.find((p) => p.date === (mEnd < today ? today : mEnd));

  const actualByDay = new Map((actual.data ?? []).map((p) => [p.bucket, p]));
  const projectedByDay = new Map<string, typeof projected>();
  for (const i of projected) {
    const day = i.date < today ? today : i.date;
    projectedByDay.set(day, [...(projectedByDay.get(day) ?? []), i]);
  }

  // Grid (weeks start Monday)
  const lead = (getDay(monthDate) + 6) % 7;
  const days: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = mStart; d <= mEnd; d = addDaysISO(d, 1)) days.push(d);
  while (days.length % 7) days.push(null);

  const selProjected = projectedByDay.get(selected) ?? [];
  const upcomingOut = projected
    .filter((i) => i.date <= mEnd && i.type !== 'income')
    .reduce((s, i) => s + i.amount, 0);
  const upcomingIn = projected
    .filter((i) => i.date <= mEnd && i.type === 'income')
    .reduce((s, i) => s + i.amount, 0);

  return (
    <Screen>
      {/* Projection summary */}
      <Card variant="elevated" style={{ padding: spacing.xl, gap: spacing.md, marginBottom: spacing.xl }}>
        <Row justify="space-between">
          <View>
            <Text variant="caption" tone="secondary">
              Current balance
            </Text>
            <MoneyText
              minor={startBalance}
              currency={currency}
              variant="headline"
              options={{ decimals: 'never' }}
            />
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="caption" tone="secondary">
              Projected · {formatMonthLabel(mEnd < today ? today : mEnd, true)}{' '}
              {fromISODate(mEnd < today ? today : mEnd).getDate()}
            </Text>
            {monthEndPoint ? (
              <MoneyText
                minor={monthEndPoint.balance}
                currency={currency}
                variant="headline"
                colorBySign={monthEndPoint.balance < 0}
                options={{ decimals: 'never' }}
              />
            ) : (
              <Text variant="headline">—</Text>
            )}
          </View>
        </Row>
        {mEnd >= today ? (
          <Text variant="footnote" tone="secondary">
            Upcoming this month: {formatMoney(upcomingOut, currency, { decimals: 'never' })} out
            {upcomingIn ? `, ${formatMoney(upcomingIn, currency, { decimals: 'never' })} in` : ''}.
            Projections come from your recurring items and are not recorded transactions.
          </Text>
        ) : null}
        {projection.lowestBalance < startBalance ? (
          <Text variant="footnote" tone={projection.lowestBalance < 0 ? 'negative' : 'secondary'}>
            Lowest projected point: {formatMoney(projection.lowestBalance, currency, { decimals: 'never' })}{' '}
            on {formatDayLabel(projection.lowestDate)}.
          </Text>
        ) : null}
      </Card>

      {/* Month grid */}
      <Card style={{ marginBottom: spacing.xl }}>
        <Row justify="space-between" style={{ marginBottom: spacing.md }}>
          <IconButton
            icon="chevron-back"
            label="Previous month"
            onPress={() => setMonthOffset((m) => m - 1)}
            size={36}
          />
          <Text variant="headline">{formatMonthLabel(monthDate)}</Text>
          <IconButton
            icon="chevron-forward"
            label="Next month"
            onPress={() => setMonthOffset((m) => m + 1)}
            size={36}
          />
        </Row>
        <View style={{ flexDirection: 'row' }}>
          {WEEKDAYS.map((w, i) => (
            <Text key={i} variant="caption" tone="tertiary" align="center" style={{ flex: 1 }}>
              {w}
            </Text>
          ))}
        </View>
        {Array.from({ length: days.length / 7 }, (_, week) => (
          <View key={week} style={{ flexDirection: 'row', marginTop: spacing.xs }}>
            {days.slice(week * 7, week * 7 + 7).map((d, i) => {
              if (!d) return <View key={i} style={{ flex: 1, height: 48 }} />;
              const a = actualByDay.get(d);
              const p = d >= today ? projectedByDay.get(d) : undefined;
              const isSel = d === selected;
              const isToday = d === today;
              return (
                <Pressable
                  key={d}
                  onPress={() => setSelected(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatDayLabel(d)}${a && (a.expense || a.income) ? `, spent ${formatMoney(a.expense, currency)}` : ''}${p?.length ? `, ${p.length} projected` : ''}`}
                  style={{
                    flex: 1,
                    height: 48,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: radius.md,
                    backgroundColor: isSel ? colors.text : 'transparent',
                  }}
                >
                  <Text
                    variant="subhead"
                    style={{
                      color: isSel
                        ? colors.background
                        : isToday
                          ? colors.brand
                          : d > today
                            ? colors.textSecondary
                            : colors.text,
                      fontWeight: isToday ? '700' : '500',
                    }}
                  >
                    {fromISODate(d).getDate()}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 3, height: 6, marginTop: 2 }}>
                    {a && a.income > 0 ? <Dot color={colors.positive} /> : null}
                    {a && a.expense > 0 ? <Dot color={colors.brand} /> : null}
                    {p?.length ? <Dot color={colors.info} hollow /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
        <Row gap={spacing.lg} style={{ marginTop: spacing.md }} wrap>
          <LegendDot color={colors.positive} label="Income" />
          <LegendDot color={colors.brand} label="Spending" />
          <LegendDot color={colors.info} label="Projected" hollow />
        </Row>
      </Card>

      {/* Selected day */}
      <Section title={formatDayLabel(selected)}>
        {selected <= today ? (
          dayTx.isPending ? (
            <Skeleton height={60} />
          ) : dayTx.data && dayTx.data.length ? (
            dayTx.data.map((t) => <TransactionRow key={t.id} t={t} />)
          ) : (
            <Text variant="footnote" tone="secondary">
              No transactions.
            </Text>
          )
        ) : null}
        {selProjected.length ? (
          <View style={{ marginTop: spacing.md }}>
            <Text variant="overline" tone="secondary">
              Projected
            </Text>
            {selProjected.map((i) => (
              <UpcomingRow
                key={i.key}
                item={i}
                currency={currency}
                onPress={() => router.push('/recurring')}
              />
            ))}
          </View>
        ) : selected > today ? (
          <Text variant="footnote" tone="secondary">
            Nothing scheduled.
          </Text>
        ) : null}
      </Section>

      <Section title="Projected balance (next 30+ days)">
        <Card>
          <LineChart
            currency={currency}
            color={colors.info}
            points={projection.points.map((p) => ({ label: formatDayLabel(p.date), value: p.balance }))}
            title="Liquid accounts · projection"
          />
        </Card>
      </Section>
    </Screen>
  );
}

function Dot({ color, hollow }: { color: string; hollow?: boolean }) {
  return (
    <View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: hollow ? 'transparent' : color,
        borderWidth: hollow ? 1.5 : 0,
        borderColor: color,
      }}
    />
  );
}

function LegendDot({ color, label, hollow }: { color: string; label: string; hollow?: boolean }) {
  return (
    <Row gap={6}>
      <Dot color={color} hollow={hollow} />
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
    </Row>
  );
}
