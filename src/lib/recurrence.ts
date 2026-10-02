/**
 * Recurrence engine — a faithful TypeScript mirror of the SQL functions
 * `recurrence_occurrences` and `next_due_date`. The database is the source of
 * truth for posting; this module powers projections (calendar, upcoming
 * payments, subscription costs) without extra round trips and offline.
 *
 * Occurrence k is always anchor + k·step, so month-end anchors clamp correctly
 * (Jan 31 → Feb 28 → Mar 31) instead of drifting to the 28th.
 */
import { addDaysISO, addMonthsISO, diffDays, maxISO, minISO, monthDiff, type ISODate } from './dates';
import { scaleMinor, type Minor } from './money';

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurrenceRule {
  startDate: ISODate;
  endDate: ISODate | null;
  frequency: Frequency;
  intervalCount: number;
  /** Last occurrence posted or skipped. */
  lastOccurrenceDate: ISODate | null;
}

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

export function describeFrequency(frequency: Frequency, interval: number): string {
  if (interval === 1) return FREQUENCY_LABELS[frequency];
  const unit = { daily: 'days', weekly: 'weeks', monthly: 'months', quarterly: 'quarters', yearly: 'years' }[
    frequency
  ];
  return `Every ${interval} ${unit}`;
}

function monthsStep(frequency: Frequency, interval: number): number {
  return interval * (frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12);
}

/** All occurrences within [from, to] (inclusive), honouring start/end dates. */
export function occurrencesBetween(
  rule: Pick<RecurrenceRule, 'startDate' | 'endDate' | 'frequency' | 'intervalCount'>,
  from: ISODate,
  to: ISODate,
): ISODate[] {
  const { startDate, endDate, frequency } = rule;
  const interval = Math.max(1, Math.floor(rule.intervalCount));
  const lower = maxISO(from, startDate);
  const upper = endDate ? minISO(to, endDate) : to;
  if (upper < lower) return [];

  const out: ISODate[] = [];
  if (frequency === 'daily' || frequency === 'weekly') {
    const step = interval * (frequency === 'daily' ? 1 : 7);
    const lo = Math.max(0, Math.ceil(diffDays(startDate, lower) / step));
    const hi = Math.floor(diffDays(startDate, upper) / step);
    for (let k = lo; k <= hi; k++) out.push(addDaysISO(startDate, k * step));
    return out;
  }

  const step = monthsStep(frequency, interval);
  const lo = Math.max(Math.floor(monthDiff(startDate, lower) / step) - 1, 0);
  const hi = Math.floor(monthDiff(startDate, upper) / step) + 1;
  for (let k = lo; k <= hi; k++) {
    const d = addMonthsISO(startDate, k * step);
    if (d >= lower && d <= upper) out.push(d);
  }
  return out;
}

/** Next unhandled occurrence, or null when the schedule has ended. */
export function nextDueDate(rule: RecurrenceRule): ISODate | null {
  const from = rule.lastOccurrenceDate ? addDaysISO(rule.lastOccurrenceDate, 1) : rule.startDate;
  const horizon = addDaysISO(rule.lastOccurrenceDate ?? rule.startDate, 31 + rule.intervalCount * 370);
  return occurrencesBetween(rule, from, horizon)[0] ?? null;
}

/** Unhandled occurrences from the next due date up to `to`. */
export function pendingOccurrences(rule: RecurrenceRule, to: ISODate, limit = 400): ISODate[] {
  const next = nextDueDate(rule);
  if (!next || next > to) return [];
  return occurrencesBetween(rule, next, to).slice(0, limit);
}

/** Average monthly cost of a recurring amount (for subscription totals). */
export function monthlyEquivalent(amount: Minor | number, frequency: Frequency, interval: number): Minor {
  const perYear: Record<Frequency, number> = {
    daily: 365,
    weekly: 52,
    monthly: 12,
    quarterly: 4,
    yearly: 1,
  };
  return scaleMinor(amount, perYear[frequency] / Math.max(1, interval) / 12);
}

export function yearlyEquivalent(amount: Minor | number, frequency: Frequency, interval: number): Minor {
  const perYear: Record<Frequency, number> = { daily: 365, weekly: 52, monthly: 12, quarterly: 4, yearly: 1 };
  return scaleMinor(amount, perYear[frequency] / Math.max(1, interval));
}
