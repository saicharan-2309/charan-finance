import {
  addMonthsISO,
  combineDateTime,
  elapsedDays,
  normaliseTimeZone,
  isISODate,
  previousRange,
  rangeForPreset,
  yearAgoRange,
} from '@/lib/dates';
import {
  describeFrequency,
  monthlyEquivalent,
  nextDueDate,
  occurrencesBetween,
  pendingOccurrences,
  yearlyEquivalent,
  type RecurrenceRule,
} from '@/lib/recurrence';

const today = new Date(2026, 8, 18); // 18 Sep 2026

describe('date ranges', () => {
  it('resolves presets', () => {
    expect(rangeForPreset('this_month', today)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(rangeForPreset('last_month', today)).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    expect(rangeForPreset('last_3_months', today)).toEqual({ start: '2026-07-01', end: '2026-09-30' });
    expect(rangeForPreset('last_6_months', today)).toEqual({ start: '2026-04-01', end: '2026-09-30' });
    expect(rangeForPreset('this_year', today)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(rangeForPreset('last_year', today)).toEqual({ start: '2025-01-01', end: '2025-12-31' });
  });

  it('computes comparison ranges', () => {
    expect(previousRange({ start: '2026-09-01', end: '2026-09-30' })).toEqual({
      start: '2026-08-01',
      end: '2026-08-31',
    });
    expect(previousRange({ start: '2026-07-01', end: '2026-09-30' })).toEqual({
      start: '2026-04-01',
      end: '2026-06-30',
    });
    expect(previousRange({ start: '2026-09-10', end: '2026-09-19' })).toEqual({
      start: '2026-08-31',
      end: '2026-09-09',
    });
    expect(yearAgoRange({ start: '2026-02-01', end: '2026-02-28' })).toEqual({
      start: '2025-02-01',
      end: '2025-02-28',
    });
  });

  it('counts elapsed days within a range', () => {
    const r = { start: '2026-09-01', end: '2026-09-30' };
    expect(elapsedDays(r, '2026-08-31')).toBe(0);
    expect(elapsedDays(r, '2026-09-18')).toBe(18);
    expect(elapsedDays(r, '2026-10-05')).toBe(30);
  });

  it('validates and combines dates', () => {
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2028-02-29')).toBe(true);
    expect(addMonthsISO('2026-01-31', 1)).toBe('2026-02-28');
    const d = combineDateTime('2026-09-18', '21:05');
    expect([d.getHours(), d.getMinutes(), d.getDate()]).toEqual([21, 5, 18]);
  });
});

describe('recurrence engine (mirrors SQL)', () => {
  const monthly: RecurrenceRule = {
    startDate: '2026-01-31',
    endDate: null,
    frequency: 'monthly',
    intervalCount: 1,
    lastOccurrenceDate: null,
  };

  it('clamps month-end anchors without drift', () => {
    expect(occurrencesBetween(monthly, '2026-01-01', '2026-06-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('handles weekly intervals, end dates and leap-day yearly anchors', () => {
    expect(
      occurrencesBetween(
        { startDate: '2026-09-01', endDate: '2026-10-01', frequency: 'weekly', intervalCount: 2 },
        '2026-09-10',
        '2026-12-31',
      ),
    ).toEqual(['2026-09-15', '2026-09-29']);
    expect(
      occurrencesBetween(
        { startDate: '2024-02-29', endDate: null, frequency: 'yearly', intervalCount: 1 },
        '2024-01-01',
        '2028-12-31',
      ),
    ).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
    expect(
      occurrencesBetween(
        { startDate: '2026-01-15', endDate: null, frequency: 'quarterly', intervalCount: 1 },
        '2026-01-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
    expect(occurrencesBetween({ ...monthly, startDate: '2026-09-01' }, '2026-08-01', '2026-08-31')).toEqual(
      [],
    );
  });

  it('derives the next due date from the last handled occurrence', () => {
    expect(nextDueDate(monthly)).toBe('2026-01-31');
    expect(nextDueDate({ ...monthly, lastOccurrenceDate: '2026-02-28' })).toBe('2026-03-31');
    expect(nextDueDate({ ...monthly, endDate: '2026-03-15', lastOccurrenceDate: '2026-02-28' })).toBeNull();
    expect(
      nextDueDate({
        startDate: '2026-01-01',
        endDate: null,
        frequency: 'yearly',
        intervalCount: 3,
        lastOccurrenceDate: '2026-01-01',
      }),
    ).toBe('2029-01-01');
  });

  it('lists pending (including overdue) occurrences without duplicates', () => {
    const rule = { ...monthly, startDate: '2026-07-05', lastOccurrenceDate: '2026-07-05' };
    expect(pendingOccurrences(rule, '2026-10-31')).toEqual(['2026-08-05', '2026-09-05', '2026-10-05']);
  });

  it('computes monthly and yearly equivalents', () => {
    expect(monthlyEquivalent(64900, 'monthly', 1)).toBe(64900);
    expect(monthlyEquivalent(1850000, 'yearly', 1)).toBe(154167);
    expect(monthlyEquivalent(30000, 'quarterly', 1)).toBe(10000);
    expect(yearlyEquivalent(11900, 'monthly', 1)).toBe(142800);
    expect(describeFrequency('monthly', 1)).toBe('Monthly');
    expect(describeFrequency('weekly', 2)).toBe('Every 2 weeks');
  });
});

describe('payday cycles', () => {
  const { cycleRange, daysLeft } = jest.requireActual('@/lib/dates') as typeof import('@/lib/dates');

  it('uses calendar months when the cycle starts on the 1st', () => {
    expect(cycleRange(new Date(2026, 9, 3), 1)).toEqual({ start: '2026-10-01', end: '2026-10-31' });
  });

  it('runs from payday to the day before the next payday', () => {
    expect(cycleRange(new Date(2026, 9, 3), 25)).toEqual({ start: '2026-09-25', end: '2026-10-24' });
    expect(cycleRange(new Date(2026, 9, 25), 25)).toEqual({ start: '2026-10-25', end: '2026-11-24' });
    expect(cycleRange(new Date(2026, 0, 10), 28)).toEqual({ start: '2025-12-28', end: '2026-01-27' });
    expect(cycleRange(new Date(2026, 11, 30), 28)).toEqual({ start: '2026-12-28', end: '2027-01-27' });
  });

  it('counts the days left, today included', () => {
    expect(daysLeft({ start: '2026-09-25', end: '2026-10-24' }, '2026-10-03')).toBe(22);
    expect(daysLeft({ start: '2026-09-25', end: '2026-10-24' }, '2026-10-24')).toBe(1);
    expect(daysLeft({ start: '2026-09-25', end: '2026-10-24' }, '2026-10-25')).toBe(0);
  });
});

describe('money-month report ranges', () => {
  const { rangeForPreset, previousRange } = jest.requireActual('@/lib/dates') as typeof import('@/lib/dates');
  const today = new Date(2026, 9, 3);

  it('runs month presets payday to payday', () => {
    expect(rangeForPreset('this_month', today, 25)).toEqual({ start: '2026-09-25', end: '2026-10-24' });
    expect(rangeForPreset('last_month', today, 25)).toEqual({ start: '2026-08-25', end: '2026-09-24' });
    expect(rangeForPreset('last_3_months', today, 25)).toEqual({ start: '2026-07-25', end: '2026-10-24' });
    expect(rangeForPreset('this_year', today, 25)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(rangeForPreset('this_month', today, 1)).toEqual({ start: '2026-10-01', end: '2026-10-31' });
  });

  it('compares a money month with the money month before it', () => {
    expect(previousRange({ start: '2026-09-25', end: '2026-10-24' }, 25)).toEqual({
      start: '2026-08-25',
      end: '2026-09-24',
    });
    expect(previousRange({ start: '2026-07-25', end: '2026-10-24' }, 25)).toEqual({
      start: '2026-04-25',
      end: '2026-07-24',
    });
  });
});

describe('time zones', () => {
  it('sends the current name for zones devices still report by an old alias', () => {
    expect(normaliseTimeZone('Asia/Calcutta')).toBe('Asia/Kolkata');
    expect(normaliseTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(normaliseTimeZone('Europe/London')).toBe('Europe/London');
    expect(normaliseTimeZone(undefined)).toBe('Asia/Kolkata');
  });
});
