/**
 * Home, built on balance groups.
 *
 * Order: header (insights · BUD · you) → your balance groups (the first on the
 * BUD gradient, with what is safe to spend until payday; cash and credit are
 * never added together) → quick actions → payment-method cards → anything
 * bank sync wants checked → the top insight → friends → this week → recent
 * transactions → expenses by category → the monthly budget → upcoming → goals.
 * Every number comes from the database; nothing is illustrative.
 */
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { HeaderButton } from '@/components/ui/controls';
import { EmptyState, ErrorState, ProgressBar, Skeleton } from '@/components/ui/feedback';
import { GradientFill } from '@/components/ui/gradient';
import { Screen, Section } from '@/components/ui/layout';
import { Card, Divider, Icon, IconBadge, MoneyText, Row, Text } from '@/components/ui/primitives';
import { BankSyncCard } from '@/features/bank-sync/BankSyncCard';
import { AccountCarousel, ExpenseTiles, TransactionCards, WeekChart } from '@/features/dashboard/home-cards';
import {
  BalanceGroupsHero,
  FriendsSummaryCard,
  InsightTeaser,
  QuickActions,
} from '@/features/dashboard/home-top';
import { BudgetGauge, BudgetRow } from '@/features/dashboard/widgets';
import { useInsights } from '@/features/insights/useInsights';
import { PendingTransactions, SyncBanner } from '@/features/transactions/SyncStatus';
import {
  useAccounts,
  useBalanceGroups,
  useBudgetStatus,
  useCategoryIndex,
  useCycle,
  useDashboard,
  useFriendsTotals,
  useGoals,
  useProfile,
  useRecentTransactions,
  useRecurring,
  useSettings,
  useWeekSeries,
} from '@/hooks/data';
import { creditCardDues, isLiquid, liquidBalance } from '@/lib/accounts';
import { availableBalance, upcomingItems } from '@/lib/cashflow';
import { addDaysISO, daysLeft, fromISODate, todayISO } from '@/lib/dates';
import { formatMoney, type Minor } from '@/lib/money';
import { cardDates, cardStanding } from '@/lib/payment-methods';
import { notifyBudgetThresholds } from '@/lib/notifications';
import { invalidateFinancialData } from '@/lib/query';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spacing } from '@/theme/tokens';

export default function HomeScreen() {
  const { colors } = useTheme();
  const profile = useProfile();
  const dashboard = useDashboard();
  const accounts = useAccounts();
  const recurring = useRecurring();
  const budgets = useBudgetStatus();
  const goals = useGoals();
  const recent = useRecentTransactions(6);
  const week = useWeekSeries();
  const balanceGroups = useBalanceGroups();
  const friendsTotals = useFriendsTotals();
  const insights = useInsights();
  const settings = useSettings();
  const { index: cats } = useCategoryIndex();
  const [refreshing, setRefreshing] = useState(false);

  const today = todayISO();
  const month = useCycle();
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
    const thisCycle = items.filter((i) => i.date <= month.end);
    const available = availableBalance(liquid, dues, thisCycle, liquidIds, cardIds, month.end);
    return { items, available, liquid, hasAccounts: d.accounts.length > 0 };
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

  // One-time local alerts when a budget crosses its threshold (deduplicated per period).
  useEffect(() => {
    if (budgets.data && settings.data) void notifyBudgetThresholds(budgets.data, settings.data);
  }, [budgets.data, settings.data]);

  const refresh = async () => {
    setRefreshing(true);
    await invalidateFinancialData();
    setRefreshing(false);
  };

  const overallBudget = budgets.data?.find((r) => r.categoryId === null) ?? null;
  const name = profile.data?.displayName ?? '';
  const noAccounts = accounts.data && accounts.data.filter((a) => !a.systemKind).length === 0;
  const spentToday = week.data ? (week.days.find((x) => x.date === today)?.expense ?? 0) : null;
  const left = daysLeft(month, today);
  const perDay = derived && derived.available > 0 && left > 0 ? derived.available / left : null;
  const endLabel = fromISODate(month.end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  return (
    <Screen safeTop tabBarInset refreshing={refreshing} onRefresh={refresh}>
      {/* Header: insights · BUD · you */}
      <Row justify="space-between" style={{ marginBottom: spacing.xl }}>
        <HeaderButton icon="sparkles" label="Insights" onPress={() => router.push('/insights')} />
        <Text
          accessibilityRole="header"
          accessibilityLabel="BUD, Home"
          style={{ fontSize: 22, fontWeight: '800', letterSpacing: 3, color: colors.text }}
        >
          BUD
        </Text>
        <Pressable
          onPress={() => router.push('/more')}
          accessibilityRole="button"
          accessibilityLabel="Your account and settings"
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale: pressed ? 0.92 : 1 }],
          })}
        >
          <GradientFill colors={colors.heroGradient} sheen />
          <Text variant="bodyStrong" style={{ color: colors.heroText }}>
            {(name || '?').charAt(0).toUpperCase()}
          </Text>
        </Pressable>
      </Row>

      <SyncBanner />

      {dashboard.error && !d ? (
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      ) : null}

      {/* Your balance groups — cash and credit kept apart — and what is safe to spend until payday */}
      <BalanceGroupsHero
        groups={balanceGroups.data}
        accounts={accounts.data}
        currency={currency}
        safe={
          derived?.hasAccounts
            ? {
                amount: derived.available,
                perDay: perDay === null ? null : (Math.floor(perDay) as Minor),
                until: endLabel,
              }
            : null
        }
      />

      <QuickActions />

      {/* Cards */}
      {accounts.data?.length ? (
        <View style={{ marginBottom: spacing.xxl }}>
          <AccountCarousel accounts={accounts.data} />
        </View>
      ) : noAccounts ? (
        <Card style={{ marginBottom: spacing.xxl }}>
          <EmptyState
            compact
            icon="wallet-outline"
            title="Add your first payment method"
            message="Start with wherever your money sits — a bank account, cash, a UPI app or a card. Balances update themselves as transactions come in."
            actionLabel="Add payment method"
            onAction={() => router.push('/accounts/edit')}
          />
        </Card>
      ) : null}

      <BankSyncCard />

      <InsightTeaser insight={insights.insights?.[0]} />
      <FriendsSummaryCard owe={friendsTotals.owe} owed={friendsTotals.owed} currency={currency} />

      {/* This week */}
      <View style={{ marginBottom: spacing.xxl }}>
        <WeekChart currency={currency} />
      </View>

      {/* Recent transactions, one card each */}
      <Section title="Recent" action="See all" onAction={() => router.push('/transactions')}>
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
          <TransactionCards transactions={recent.data} />
        )}
      </Section>

      {/* Expenses by category */}
      <View style={{ marginBottom: spacing.xxl }}>
        <ExpenseTiles currency={currency} />
      </View>

      {/* Budget */}
      <Section
        title="Monthly budget"
        action={budgets.data?.length ? 'Details' : undefined}
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
          <Card style={{ gap: spacing.xl, paddingTop: spacing.xl }}>
            {overallBudget ? (
              <BudgetGauge
                row={overallBudget}
                currency={currency}
                warningPercent={settings.data?.budgetWarningPercent ?? 80}
                spentToday={spentToday}
              />
            ) : null}
            {budgets.data
              .filter((r) => r !== overallBudget)
              .slice(0, overallBudget ? 3 : 4)
              .map((r) => (
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
