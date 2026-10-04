import { router, Stack } from 'expo-router';
import { Pressable, Switch, View } from 'react-native';

import { DonutChart, Legend } from '@/components/charts';
import { EmptyState, QueryState, useToast } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { useSeriesColor } from '@/features/dashboard/widgets';
import { useCategoryIndex, useCurrency, useDetectedRecurring, useRecurring } from '@/hooks/data';
import { formatDayLabel } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { formatMoney, minorToInput } from '@/lib/money';
import { invalidateFinancialData } from '@/lib/query';
import { describeFrequency, monthlyEquivalent, yearlyEquivalent } from '@/lib/recurrence';
import { setRecurringActive } from '@/services/planning';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';

const FREQ_COPY: Record<string, string> = {
  daily: 'a day',
  weekly: 'a week',
  monthly: 'a month',
  quarterly: 'a quarter',
  yearly: 'a year',
};

export default function SubscriptionsScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const currency = useCurrency();
  const q = useRecurring();
  const { index } = useCategoryIndex();
  const seriesColor = useSeriesColor();
  const detected = (useDetectedRecurring().data ?? []).filter((d) => !d.isTracked);

  return (
    <Screen>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push({ pathname: '/recurring/edit', params: { kind: 'subscription' } })}
              hitSlop={10}
            >
              <Text variant="bodyStrong" tone="brand">
                Add
              </Text>
            </Pressable>
          ),
        }}
      />
      {detected.length > 0 ? (
        <Section title="Found in your spending">
          <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
            {detected.slice(0, 8).map((d, i) => {
              const c = d.categoryId ? index.byId.get(d.categoryId) : null;
              return (
                <View key={d.merchantId}>
                  {i > 0 ? <Divider inset={52} /> : null}
                  <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                    <IconBadge icon={c?.icon ?? 'repeat'} color={c?.color} size={38} />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {d.merchantName}
                      </Text>
                      <Text variant="footnote" tone="secondary" numberOfLines={1}>
                        {formatMoney(d.typicalAmount, currency, { decimals: 'never' })}{' '}
                        {FREQ_COPY[d.frequency]}, next {formatDayLabel(d.nextDate).toLowerCase()}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: '/recurring/edit',
                          params: {
                            kind: 'subscription',
                            name: d.merchantName,
                            amount: minorToInput(d.lastAmount),
                            accountId: d.accountId ?? undefined,
                            categoryId: d.categoryId ?? undefined,
                            merchantId: d.merchantId,
                            frequency: d.frequency,
                            start: d.nextDate,
                          },
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Track ${d.merchantName}`}
                      hitSlop={8}
                    >
                      <Text variant="subhead" tone="brand">
                        Track
                      </Text>
                    </Pressable>
                  </Row>
                </View>
              );
            })}
          </Card>
          <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.sm }}>
            Charged at a steady rhythm for a steady amount. Track one to get renewal reminders.
          </Text>
        </Section>
      ) : null}
      <QueryState query={q}>
        {(all) => {
          const subs = all.filter((r) => r.kind === 'subscription' && r.type === 'expense');
          if (subs.length === 0) {
            return (
              <EmptyState
                icon="repeat"
                title="No subscriptions tracked"
                message="Add Netflix, Spotify, iCloud, gym or insurance to see what they cost you each month and year."
                actionLabel="Add subscription"
                onAction={() =>
                  router.push({ pathname: '/recurring/edit', params: { kind: 'subscription' } })
                }
              />
            );
          }
          const active = subs.filter((s) => s.isActive && s.currency === currency);
          const monthly = active.reduce(
            (s, r) => s + monthlyEquivalent(r.amount, r.frequency, r.intervalCount),
            0,
          );
          const yearly = active.reduce(
            (s, r) => s + yearlyEquivalent(r.amount, r.frequency, r.intervalCount),
            0,
          );
          const byCategory = new Map<string, number>();
          for (const s of active) {
            const key = s.categoryId ?? 'none';
            byCategory.set(
              key,
              (byCategory.get(key) ?? 0) + monthlyEquivalent(s.amount, s.frequency, s.intervalCount),
            );
          }
          const segments = [...byCategory.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([cid, v], i) => {
              const c = index.byId.get(cid);
              return {
                key: cid,
                label: c?.name ?? 'Uncategorised',
                value: v,
                color: seriesColor(i),
              };
            });
          const upcoming = [...active]
            .filter((s) => s.nextDueDate)
            .sort((a, b) => (a.nextDueDate! < b.nextDueDate! ? -1 : 1));

          return (
            <>
              <Card
                variant="elevated"
                style={{ padding: spacing.xl, gap: spacing.lg, marginBottom: spacing.xxl }}
              >
                <Row align="center" gap={spacing.xl}>
                  <DonutChart size={120} thickness={16} segments={segments} />
                  <View style={{ flex: 1, gap: spacing.md }}>
                    <View>
                      <Text variant="caption" tone="secondary">
                        Per month
                      </Text>
                      <MoneyText
                        minor={monthly}
                        currency={currency}
                        variant="amountLarge"
                        options={{ decimals: 'never' }}
                      />
                    </View>
                    <View>
                      <Text variant="caption" tone="secondary">
                        Per year
                      </Text>
                      <MoneyText
                        minor={yearly}
                        currency={currency}
                        variant="headline"
                        options={{ decimals: 'never' }}
                      />
                    </View>
                  </View>
                </Row>
                <Legend
                  series={segments.map((s) => ({
                    name: `${s.label} ${formatMoney(s.value, currency, { decimals: 'never' })}/mo`,
                    color: s.color,
                  }))}
                />
              </Card>

              <Section title="Upcoming renewals">
                <Card style={{ paddingVertical: spacing.xs }}>
                  {upcoming.slice(0, 6).map((s, i) => (
                    <View key={s.id}>
                      {i > 0 ? <Divider /> : null}
                      <Row justify="space-between" style={{ paddingVertical: spacing.md }}>
                        <Text variant="body">{s.name}</Text>
                        <Text variant="callout" tone="secondary">
                          {formatDayLabel(s.nextDueDate!)} · {formatMoney(s.amount, s.currency)}
                        </Text>
                      </Row>
                    </View>
                  ))}
                </Card>
              </Section>

              <Section title="All subscriptions">
                <Card style={{ paddingVertical: spacing.xs }}>
                  {subs.map((s, i) => {
                    const c = s.categoryId ? index.byId.get(s.categoryId) : null;
                    return (
                      <View key={s.id}>
                        {i > 0 ? <Divider inset={52} /> : null}
                        <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                          <Pressable
                            onPress={() => router.push({ pathname: '/recurring/edit', params: { id: s.id } })}
                            style={{ flex: 1, flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}
                            accessibilityRole="button"
                          >
                            <IconBadge icon={c?.icon ?? 'repeat'} color={c?.color} size={38} />
                            <View style={{ flex: 1 }}>
                              <Text variant="bodyStrong" tone={s.isActive ? 'primary' : 'tertiary'}>
                                {s.name}
                              </Text>
                              <Text variant="footnote" tone="secondary">
                                {formatMoney(s.amount, s.currency)} ·{' '}
                                {describeFrequency(s.frequency, s.intervalCount)}
                              </Text>
                            </View>
                          </Pressable>
                          <Switch
                            value={s.isActive}
                            trackColor={{ true: colors.brand, false: colors.borderStrong }}
                            accessibilityLabel={`${s.name} active`}
                            onValueChange={async (v) => {
                              try {
                                await setRecurringActive(s.id, v);
                                await invalidateFinancialData();
                              } catch (e) {
                                toast.show(describeError(e).message, 'error');
                              }
                            }}
                          />
                        </Row>
                      </View>
                    );
                  })}
                </Card>
              </Section>
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}
