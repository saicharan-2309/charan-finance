/**
 * Descriptive insights generated purely from the user's own data. They state
 * facts and simple arithmetic (comparisons, shares, averages, pace). They never
 * give financial advice, recommend investments, or predict markets.
 */
import { daysBetweenInclusive, elapsedDays, type DateRange, type ISODate } from './dates';
import { formatMoney, percentOf, scaleMinor, type Minor } from './money';
import type { CategoryTotal, PeriodSummary } from '@/types/domain';

export type InsightTone = 'positive' | 'negative' | 'neutral';

export interface Insight {
  id: string;
  icon: string;
  tone: InsightTone;
  text: string;
  /** Higher sorts first. */
  priority: number;
}

export interface InsightInput {
  currency: string;
  month: DateRange;
  today: ISODate;
  current: PeriodSummary;
  previous: PeriodSummary;
  categories: readonly CategoryTotal[];
  previousCategories: readonly CategoryTotal[];
  /** Recurring outflows expected over the next 30 days. */
  upcomingOutflow30d: Minor;
  upcomingCount30d: number;
}

export function savingsRate(s: Pick<PeriodSummary, 'income' | 'expense'>): number | null {
  if (s.income <= 0) return null;
  return Math.round(((s.income - s.expense) / s.income) * 100);
}

export function generateInsights(input: InsightInput, max = 6): Insight[] {
  const { currency } = input;
  const fmt = (m: number) => formatMoney(m, currency, { decimals: 'never' });
  const out: Insight[] = [];
  const elapsed = elapsedDays(input.month, input.today);
  const monthDays = daysBetweenInclusive(input.month.start, input.month.end);

  // 1. Category spend already above last month's full total.
  const prevByName = new Map(input.previousCategories.map((c) => [c.categoryId ?? c.name, c]));
  for (const c of input.categories) {
    const prev = prevByName.get(c.categoryId ?? c.name);
    if (!prev || prev.total <= 0) continue;
    const diff = c.total - prev.total;
    if (diff >= 50000 && diff / prev.total >= 0.1) {
      out.push({
        id: `cat-up-${c.categoryId}`,
        icon: 'trending-up',
        tone: 'negative',
        text: `You've spent ${fmt(diff)} more on ${c.name} this month than in all of last month.`,
        priority: 80 + Math.min(diff / 100000, 15),
      });
    }
  }

  // 2. Largest category share.
  if (input.current.expense > 0 && input.categories.length > 0) {
    const top = input.categories[0];
    const share = Math.round(percentOf(top.total, input.current.expense));
    if (share >= 15) {
      out.push({
        id: 'top-share',
        icon: 'pie-chart',
        tone: 'neutral',
        text: `${top.name} represents ${share}% of your expenses this month.`,
        priority: 60,
      });
    }
  }

  // 3. Savings rate movement.
  const rateNow = savingsRate(input.current);
  const ratePrev = savingsRate(input.previous);
  if (rateNow !== null && ratePrev !== null && rateNow !== ratePrev) {
    const up = rateNow > ratePrev;
    out.push({
      id: 'savings-rate',
      icon: up ? 'arrow-up-circle' : 'arrow-down-circle',
      tone: up ? 'positive' : 'negative',
      text: `Your savings rate ${up ? 'increased' : 'decreased'} from ${ratePrev}% to ${rateNow}%.`,
      priority: 75,
    });
  } else if (rateNow !== null) {
    out.push({
      id: 'savings-rate',
      icon: 'leaf',
      tone: rateNow >= 0 ? 'positive' : 'negative',
      text: `You've saved ${rateNow}% of this month's income so far.`,
      priority: 50,
    });
  }

  // 4. Upcoming recurring payments.
  if (input.upcomingOutflow30d > 0) {
    out.push({
      id: 'upcoming',
      icon: 'calendar',
      tone: 'neutral',
      text: `You have ${fmt(input.upcomingOutflow30d)} of recurring payments coming up in the next 30 days (${input.upcomingCount30d} ${input.upcomingCount30d === 1 ? 'payment' : 'payments'}).`,
      priority: 70,
    });
  }

  // 5. Average daily spending.
  if (elapsed > 0 && input.current.expense > 0) {
    const daily = Math.round(input.current.expense / elapsed);
    out.push({
      id: 'daily-average',
      icon: 'today',
      tone: 'neutral',
      text: `Your average daily spending this month is ${fmt(daily)}.`,
      priority: 40,
    });
  }

  // 6. Pace versus last month (labelled as a projection).
  if (elapsed >= 5 && elapsed < monthDays && input.previous.expense > 0) {
    const projected = scaleMinor(input.current.expense, monthDays / elapsed);
    const diff = projected - input.previous.expense;
    if (Math.abs(diff) / input.previous.expense >= 0.1) {
      out.push({
        id: 'pace',
        icon: diff > 0 ? 'speedometer' : 'checkmark-circle',
        tone: diff > 0 ? 'negative' : 'positive',
        text:
          diff > 0
            ? `At your current pace, this month's spending would reach about ${fmt(projected)} — ${fmt(diff)} more than last month.`
            : `At your current pace, you'd spend about ${fmt(-diff)} less than last month.`,
        priority: 65,
      });
    }
  }

  // 7. Essential vs discretionary split (only when categories are classified).
  const classified = input.current.essentialExpense + input.current.discretionaryExpense;
  if (classified > 0 && input.current.expense > 0) {
    const disc = Math.round(percentOf(input.current.discretionaryExpense, input.current.expense));
    out.push({
      id: 'discretionary',
      icon: 'options',
      tone: 'neutral',
      text: `${disc}% of this month's spending went to discretionary categories.`,
      priority: 30,
    });
  }

  return out.sort((a, b) => b.priority - a.priority).slice(0, max);
}

