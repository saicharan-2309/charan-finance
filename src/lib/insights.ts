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
