/**
 * Savings-goal calculations.
 */
import { addDays, addMonths, differenceInCalendarDays } from 'date-fns';

import { fromISODate, toISODate, type ISODate } from './dates';
import { percentOf, type Minor } from './money';

export interface GoalInput {
  target: Minor;
  current: Minor;
  targetDate: ISODate | null;
  /** Net contributions over the trailing window (for pace-based projection). */
  recentContributions: Minor;
  /** Length of that trailing window in days. */
  recentWindowDays: number;
}

export interface GoalProgress {
  remaining: Minor;
  percent: number;
  isComplete: boolean;
  daysLeft: number | null;
  /** Saving needed per month to hit the target date (null if no target date). */
  requiredMonthly: Minor | null;
  requiredWeekly: Minor | null;
  /** Monthly pace from recent contributions. */
  monthlyPace: Minor;
  /** Date the goal will be reached at the current pace, or null if pace ≤ 0. */
  projectedCompletion: ISODate | null;
  /** On track if the projection lands on or before the target date. */
  onTrack: boolean | null;
}

const ceilDiv = (a: number, b: number) => Math.ceil(a / b);

export function goalProgress(goal: GoalInput, today: Date = new Date()): GoalProgress {
  const remaining = Math.max(goal.target - goal.current, 0) as Minor;
  const isComplete = goal.current >= goal.target;
  const percent = Math.min(percentOf(goal.current, goal.target), 100);

  let daysLeft: number | null = null;
  let requiredMonthly: Minor | null = null;
  let requiredWeekly: Minor | null = null;
  if (goal.targetDate) {
    daysLeft = differenceInCalendarDays(fromISODate(goal.targetDate), today);
    if (isComplete) {
      requiredMonthly = 0 as Minor;
      requiredWeekly = 0 as Minor;
    } else if (daysLeft <= 0) {
      // Overdue: everything remaining is needed now.
      requiredMonthly = remaining;
      requiredWeekly = remaining;
    } else {
      const months = Math.max(daysLeft / (365.25 / 12), 1);
      const weeks = Math.max(daysLeft / 7, 1);
      requiredMonthly = ceilDiv(remaining, months) as Minor;
      requiredWeekly = ceilDiv(remaining, weeks) as Minor;
    }
  }

  const window = Math.max(goal.recentWindowDays, 1);
  const dailyPace = goal.recentContributions / window;
  const monthlyPace = Math.round(dailyPace * (365.25 / 12)) as Minor;

  let projectedCompletion: ISODate | null = null;
  if (isComplete) projectedCompletion = toISODate(today);
  else if (dailyPace > 0) {
    const days = Math.ceil(remaining / dailyPace);
    projectedCompletion = days > 365 * 100 ? null : toISODate(addDays(today, days));
  }

  let onTrack: boolean | null = null;
  if (goal.targetDate) {
    onTrack = isComplete || (projectedCompletion !== null && projectedCompletion <= goal.targetDate);
  }

  return {
    remaining,
    percent,
    isComplete,
    daysLeft,
    requiredMonthly,
    requiredWeekly,
    monthlyPace,
    projectedCompletion,
    onTrack,
  };
}

/** Months until a date, rounded up; used for copy like "in 5 months". */
export function monthsUntil(target: ISODate, today: Date = new Date()): number {
  let months = 0;
  let cursor = today;
  const t = fromISODate(target);
  while (cursor < t && months < 1200) {
    cursor = addMonths(cursor, 1);
    months++;
  }
  return months;
}
