/**
 * Session state for the whole app. Authentication methods live in
 * `services/auth.ts`, so new providers (Apple, Google, magic link) can be added
 * there without touching consumers.
 */
import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { offlineQueue } from '@/lib/offline-queue';
import { queryClient, queryPersister } from '@/lib/query';
import { supabase } from '@/lib/supabase';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** True until the stored session has been restored from the Keychain. */
  initializing: boolean;
  /** True when the user arrived via a password-recovery link. */
  recovering: boolean;
  clearRecovery: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!mounted) return;
        await offlineQueue.load(data.session?.user.id ?? null);
        setSession(data.session);
      })
      .catch(() => setSession(null))
      .finally(() => mounted && setInitializing(false));

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') {
        // Remove every trace of the previous user's financial data from the device.
        queryClient.clear();
        void queryPersister.removeClient();
        void offlineQueue.load(null);
      }
      if (event === 'SIGNED_IN') void offlineQueue.load(next?.user.id ?? null);
      setSession(next);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      initializing,
      recovering,
      clearRecovery: () => setRecovering(false),
    }),
    [session, initializing, recovering],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For screens that only render when signed in. */
export function useUserId(): string {
  const { user } = useAuth();
  if (!user) throw new Error('No signed-in user');
  return user.id;
}
