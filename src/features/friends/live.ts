/**
 * Friends, live: new notifications arrive over Supabase Realtime while the
 * app is open (refreshing what they're about and showing a quiet toast), and
 * this device is registered for push so they also arrive when it's closed.
 *
 * Push comes from the database (a trigger posts to Expo's push service via
 * pg_net) — the app never sends pushes itself. In Expo Go, iOS push works
 * for the Expo Go app; in an installed BUD build it's BUD's own.
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { useToast } from '@/components/ui/feedback';
import { qk } from '@/lib/query';
import { registerPushToken, subscribeToNotifications } from '@/services/friends';
import type { AppNotification } from '@/types/domain';

/** Opens what a notification is about. */
export function openNotification(n: Pick<AppNotification, 'kind' | 'data' | 'actorId'>) {
  const d = n.data ?? {};
  if (d.shared_expense_id) router.push({ pathname: '/shared/[id]', params: { id: d.shared_expense_id } });
  else if (d.conversation_id) router.push({ pathname: '/chat/[id]', params: { id: d.conversation_id } });
  else if (n.kind === 'friend_request') router.push('/friends');
  else if (d.user_id) router.push({ pathname: '/friends/[id]', params: { id: d.user_id } });
  else if (n.actorId) router.push({ pathname: '/friends/[id]', params: { id: n.actorId } });
}

export function useFriendsLive(userId: string | null | undefined) {
  const client = useQueryClient();
  const toast = useToast();

  // Live in-app notifications.
  useEffect(() => {
    if (!userId) return;
    return subscribeToNotifications(userId, (n) => {
      void client.invalidateQueries({ queryKey: qk.notifications });
      void client.invalidateQueries({ queryKey: qk.conversations });
      if (n.kind.startsWith('friend')) void client.invalidateQueries({ queryKey: qk.friendships });
      if (n.kind.startsWith('expense') || n.kind.startsWith('settlement')) {
        void client.invalidateQueries({
          predicate: (q) =>
            [
              'shared-expenses',
              'shared-expense',
              'friend-balances',
              'group-balances',
              'settlements',
              'transactions',
              'accounts',
              'dashboard',
            ].includes(String(q.queryKey[0])),
        });
      }
      if (n.kind !== 'message') toast.show(`${n.title}${n.body ? ` — ${n.body}` : ''}`, 'info');
    });
  }, [userId, client, toast]);

  // Push registration (best effort; needs notification permission).
  useEffect(() => {
    if (!userId || Platform.OS === 'web') return;
    let cancelled = false;
    (async () => {
      try {
        const perm = await Notifications.getPermissionsAsync();
        if (!perm.granted) return;
        const projectId =
          (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
          Constants.easConfig?.projectId;
        if (!projectId) return;
        const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
        if (!cancelled && data) await registerPushToken(data, Platform.OS === 'ios' ? 'ios' : 'android');
      } catch {
        // Push isn't available here (e.g. a simulator); in-app notifications still work.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Tapping a push opens what it's about.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const d = (r.notification.request.content.data ?? {}) as Record<string, string>;
      if (d.kind) openNotification({ kind: d.kind as AppNotification['kind'], data: d, actorId: null });
    });
    return () => sub.remove();
  }, []);
}
