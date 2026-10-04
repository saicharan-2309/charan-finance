/**
 * Home — the financial situation, not a transaction log.
 *
 * Order: greeting → this month at a glance → the accounts money sits in →
 * what is coming up → where it went → budgets, goals and trend → recent
 * activity. Every number comes from the database; nothing is illustrative.
 */
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { BarChart } from '@/components/charts';
import { AnimatedMoney, EmptyState, ErrorState, ProgressBar, Skeleton } from '@/components/ui/feedback';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, Icon, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import {
  AccountStrip,
  BudgetRow,
  CategoryBreakdown,
  InsightCard,
  SavingsRatePill,
} from '@/features/dashboard/widgets';
import { TransactionRow } from '@/features/transactions/TransactionRow';
import { PendingTransactions, SyncBanner } from '@/features/transactions/SyncStatus';
import {
  useAccounts,
  useBudgetStatus,
  useCategoryIndex,
  useDashboard,
  useGoals,
  useLoans,
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
import { cardDates, cardStanding } from '@/lib/payment-methods';
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
  const loans = useLoans();
  const budgets = useBudgetStatus();
  const goals = useGoals();
  const recent = useRecentTransactions(6);
  const settings = useSettings();
  const { index: cats } = useCategoryIndex();
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

  /**
   * Upcoming, in one list: recurring bills and subscriptions, EMI instalments,
   * and credit-card bills due. Card dues are shown as what is owed, with the
   * card's own due date — they are payments, not new spending.
   */
  const upcoming = useMemo(() => {
    const rows: {
      key: string;
      title: string;
      subtitle: string;
      amount: Minor;
      date: string;
      icon: string;
      color: string | null;
      onPress: () => void;
      overdue: boolean;
    }[] = [];

    // One row per commitment: when several occurrences of the same bill are
    // outstanding, the earliest stands for it rather than filling the list.
    const seen = new Set<string>();
    for (const i of derived?.items ?? []) {
      if (seen.has(i.recurringId)) continue;
      seen.add(i.recurringId);
      const cat = i.categoryId ? cats.byId.get(i.categoryId) : null;
      rows.push({
        key: i.key,
        title: i.name,
        subtitle: i.type === 'income' ? 'Expected' : (cat?.name ?? 'Recurring'),
        amount: i.amount,
        date: i.date,
        icon: cat?.icon ?? (i.kind === 'subscription' ? 'repeat' : 'receipt-outline'),
        color: cat?.color ?? null,
        onPress: () => router.push('/recurring'),
        overdue: i.overdue,
      });
    }

    for (const a of accounts.data ?? []) {
      if (!a.isActive || a.type !== 'credit_card') continue;
      const standing = cardStanding(a);
      if (standing.used <= 0) continue;
      const due = cardDates(a, today).nextDue;
      rows.push({
        key: `card-${a.id}`,
        title: a.name,
        subtitle: a.dueDay ? 'Card bill due' : 'Card balance outstanding',
        amount: standing.used,
        date: due ?? addDaysISO(today, 31),
        icon: 'card-outline',
        color: a.color,
        onPress: () => router.push({ pathname: '/accounts/[id]', params: { id: a.id } }),
        overdue: false,
      });
    }

    return rows.sort((x, y) => x.date.localeCompare(y.date)).slice(0, 5);
  }, [accounts.data, cats, derived?.items, today]);

  const emis = (loans.data ?? []).filter((l) => !l.isClosed);

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
      subtitle={`${formatMonthLabel(today)} overview`}
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
            title="Add your first payment method"
            message="Start with wherever your money sits — a bank account, cash, a UPI app or a card. Balances update themselves as you record transactions."
            actionLabel="Add payment method"
            onAction={() => router.push('/accounts/edit')}
          />
        </Card>
      ) : null}

      {dashboard.error && !d ? (
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : null}

      {/* This month at a glance */}
      <Card variant="elevated" style={{ marginBottom: spacing.xxl, padding: spacing.xl, gap: spacing.lg }}>
        <View style={{ gap: 2 }}>
          <Text variant="overline" tone="secondary">
            Spent this month
          </Text>
          {d ? (
            <AnimatedMoney minor={d.current.expense} currency={currency} variant="display" />
          ) : (
            <Skeleton width={200} height={42} />
          )}
        </View>

        <Divider />

        <Row gap={spacing.md} align="flex-start">
          <HeroStat label="Income" value={d?.current.income} currency={currency} tone="positive" />
          <HeroStat
            label="Left over"
            value={d?.current.net}
            currency={currency}
            tone={d && d.current.net < 0 ? 'negative' : 'primary'}
          />
          <HeroStat label="In accounts" value={derived?.liquid} currency={currency} />
        </Row>

        <Row justify="space-between">
          <SavingsRatePill rate={d ? savingsRate(d.current) : null} />
          {derived ? (
            <Pressable onPress={() => router.push('/net-worth')} accessibilityRole="link" hitSlop={6}>
              <Text variant="caption" tone="secondary">
                Net worth{' '}
                <Text variant="caption" style={{ fontWeight: '700' }}>
                  {formatShort(derived.nw.netWorth, currency)}
                </Text>{' '}
                ›
              </Text>
            </Pressable>
          ) : null}
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
              After card dues and payments due by month end (projection).
            </Text>
          </Pressable>
        ) : null}
      </Card>

      {/* Accounts */}
      {accounts.data?.length ? (
        <Section title="Accounts" action="Manage" onAction={() => router.push('/accounts')}>
          <AccountStrip accounts={accounts.data} />
        </Section>
      ) : null}

      {/* Upcoming */}
      <Section title="Upcoming" action="Calendar" onAction={() => router.push('/calendar')}>
        {upcoming.length > 0 ? (
          <Card padded={false} style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
            {upcoming.map((u, idx) => {
              const { key, ...item } = u;
              return (
                <View key={key}>
                  {idx > 0 ? <Divider inset={50} /> : null}
                  <UpcomingItem {...item} currency={currency} />
                </View>
              );
            })}
          </Card>
        ) : (
          <Card onPress={() => router.push('/recurring/edit')}>
            <Row gap={spacing.md}>
              <IconBadge icon="repeat" color={colors.info} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">Nothing due in the next 30 days</Text>
                <Text variant="footnote" tone="secondary">
                  Add rent, bills, subscriptions, an EMI or your salary to see what’s coming.
                </Text>
              </View>
            </Row>
          </Card>
        )}
      </Section>

      {/* EMIs */}
      {emis.length ? (
        <Section title="Loans & EMIs" action="All" onAction={() => router.push('/emi')}>
          <Card padded={false} style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
            {emis.slice(0, 3).map((l, i) => (
              <View key={l.id}>
                {i > 0 ? <Divider inset={50} /> : null}
                <Pressable
                  onPress={() => router.push({ pathname: '/emi/edit', params: { id: l.id } })}
                  accessibilityRole="button"
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
                    <IconBadge
                      icon={l.icon ?? 'calendar-number-outline'}
                      color={l.color ?? l.categoryColor}
                      size={38}
                    />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong" numberOfLines={1}>
                        {l.name}
                      </Text>
                      <Text variant="footnote" tone="secondary" numberOfLines={1}>
                        {l.accountName}
                        {l.tenureMonths ? ` · ${l.paidCount}/${l.tenureMonths} paid` : ''}
                      </Text>
                    </View>
                    <MoneyText minor={l.emiAmount} currency={l.currency} options={{ decimals: 'never' }} />
                  </Row>
                </Pressable>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {/* Spending */}
      <Section title="Spending" action="Reports" onAction={() => router.push('/reports')}>
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

      {/* Recent transactions */}
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
              message="Tap + to record an expense, income or transfer."
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
          <Card style={{ gap: spacing.xl }}>
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

      {/* Goals */}
      <Section
        title="Savings goals"
        action={goals.data?.length ? 'All goals' : undefined}
        onAction={() => router.push('/goals')}
      >
        {goals.data && goals.data.filter((g) => !g.isArchived).length > 0 ? (
          <Card style={{ gap: spacing.xl }}>
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

/** One row of the Upcoming list — a recurring item, an EMI or a card bill. */
function UpcomingItem({
  title,
  subtitle,
  amount,
  date,
  icon,
  color,
  currency,
  overdue,
  onPress,
}: {
  title: string;
  subtitle: string;
  amount: Minor;
  date: string;
  icon: string;
  color: string | null;
  currency: string;
  overdue: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${formatMoney(amount, currency)}, ${subtitle}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <Row gap={spacing.md} style={{ paddingVertical: spacing.md }}>
        <IconBadge icon={icon} color={color} size={38} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="footnote" tone="secondary" numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <MoneyText minor={amount} currency={currency} options={{ decimals: 'never' }} />
          <Text variant="caption" tone={overdue ? 'negative' : 'secondary'}>
            {overdue ? 'Overdue' : shortDate(date)}
          </Text>
        </View>
      </Row>
    </Pressable>
  );
}

function shortDate(iso: string) {
  return fromISODate(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
