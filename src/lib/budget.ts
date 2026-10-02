/**
 * Budget maths. Period bounds mirror SQL `budget_period_bounds`.
 */
import {
  addDaysISO,
  addMonthsISO,
  daysBetweenInclusive,
  diffDays,
  elapsedDays,
  monthDiff,
  type DateRange,
  type ISODate,
} from './dates';
import { percentOf, scaleMinor, type Minor } from './money';

export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly' | 'custom';

export const BUDGET_PERIOD_LABELS: Record<BudgetPeriod, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
  custom: 'Custom period',
};

export function budgetPeriodBounds(
  period: BudgetPeriod,
  start: ISODate,
  end: ISODate | null,
  ref: ISODate,
): DateRange {
  if (period === 'custom') {
    if (!end) throw new Error('Custom budgets need an end date');
    return { start, end };
  }
  if (period === 'weekly') {
    const k = Math.max(Math.floor(diffDays(start, ref) / 7), 0);
    const s = addDaysISO(start, k * 7);
    return { start: s, end: addDaysISO(s, 6) };
  }
  const step = period === 'monthly' ? 1 : 12;
  let k = Math.max(Math.trunc(monthDiff(start, ref) / step), 0);
  let s = addMonthsISO(start, k * step);
  if (s > ref && k > 0) {
    k -= 1;
    s = addMonthsISO(start, k * step);
  }
  return { start: s, end: addDaysISO(addMonthsISO(start, (k + 1) * step), -1) };
}

export type BudgetStatus = 'on_track' | 'warning' | 'projected_over' | 'over';

export interface BudgetProgress {
  budget: Minor;
  spent: Minor;
  remaining: Minor;
  percentUsed: number;
  /** Spend projected to the end of the period at the current daily pace. */
  projected: Minor;
  /** Fraction of the period elapsed, 0–1. */
  timeElapsed: number;
  status: BudgetStatus;
  /** Amount per remaining day that keeps the budget on track. */
  dailyAllowance: Minor;
}

export function budgetProgress(
  budget: Minor,
  spent: Minor,
  period: DateRange,
  today: ISODate,
  warningPercent = 80,
): BudgetProgress {
  const totalDays = daysBetweenInclusive(period.start, period.end);
  const elapsed = elapsedDays(period, today);
  const remainingDays = totalDays - elapsed;
  const projected = elapsed === 0 ? spent : scaleMinor(spent, totalDays / elapsed);
  const remaining = (budget - spent) as Minor;
  const percentUsed = percentOf(spent, budget);

  let status: BudgetStatus = 'on_track';
  if (spent > budget) status = 'over';
  else if (percentUsed >= warningPercent) status = 'warning';
  else if (projected > budget && elapsed >= Math.min(3, totalDays)) status = 'projected_over';

  return {
    budget,
    spent,
    remaining,
    percentUsed,
    projected,
    timeElapsed: totalDays === 0 ? 1 : elapsed / totalDays,
    status,
    dailyAllowance:
      remainingDays > 0 && remaining > 0 ? (Math.floor(remaining / remainingDays) as Minor) : (0 as Minor),
  };
}
