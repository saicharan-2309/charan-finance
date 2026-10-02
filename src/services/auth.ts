/**
 * Authentication operations. Email/password today; additional providers
 * (Sign in with Apple, OAuth, magic links) slot in here.
 */
import * as Linking from 'expo-linking';

import { offlineQueue } from '@/lib/offline-queue';
import { supabase } from '@/lib/supabase';

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw error;
}

/** Returns true when the project requires email confirmation before sign-in. */
export async function signUp(
  email: string,
  password: string,
  displayName: string,
): Promise<{ needsConfirmation: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: { display_name: displayName.trim() },
      emailRedirectTo: Linking.createURL('/sign-in'),
    },
  });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: Linking.createURL('/reset-password'),
  });
  if (error) throw error;
}

/** Completes the PKCE flow from a recovery/confirmation deep link. */
export async function exchangeCode(code: string): Promise<void> {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function hasUnsyncedChanges(): boolean {
  return offlineQueue.hasUnsynced();
}

/** Permanently deletes the account via the delete-account Edge Function. */
export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
  if (error) throw error;
  await supabase.auth.signOut({ scope: 'local' });
}

export const PASSWORD_MIN_LENGTH = 8;

export function validatePassword(pw: string): string | null {
  if (pw.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use a mix of letters and numbers.';
  return null;
}

export function validateEmail(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) ? null : 'Enter a valid email address.';
}