// ---------------------------------------------------------------------------
// More signals: merchants, categories on pace, days, cards, recurring, budget
// ---------------------------------------------------------------------------
export interface ExtraInsightInput {
  currency: string;
  month: DateRange;
  today: ISODate;
  categories: readonly CategoryTotal[];
  previousCategories: readonly CategoryTotal[];
  /** Top merchants this money month. */
  merchants: readonly { name: string; total: Minor; count: number }[];
  /** Spending per day this money month. */
  days: readonly { date: ISODate; expense: Minor }[];
  /** Spending on credit cards this month and last (same number of days). */
  cardSpend: { current: Minor; previous: Minor } | null;
  /** Active recurring expenses, each as a monthly cost. */
  recurringMonthly: readonly { name: string; monthly: Minor; subscription: boolean }[];
  /** The overall budget, if one is set. */
  budget: { amount: Minor; spent: Minor } | null;
  /**
   * All spending so far this month, and by the same day of last month — a
   * like-for-like comparison. Null while last month's figure is loading.
   */
  soFar?: { current: Minor; previous: Minor } | null;
}

export function generateExtraInsights(input: ExtraInsightInput): Insight[] {
  const fmt = (m: number) => formatMoney(m, input.currency, { decimals: 'never' });
  const out: Insight[] = [];
  const elapsed = Math.max(elapsedDays(input.month, input.today), 1);
  const monthDays = daysBetweenInclusive(input.month.start, input.month.end);
  const total = input.categories.reduce((s, c) => s + c.total, 0);

  // Overall spending against the same point last month.
  if (input.soFar && input.soFar.current > 0 && input.soFar.previous > 0) {
    const { current, previous } = input.soFar;
    const change = Math.round(((current - previous) / previous) * 100);
    out.push({
      id: 'vs-last-month',
      icon: change > 0 ? 'trending-up' : change < 0 ? 'trending-down' : 'remove',
      tone: change > 5 ? 'negative' : change < -5 ? 'positive' : 'neutral',
      text:
        change === 0
          ? `You've spent ${fmt(current)} so far this month — the same as by this day last month.`
          : `You've spent ${fmt(current)} so far this month — ${Math.abs(change)}% ${
              change > 0 ? 'more' : 'less'
            } than by this day last month (${fmt(previous)}).`,
      priority: 85,
    });
  }

  // Largest category.
  const top = [...input.categories].sort((a, b) => b.total - a.total)[0];
  if (top && total > 0) {
    out.push({
      id: 'largest-category',
      icon: 'pie-chart',
      tone: 'neutral',
      text: `Your largest spending category is ${top.name}: ${fmt(top.total)}, ${Math.round(
        percentOf(top.total, total),
      )}% of everything you've spent this month.`,
      priority: 60,
    });
  }

  // Categories on pace to finish well above or below last month.
  const prev = new Map(input.previousCategories.map((c) => [c.categoryId ?? c.name, c]));
  for (const c of input.categories) {
    const p = prev.get(c.categoryId ?? c.name);
    if (!p || p.total < 50000 || c.total < 20000 || elapsed < 5) continue;
    const projected = scaleMinor(c.total, monthDays / elapsed);
    const change = Math.round(((projected - p.total) / p.total) * 100);
    if (change >= 20) {
      out.push({
        id: `cat-pace-up-${c.categoryId ?? c.name}`,
        icon: 'trending-up',
        tone: 'negative',
        text: `At this pace you'll spend ${change}% more on ${c.name} than last month (${fmt(projected)} vs ${fmt(p.total)}).`,
        priority: 70 + Math.min(change / 10, 10),
      });
    } else if (change <= -20) {
      out.push({
        id: `cat-pace-down-${c.categoryId ?? c.name}`,
        icon: 'trending-down',
        tone: 'positive',
        text: `Your ${c.name} spending is down ${Math.abs(change)}% on last month's pace.`,
        priority: 55 + Math.min(Math.abs(change) / 10, 10),
      });
    }
  }

  // Top merchant.
  const m = [...input.merchants].sort((a, b) => b.total - a.total)[0];
  if (m && m.total >= 50000) {
    out.push({
      id: `merchant-${m.name}`,
      icon: 'storefront',
      tone: 'neutral',
      text: `You spent ${fmt(m.total)} at ${m.name} this month, across ${m.count} ${m.count === 1 ? 'payment' : 'payments'}.`,
      priority: 58,
    });
  }

  // Highest spending day.
  const spentDays = input.days.filter((d) => d.expense > 0);
  if (spentDays.length >= 3) {
    const peak = [...spentDays].sort((a, b) => b.expense - a.expense)[0]!;
    const avg = spentDays.reduce((s, d) => s + d.expense, 0) / spentDays.length;
    if (peak.expense >= avg * 2) {
      const label = new Date(`${peak.date}T12:00:00`).toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
      });
      out.push({
        id: 'peak-day',
        icon: 'calendar',
        tone: 'neutral',
        text: `Your highest spending day was ${label}: ${fmt(peak.expense)}, about ${Math.round(
          peak.expense / avg,
        )}× a typical day.`,
        priority: 52,
      });
    }
  }

  // Credit card spending vs last month.
  if (input.cardSpend && input.cardSpend.previous > 20000 && input.cardSpend.current > 0) {
    const change = Math.round(
      ((input.cardSpend.current - input.cardSpend.previous) / input.cardSpend.previous) * 100,
    );
    if (Math.abs(change) >= 15) {
      out.push({
        id: 'card-spend',
        icon: 'card',
        tone: change > 0 ? 'negative' : 'positive',
        text: `You're spending ${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} on credit cards than at this point last month.`,
        priority: 62,
      });
    }
  }

  // Recurring and subscriptions.
  const subs = input.recurringMonthly.filter((r) => r.subscription);
  if (input.recurringMonthly.length > 0) {
    const all = input.recurringMonthly.reduce((s, r) => s + r.monthly, 0);
    out.push({
      id: 'recurring',
      icon: 'repeat',
      tone: 'neutral',
      text: `You have ${input.recurringMonthly.length} recurring ${
        input.recurringMonthly.length === 1 ? 'expense' : 'expenses'
      } — about ${fmt(all)} a month${
        subs.length
          ? `, of which ${subs.length} ${subs.length === 1 ? 'subscription is' : 'subscriptions are'} ${fmt(
              subs.reduce((s, r) => s + r.monthly, 0),
            )}`
          : ''
      }.`,
      priority: 50,
    });
  }

  // Close to the monthly limit.
  if (input.budget && input.budget.amount > 0) {
    const used = input.budget.spent / input.budget.amount;
    const timeUsed = elapsed / monthDays;
    if (used >= 0.8) {
      out.push({
        id: 'budget-close',
        icon: used >= 1 ? 'alert-circle' : 'speedometer',
        tone: 'negative',
        text:
          used >= 1
            ? `You're over your monthly budget by ${fmt(input.budget.spent - input.budget.amount)}.`
            : `You've used ${Math.round(used * 100)}% of your monthly budget with ${Math.round(
                (1 - timeUsed) * 100,
              )}% of the month still to go.`,
        priority: 90,
      });
    }
  }

  return out;
}

/** A recurring amount as a monthly cost. */
export function monthlyCost(amount: Minor, frequency: string, interval = 1): Minor {
  const perMonth: Record<string, number> = {
    daily: 30.44,
    weekly: 4.345,
    monthly: 1,
    quarterly: 1 / 3,
    yearly: 1 / 12,
  };
  return Math.round((amount * (perMonth[frequency] ?? 1)) / Math.max(interval, 1)) as Minor;
}
