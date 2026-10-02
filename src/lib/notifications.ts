/**
 * Local notifications (no push server needed). Everything is scheduled on the
 * device from the user's own data and fully controlled by settings.
 *
 * Restraint rules
 *  - iOS allows 64 pending notifications; we schedule at most 40.
 *  - Bill / subscription reminders: one per occurrence, at 9:00 local time,
 *    N days before (per item, default 1).
 *  - Budget warnings: at most one per budget item per period per level
 *    (warning, over), deduplicated across launches.
 *  - Amounts are NOT shown on the lock screen — only names and dates.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { upcomingItems } from './cashflow';
import { addDaysISO, combineDateTime, todayISO } from './dates';
import type { AppSettings, BudgetStatusRow, Goal, RecurringItem } from '@/types/domain';

const MAX_SCHEDULED = 40;
const BUDGET_DEDUPE_KEY = 'cf.notified-budgets';

export function configureNotificationHandler(): void {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function getPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  if (Platform.OS === 'web') return 'denied';
  const s = await Notifications.getPermissionsAsync();
  return s.granted ? 'granted' : s.canAskAgain ? 'undetermined' : 'denied';
}

export async function requestPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const s = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return s.granted;
}

/** Cancels and re-creates every scheduled reminder from current data. */
export async function rescheduleReminders(input: {
  settings: AppSettings;
  recurring: RecurringItem[];
  goals: Goal[];
}): Promise<number> {
  if (Platform.OS === 'web') return 0;
  if ((await getPermissionStatus()) !== 'granted') return 0;
  await Notifications.cancelAllScheduledNotificationsAsync();

  const { settings } = input;
  const now = new Date();
  const today = todayISO(now);
  let count = 0;

  const items = upcomingItems(input.recurring, today, addDaysISO(today, 60)).filter(
    (i) => !i.overdue && i.type !== 'income',
  );
  for (const item of items) {
    if (count >= MAX_SCHEDULED - 2) break;
    const isSub = item.kind === 'subscription';
    if (isSub ? !settings.notifySubscriptionRenewals : !settings.notifyUpcomingBills) continue;
    const template = input.recurring.find((r) => r.id === item.recurringId);
    const daysBefore = template?.remindDaysBefore ?? settings.billReminderDaysBefore;
    const fireAt = combineDateTime(addDaysISO(item.date, -daysBefore), '09:00');
    if (fireAt <= now) continue;
    const when = daysBefore === 0 ? 'today' : daysBefore === 1 ? 'tomorrow' : `in ${daysBefore} days`;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: isSub ? 'Subscription renewal' : 'Upcoming payment',
        body: `${item.name} is due ${when}.`,
        data: { url: '/calendar' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
    });
    count++;
  }

  if (settings.notifyMonthlySummary) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Your monthly summary is ready',
        body: 'See how last month went — spending, savings and trends.',
        data: { url: '/reports' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.MONTHLY, day: 1, hour: 9, minute: 30 },
    });
    count++;
  }

  if (
    settings.notifyGoalReminders &&
    input.goals.some((g) => !g.isArchived && g.currentAmount < g.targetAmount)
  ) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Savings goals',
        body: 'A quick check-in on your savings goals.',
        data: { url: '/goals' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.MONTHLY, day: 25, hour: 18, minute: 0 },
    });
    count++;
  }
  return count;
}

/** Fires an immediate local notification when a budget crosses a threshold (deduplicated). */
export async function notifyBudgetThresholds(rows: BudgetStatusRow[], settings: AppSettings): Promise<void> {
  if (Platform.OS === 'web' || !settings.notifyBudgetWarnings) return;
  if ((await getPermissionStatus()) !== 'granted') return;
  let seen: Record<string, true> = {};
  try {
    seen = JSON.parse((await AsyncStorage.getItem(BUDGET_DEDUPE_KEY)) ?? '{}');
  } catch {
    seen = {};
  }
  let changed = false;
  for (const r of rows) {
    if (r.amount <= 0) continue;
    const pct = (r.spent / r.amount) * 100;
    const level = pct > 100 ? 'over' : pct >= settings.budgetWarningPercent ? 'warning' : null;
    if (!level) continue;
    const key = `${r.itemId}:${r.periodStart}:${level}`;
    if (seen[key]) continue;
    seen[key] = true;
    changed = true;
    const name = r.categoryName ?? r.budgetName;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: level === 'over' ? 'Budget exceeded' : 'Budget alert',
        body:
          level === 'over'
            ? `You've gone over your ${name} budget for this period.`
            : `You've used ${Math.floor(pct)}% of your ${name} budget.`,
        data: { url: '/budgets' },
      },
      trigger: null,
    });
  }
  if (changed) {
    // Keep the dedupe map small: drop entries from old periods.
    const cutoff = addDaysISO(todayISO(), -400);
    for (const k of Object.keys(seen)) if ((k.split(':')[1] ?? '') < cutoff) delete seen[k];
    await AsyncStorage.setItem(BUDGET_DEDUPE_KEY, JSON.stringify(seen));
  }
}
