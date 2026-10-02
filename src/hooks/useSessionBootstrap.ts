/**
 * Work done once per signed-in session (and again when the app returns to the
 * foreground on a new day):
 *  - keep the profile timezone in sync with the device (reports use it);
 *  - post due occurrences of auto-post recurring items (idempotent in SQL);
 *  - capture today's net-worth snapshot (one row per day, upserted);
 *  - flush the offline write queue;
 *  - reschedule local reminders.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { deviceTimeZone, todayISO } from '@/lib/dates';
import { logError } from '@/lib/errors';
import { rescheduleReminders } from '@/lib/notifications';
import { offlineQueue, startQueueAutoFlush } from '@/lib/offline-queue';
import { invalidateFinancialData, qk } from '@/lib/query';
import { fetchProfile, fetchSettings, updateProfile } from '@/services/core';
import { captureNetWorthSnapshot, fetchGoals, fetchRecurring, postDueRecurring } from '@/services/planning';

export function useSessionBootstrap(userId: string) {
  const client = useQueryClient();
  const lastRunDay = useRef<string | null>(null);

  useEffect(() => {
    offlineQueue.setSyncedHandler(() => void invalidateFinancialData());
    const stopAutoFlush = startQueueAutoFlush();

    const run = async () => {
      const day = todayISO();
      if (lastRunDay.current === day) {
        void offlineQueue.flush();
        return;
      }
      lastRunDay.current = day;
      try {
        await offlineQueue.flush();
        const profile = await fetchProfile();
        const tz = deviceTimeZone();
        if (profile.timezone !== tz) {
          await updateProfile(userId, { timezone: tz });
          await client.invalidateQueries({ queryKey: qk.profile });
        }
        const posted = await postDueRecurring();
        await captureNetWorthSnapshot();
        if (posted > 0) await invalidateFinancialData();
        else await client.invalidateQueries({ queryKey: qk.snapshots });

        const [settings, recurring, goals] = await Promise.all([
          fetchSettings(),
          fetchRecurring(),
          fetchGoals(),
        ]);
        await rescheduleReminders({ settings, recurring, goals });
      } catch (e) {
        // Offline or transient — retried on next foreground.
        lastRunDay.current = null;
        logError('bootstrap', e);
      }
    };

    void run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void run();
    });
    return () => {
      sub.remove();
      stopAutoFlush();
    };
  }, [userId, client]);
}
