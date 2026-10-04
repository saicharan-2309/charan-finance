/**
 * Calendar-date helpers. Dates that represent a calendar day (budget periods,
 * report ranges, recurrence occurrences) are plain 'YYYY-MM-DD' strings so they
 * never shift across timezones. Instants (transaction times) are Date/ISO.
 */
import {
  addDays as dfAddDays,
  addMonths as dfAddMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfYear,
  format,
  isValid,
  parse,
  startOfMonth,
  startOfYear,
  subMonths,
  subYears,
} from 'date-fns';

export type ISODate = string; // 'YYYY-MM-DD'

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: string): value is ISODate {
  if (!ISO_RE.test(value)) return false;
  return isValid(parse(value, 'yyyy-MM-dd', new Date(2000, 0, 1)));
}

/** Parses 'YYYY-MM-DD' into a local-midnight Date. */
export function fromISODate(value: ISODate): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toISODate(date: Date): ISODate {
  return format(date, 'yyyy-MM-dd');
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}

export function addDaysISO(value: ISODate, days: number): ISODate {
  return toISODate(dfAddDays(fromISODate(value), days));
}

/**
 * Adds months anchored to the ORIGINAL day-of-month with end-of-month clamping
 * (Jan 31 + 1 month = Feb 28/29), matching PostgreSQL's date + interval.
 */
export function addMonthsISO(value: ISODate, months: number): ISODate {
  return toISODate(dfAddMonths(fromISODate(value), months));
}

export function daysBetweenInclusive(start: ISODate, end: ISODate): number {
  return differenceInCalendarDays(fromISODate(end), fromISODate(start)) + 1;
}

export function diffDays(from: ISODate, to: ISODate): number {
  return differenceInCalendarDays(fromISODate(to), fromISODate(from));
}

export function monthDiff(from: ISODate, to: ISODate): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minISO(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

export function maxISO(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

export interface DateRange {
  start: ISODate;
  end: ISODate;
}

export type RangePreset =
  'this_month' | 'last_month' | 'last_3_months' | 'last_6_months' | 'this_year' | 'last_year' | 'custom';

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  this_month: 'This month',
  last_month: 'Last month',
  last_3_months: 'Last 3 months',
  last_6_months: 'Last 6 months',
  this_year: 'This year',
  last_year: 'Last year',
  custom: 'Custom',
};

/** Resolves a preset into an inclusive calendar range relative to `today`. */
export function rangeForPreset(preset: Exclude<RangePreset, 'custom'>, today: Date = new Date()): DateRange {
  switch (preset) {
    case 'this_month':
      return { start: toISODate(startOfMonth(today)), end: toISODate(endOfMonth(today)) };
    case 'last_month': {
      const d = subMonths(today, 1);
      return { start: toISODate(startOfMonth(d)), end: toISODate(endOfMonth(d)) };
    }
    case 'last_3_months':
      return { start: toISODate(startOfMonth(subMonths(today, 2))), end: toISODate(endOfMonth(today)) };
    case 'last_6_months':
      return { start: toISODate(startOfMonth(subMonths(today, 5))), end: toISODate(endOfMonth(today)) };
    case 'this_year':
      return { start: toISODate(startOfYear(today)), end: toISODate(endOfYear(today)) };
    case 'last_year': {
      const d = subYears(today, 1);
      return { start: toISODate(startOfYear(d)), end: toISODate(endOfYear(d)) };
    }
  }
}

/** The range of equal length immediately preceding `range` (for comparisons). */
export function previousRange(range: DateRange): DateRange {
  const startD = fromISODate(range.start);
  const endD = fromISODate(range.end);
  // Whole calendar months → previous whole months of the same count.
  if (toISODate(startOfMonth(startD)) === range.start && toISODate(endOfMonth(endD)) === range.end) {
    const months = monthDiff(range.start, range.end) + 1;
    const prevStart = subMonths(startD, months);
    return { start: toISODate(prevStart), end: toISODate(dfAddDays(startD, -1)) };
  }
  const len = daysBetweenInclusive(range.start, range.end);
  return { start: addDaysISO(range.start, -len), end: addDaysISO(range.start, -1) };
}

/** Same range one year earlier (year-over-year comparison). */
export function yearAgoRange(range: DateRange): DateRange {
  return { start: addMonthsISO(range.start, -12), end: addMonthsISO(range.end, -12) };
}

/** Days of the range that have elapsed as of `today` (clamped to [0, length]). */
export function elapsedDays(range: DateRange, today: ISODate): number {
  if (today < range.start) return 0;
  if (today > range.end) return daysBetweenInclusive(range.start, range.end);
  return daysBetweenInclusive(range.start, today);
}

export function monthRange(today: Date = new Date()): DateRange {
  return rangeForPreset('this_month', today);
}

/**
 * The user's "money month": from payday to the day before the next payday.
 * `startDay` is 1–28 (1 = calendar months), so it never needs clamping.
 */
export function cycleRange(today: Date = new Date(), startDay = 1): DateRange {
  if (!Number.isInteger(startDay) || startDay <= 1 || startDay > 28) return monthRange(today);
  const y = today.getFullYear();
  const m = today.getDate() >= startDay ? today.getMonth() : today.getMonth() - 1;
  const start = new Date(y, m, startDay);
  const end = new Date(y, m + 1, startDay - 1);
  return { start: toISODate(start), end: toISODate(end) };
}

/** Days left in a range after `today`, today included. */
export function daysLeft(range: DateRange, today: ISODate): number {
  if (today > range.end) return 0;
  if (today < range.start) return daysBetweenInclusive(range.start, range.end);
  return daysBetweenInclusive(today, range.end);
}

/** Combines a calendar date and a local time ('HH:mm') into a Date. */
export function combineDateTime(date: ISODate, time: string): Date {
  const d = fromISODate(date);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

export function formatDayLabel(value: ISODate | Date, today: Date = new Date()): string {
  const d = typeof value === 'string' ? fromISODate(value) : value;
  const diff = differenceInCalendarDays(d, today);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  return format(d, d.getFullYear() === today.getFullYear() ? 'EEE, d MMM' : 'd MMM yyyy');
}

export function formatShortDate(value: ISODate | Date): string {
  const d = typeof value === 'string' ? fromISODate(value) : value;
  return format(d, 'd MMM yyyy');
}

export function formatMonthLabel(value: ISODate | Date, short = false): string {
  const d = typeof value === 'string' ? fromISODate(value) : value;
  return format(d, short ? 'MMM' : 'MMMM yyyy');
}

export function formatTime(value: Date | string): string {
  return format(typeof value === 'string' ? new Date(value) : value, 'h:mm a');
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
}
