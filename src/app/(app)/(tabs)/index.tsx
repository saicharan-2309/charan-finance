/**
 * Home — answers at a glance: How much do I have? What did I spend and save?
 * Where did it go? Am I within budget? What's coming up? How are my goals and
 * net worth doing? Every number comes from the database.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { BarChart } from '@/components/charts';
import { AnimatedMoney, EmptyState, ErrorState, ProgressBar, Skeleton } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, Icon, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import {
  BudgetRow,
  CategoryBreakdown,
  InsightCard,
  SavingsRatePill,
  UpcomingRow,
} from '@/features/dashboard/widgets';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { PendingTransactions, SyncBanner } from '@/features/transactions/SyncStatus';
import {
  useAccounts,
  useBudgetStatus,
  useDashboard,
  useGoals,
  useProfile,
  useRecentTransactions,
  useRecurring,
  useSettings,
} from '@/hooks/data';
import { computeNetWorth, creditCardDues, isLiquid, liquidBalance } from '@/lib/accounts';
import { availableBalance, liquidDelta, upcomingItems } from '@/lib/cashflow';
import { addDaysISO, formatMonthLabel, fromISODate, monthRange, todayISO } from '@/lib/dates';
import { generateInsights, savingsRate } from '@/lib/insights';
import { formatMoney, type Minor } from '@/lib/money';
import { notifyBudgetThresholds } from '@/lib/notifications';
import { invalidateFinancialData } from '@/lib/query';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function HomeScreen() {
  const { colors } = useTheme();
  const profile = useProfile();
  const dashboard = useDashboard();
  const accounts = useAccounts();
  const recurring = useRecurring();
  const budgets = useBudgetStatus();
  const goals = useGoals();
  const recent = useRecentTransactions(6);
  const settings = useSettings();
  const [refreshing, setRefreshing] = useState(false);

  const today = todayISO();
  const month = monthRange(fromISODate(today));
  const d = dashboard.data;
  const currency = d?.currency ?? profile.data?.defaultCurrency ?? 'INR';

  const derived = (() => {
    if (!d) return null;
    const accts = d.accounts.map((a) => ({ ...a, isActive: true }));
    const liquidIds = new Set(d.accounts.filter((a) => isLiquid(a.type)).map((a) => a.id));
    const cardIds = new Set(d.accounts.filter((a) => a.type === 'credit_card').map((a) => a.id));
    const liquid = liquidBalance(accts, currency);
    const dues = creditCardDues(accts, currency);
    const items = upcomingItems(recurring.data ?? [], today, addDaysISO(today, 30));
    const thisMonth = items.filter((i) => i.date <= month.end);
    const outflow30 = items.reduce((s, i) => (i.type !== 'income' ? s + i.amount : s), 0) as Minor;
    const outflowCount = items.filter((i) => i.type !== 'income').length;
    const available = availableBalance(liquid, dues, thisMonth, liquidIds, cardIds, month.end);
    const committed = thisMonth.reduce((s, i) => s + Math.max(-liquidDelta(i, liquidIds), 0), 0);
    const nw = computeNetWorth(accts, currency);
    const insights = generateInsights({
      currency,
      month,
      today,
      current: d.current,
      previous: d.previous,
      categories: d.categories,
      previousCategories: d.previousCategories,
      upcomingOutflow30d: outflow30,
      upcomingCount30d: outflowCount,
    });
    return { liquid, dues, items, available, committed, nw, insights };
  })();

  // One-time local alerts when a budget crosses its threshold (deduplicated per period).
  useEffect(() => {
    if (budgets.data && settings.data) void notifyBudgetThresholds(budgets.data, settings.data);
  }, [budgets.data, settings.data]);

  const refresh = async () => {
    setRefreshing(true);
    await invalidateFinancialData();
    setRefreshing(false);
  };

  const name = profile.data?.displayName?.split(' ')[0];
  const noAccounts = accounts.data && accounts.data.length === 0;

  return (
    <Screen
      safeTop
      tabBarInset
      title={name ? `${greeting()}, ${name}` : greeting()}
      subtitle={formatMonthLabel(today)}
      refreshing={refreshing}
      onRefresh={refresh}
      headerRight={
        <Pressable
          onPress={() => router.push('/insights')}
          accessibilityRole="button"
          accessibilityLabel="Insights"
          hitSlop={8}
        >
          <IconBadge icon="sparkles" color={colors.brand} size={40} />
        </Pressable>
      }
    >
      <SyncBanner />

      {noAccounts ? (
        <Card style={{ marginBottom: spacing.xxl }}>
          <EmptyState
            compact
            icon="wallet-outline"
            title="Add your first account"
            message="Start with your bank account, cash or a credit card. Balances update automatically as you add transactions."
            actionLabel="Add account"
            onAction={() => router.push('/accounts/edit')}
          />
        </Card>
      ) : null}

      {dashboard.error && !d ? (
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : null}

      {/* Hero */}
      <Card variant="elevated" style={{ marginBottom: spacing.xl, padding: spacing.xl, gap: spacing.lg }}>
        <View style={{ gap: 4 }}>
          <Text variant="overline" tone="secondary">
            Total balance
          </Text>
          {derived ? (
            <AnimatedMoney minor={derived.liquid} currency={currency} variant="display" />
          ) : (
            <Skeleton width={200} height={42} />
          )}
          {derived ? (
            <Pressable onPress={() => router.push('/net-worth')} accessibilityRole="link">
              <Text variant="footnote" tone="secondary">
                Net worth{' '}
                <Text variant="footnote" style={{ fontWeight: '600' }}>
                  {formatShort(derived.nw.netWorth, currency)}
                </Text>{' '}
                ›
              </Text>
            </Pressable>
          ) : null}
        </View>

        <Divider />
        <Row gap={spacing.md} align="flex-start">
          <HeroStat label="Income" value={d?.current.income} currency={currency} tone="positive" />
          <HeroStat label="Expenses" value={d?.current.expense} currency={currency} />
          <HeroStat
            label="Saved"
            value={d?.current.net}
            currency={currency}
            tone={d && d.current.net < 0 ? 'negative' : 'primary'}
          />
        </Row>
        <Row justify="space-between">
          <SavingsRatePill rate={d ? savingsRate(d.current) : null} />
          <Text variant="caption" tone="tertiary">
            This month
          </Text>
        </Row>
        {derived && (derived.dues > 0 || derived.committed > 0) ? (
          <Pressable
            onPress={() => router.push('/calendar')}
            accessibilityRole="button"
            style={{
              backgroundColor: colors.surfaceMuted,
              borderRadius: radius.md,
              padding: spacing.md,
              gap: 2,
            }}
          >
            <Row justify="space-between">
              <Text variant="subhead">Available balance</Text>
              <MoneyText
                minor={derived.available}
                currency={currency}
                variant="bodyStrong"
                options={{ decimals: 'never' }}
                colorBySign={derived.available < 0}
              />
            </Row>
            <Text variant="caption" tone="secondary">
              After card dues and recurring payments due by month end (projection).
            </Text>
          </Pressable>
        ) : null}
      </Card>

      {/* Quick actions */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -20, marginBottom: spacing.xxl }}
        contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: 20 }}
      >
        <QuickAction
          icon="remove-circle-outline"
          label="Expense"
          onPress={() => router.push('/transaction/new')}
        />
        <QuickAction
          icon="add-circle-outline"
          label="Income"
          onPress={() => router.push({ pathname: '/transaction/new', params: { type: 'income' } })}
        />
        <QuickAction
          icon="swap-horizontal"
          label="Transfer"
          onPress={() => router.push({ pathname: '/transaction/new', params: { type: 'transfer' } })}
        />
        <QuickAction icon="scan-outline" label="Scan receipt" onPress={() => router.push('/receipt-scan')} />
        <QuickAction icon="calendar-outline" label="Calendar" onPress={() => router.push('/calendar')} />
      </ScrollView>

      {/* Insights */}
      {derived && derived.insights.length > 0 ? (
        <Section title="Insights" action="See all" onAction={() => router.push('/insights')}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -20 }}
            contentContainerStyle={{ gap: spacing.md, paddingHorizontal: 20 }}
          >
            {derived.insights.slice(0, 3).map((i) => (
              <InsightCard key={i.id} insight={i} compact />
            ))}
          </ScrollView>
        </Section>
      ) : null}

      {/* Budgets */}
      <Section
        title="Budgets"
        action={budgets.data?.length ? 'Manage' : undefined}
        onAction={() => router.push('/budgets')}
      >
        {budgets.data === undefined ? (
          <Skeleton height={90} rounded={radius.xl} />
        ) : budgets.data.length === 0 ? (
          <Card onPress={() => router.push('/budgets/edit')}>
            <Row gap={spacing.md}>
              <IconBadge icon="speedometer-outline" color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">Set a monthly budget</Text>
                <Text variant="footnote" tone="secondary">
                  Track spending limits by category.
                </Text>
              </View>
              <Icon name="chevron-forward" size={18} tone="tertiary" />
            </Row>
          </Card>
        ) : (
          <Card style={{ gap: spacing.lg }}>
            {budgets.data.slice(0, 4).map((r) => (
              <BudgetRow
                key={r.itemId}
                row={r}
                currency={currency}
                warningPercent={settings.data?.budgetWarningPercent ?? 80}
              />
            ))}
          </Card>
        )}
      </Section>

      {/* Upcoming */}
      <Section title="Upcoming payments" action="Calendar" onAction={() => router.push('/calendar')}>
        {derived && derived.items.length > 0 ? (
          <Card style={{ paddingVertical: spacing.sm }}>
            {derived.items.slice(0, 4).map((i, idx) => (
              <View key={i.key}>
                {idx > 0 ? <Divider inset={50} /> : null}
                <UpcomingRow item={i} currency={currency} onPress={() => router.push('/recurring')} />
              </View>
            ))}
          </Card>
        ) : (
          <Card onPress={() => router.push('/recurring/edit')}>
            <Row gap={spacing.md}>
              <IconBadge icon="repeat" color={colors.info} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">Nothing due in the next 30 days</Text>
                <Text variant="footnote" tone="secondary">
                  Add rent, bills, subscriptions or salary to see what’s coming.
                </Text>
              </View>
            </Row>
          </Card>
        )}
      </Section>

      {/* Where the money went */}
      <Section title="Where your money went" action="Reports" onAction={() => router.push('/reports')}>
        <Card>
          {!d ? (
            <Skeleton height={220} />
          ) : d.categories.length === 0 ? (
            <EmptyState
              compact
              icon="pie-chart-outline"
              title="No spending yet this month"
              message="Your category breakdown appears as you add expenses."
            />
          ) : (
            <CategoryBreakdown
              categories={d.categories}
              currency={currency}
              max={6}
              onPressCategory={(c) =>
                router.push({
                  pathname: '/report-detail',
                  params: { categoryId: c.categoryId!, start: month.start, end: month.end },
                })
              }
            />
          )}
        </Card>
      </Section>

      {/* Trend */}
      <Section title="Monthly trend">
        <Card>
          {d ? (
            <BarChart
              currency={currency}
              series={[
                { name: 'Income', color: colors.positive },
                { name: 'Expenses', color: colors.brand },
              ]}
              data={d.trend.map((p) => ({
                label: formatMonthLabel(p.bucket, true),
                values: [p.income, p.expense],
              }))}
            />
          ) : (
            <Skeleton height={200} />
          )}
          {d && d.previous.expense > 0 ? (
            <Text variant="footnote" tone="secondary" style={{ marginTop: spacing.md }}>
              {comparison(d.current.expense, d.previous.expense, currency)}
            </Text>
          ) : null}
        </Card>
      </Section>

      {/* Top merchants */}
      {d && d.merchants.length > 0 ? (
        <Section title="Top merchants" action="All" onAction={() => router.push('/merchants')}>
          <Card style={{ paddingVertical: spacing.sm }}>
            {d.merchants.map((m, i) => (
              <Pressable
                key={m.merchantId}
                onPress={() => router.push({ pathname: '/merchants/[id]', params: { id: m.merchantId } })}
                accessibilityRole="button"
              >
                {i > 0 ? <Divider inset={48} /> : null}
                <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 12,
                      backgroundColor: colors.surfaceMuted,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text variant="bodyStrong">{m.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {m.name}
                    </Text>
                    <Text variant="footnote" tone="secondary">
                      {m.count} {m.count === 1 ? 'transaction' : 'transactions'}
                    </Text>
                  </View>
                  <MoneyText minor={m.total} currency={currency} options={{ decimals: 'never' }} />
                </Row>
              </Pressable>
            ))}
          </Card>
        </Section>
      ) : null}

      {/* Goals */}
      <Section
        title="Savings goals"
        action={goals.data?.length ? 'All goals' : undefined}
        onAction={() => router.push('/goals')}
      >
        {goals.data && goals.data.filter((g) => !g.isArchived).length > 0 ? (
          <Card style={{ gap: spacing.lg }}>
            {goals.data
              .filter((g) => !g.isArchived)
              .slice(0, 3)
              .map((g) => (
                <Pressable
                  key={g.id}
                  onPress={() => router.push({ pathname: '/goals/[id]', params: { id: g.id } })}
                  style={{ gap: spacing.sm }}
                  accessibilityRole="button"
                >
                  <Row justify="space-between">
                    <Row gap={spacing.sm}>
                      <IconBadge icon={g.icon ?? 'flag-outline'} color={g.color} size={30} />
                      <Text variant="bodyStrong">{g.name}</Text>
                    </Row>
                    <Text variant="subhead" tone="secondary">
                      {Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100))}%
                    </Text>
                  </Row>
                  <ProgressBar
                    progress={g.currentAmount / g.targetAmount}
                    color={g.color ?? colors.positive}
                  />
                  <Text variant="caption" tone="secondary">
                    {formatShort(g.currentAmount, g.currency)} of {formatShort(g.targetAmount, g.currency)}
                  </Text>
                </Pressable>
              ))}
          </Card>
        ) : (
          <Card onPress={() => router.push('/goals/edit')}>
            <Row gap={spacing.md}>
              <IconBadge icon="flag-outline" color={colors.positive} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">Create a savings goal</Text>
                <Text variant="footnote" tone="secondary">
                  See how much to save each month to get there.
                </Text>
              </View>
            </Row>
          </Card>
        )}
      </Section>

      {/* Recent */}
      <Section title="Recent transactions" action="See all" onAction={() => router.push('/transactions')}>
        <PendingTransactions />
        {recent.data === undefined ? (
          <Skeleton height={160} rounded={radius.xl} />
        ) : recent.data.length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon="receipt-outline"
              title="No transactions yet"
              message="Tap + to add your first expense."
            />
          </Card>
        ) : (
          <View>
            {recent.data.map((t) => (
              <TransactionRow key={t.id} t={t} showDate />
            ))}
          </View>
        )}
      </Section>
    </Screen>
  );
}

function formatShort(minor: number, currency: string) {
  return formatMoney(minor, currency, { decimals: 'never' });
}

function comparison(cur: number, prev: number, currency: string) {
  const diff = cur - prev;
  const f = formatShort(Math.abs(diff), currency);
  return diff > 0
    ? `${f} more spent so far than all of last month.`
    : `${f} less spent so far than all of last month.`;
}

function HeroStat({
  label,
  value,
  currency,
  tone = 'primary',
}: {
  label: string;
  value: number | undefined;
  currency: string;
  tone?: 'primary' | 'positive' | 'negative';
}) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      {value === undefined ? (
        <Skeleton width={70} height={18} />
      ) : (
        <MoneyText
          minor={value}
          currency={currency}
          variant="bodyStrong"
          tone={tone}
          options={{ decimals: 'never' }}
          numberOfLines={1}
          adjustsFontSizeToFit
        />
      )}
    </View>
  );
}

function QuickAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 44,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.pill,
        backgroundColor: pressed ? colors.border : colors.surfaceMuted,
      })}
    >
      <Icon name={icon} size={18} />
      <Text variant="subhead">{label}</Text>
    </Pressable>
  );
}
