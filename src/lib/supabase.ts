import { createClient, processLock } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { env } from '@/constants/env';
import { secureSessionStorage } from './secure-storage';

/**
 * The single Supabase client. Uses only the PUBLIC anon/publishable key — all
 * authorisation is enforced by Row Level Security in the database. The service
 * role key must never appear in this app.
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: secureSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
    lock: processLock,
  },
  global: {
    headers: { 'x-client-info': 'charan-finance-ios' },
  },
});

// Refresh tokens only while the app is in the foreground (Supabase guidance for RN).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Throws the PostgREST/Auth error if present, otherwise returns data. */
export function unwrap<T>(result: { data: T; error: unknown }): NonNullable<T> {
  if (result.error) throw result.error;
  return result.data as NonNullable<T>;
}

export async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('CF001: Not authenticated');
  return id;
}
