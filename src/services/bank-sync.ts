/**
 * Automatic bank sync: the per-phone sync key, the review inbox, merchant
 * rules, detected subscriptions and split transactions.
 *
 * The sync key is generated here, on the phone. Only its SHA-256 hash is sent
 * to the database; the key itself is kept in the iOS Keychain so the setup
 * screen can show it again, and it is what the iPhone Shortcut sends with
 * every bank SMS.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { env } from '@/constants/env';
import { supabase, unwrap } from '@/lib/supabase';
import { toDecimalString, type Minor } from '@/lib/money';
import { mapBankMessage, mapBankSyncStatus, mapDetectedRecurring, mapRule, mapTransaction } from './mappers';
import type {
  BankMessage,
  BankSyncStatus,
  CategoryKind,
  CategoryRule,
  DetectedRecurring,
  Transaction,
} from '@/types/domain';

const KEY_STORE = 'cf.bank-sync-key';
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** Where the Shortcut sends messages. */
export const INGEST_URL = `${env.supabaseUrl.replace(/\/$/, '')}/functions/v1/ingest-sms`;

async function storeKey(key: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return;
    if (key) localStorage.setItem(KEY_STORE, key);
    else localStorage.removeItem(KEY_STORE);
    return;
  }
  if (key) await SecureStore.setItemAsync(KEY_STORE, key, STORE_OPTIONS);
  else await SecureStore.deleteItemAsync(KEY_STORE, STORE_OPTIONS);
}

export async function getStoredSyncKey(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY_STORE);
  }
  return SecureStore.getItemAsync(KEY_STORE, STORE_OPTIONS);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 32 random bytes → "cfsync_" + 64 hex chars. Replaces any earlier key. */
export async function connectBankSync(): Promise<string> {
  const key = `cfsync_${toHex(Crypto.getRandomBytes(32))}`;
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  unwrap(await supabase.rpc('register_ingest_key', { p_key_hash: hash.toLowerCase() }));
  await storeKey(key);
  return key;
}

export async function disconnectBankSync(): Promise<void> {
  unwrap(await supabase.rpc('revoke_ingest_keys'));
  await storeKey(null);
}

/** Calls the Edge Function in test mode: checks the key, records nothing. */
export async function testBankSync(key: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-key': key },
      body: JSON.stringify({ test: true }),
    });
    const body = (await res.json().catch(() => ({}))) as { summary?: string };
    if (res.status === 404) {
      return { ok: false, message: 'The ingest-sms function is not deployed yet.' };
    }
    return { ok: res.ok, message: body.summary ?? (res.ok ? 'Connected' : `Error ${res.status}`) };
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection.' };
  }
}

export async function fetchBankSyncStatus(): Promise<BankSyncStatus> {
  return mapBankSyncStatus(unwrap(await supabase.rpc('bank_sync_status')) as Record<string, unknown>);
}

const PENDING = ['needs_account', 'awaiting_pair'];

export async function fetchPendingMessages(): Promise<BankMessage[]> {
  const rows = unwrap(
    await supabase
      .from('bank_messages')
      .select('*')
      .in('status', PENDING)
      .order('received_at', { ascending: false })
      .limit(100),
  );
  return rows.map(mapBankMessage);
}

export async function fetchRecentMessages(limit = 50): Promise<BankMessage[]> {
  const rows = unwrap(
    await supabase.from('bank_messages').select('*').order('received_at', { ascending: false }).limit(limit),
  );
  return rows.map(mapBankMessage);
}

export async function assignMessage(id: string, accountId: string, remember = true): Promise<void> {
  unwrap(
    await supabase.rpc('assign_bank_message', {
      p_message_id: id,
      p_account_id: accountId,
      p_remember: remember,
    }),
  );
}

export async function settleMessageExternally(id: string): Promise<void> {
  unwrap(await supabase.rpc('settle_bank_message_externally', { p_message_id: id }));
}

export async function dismissMessage(id: string): Promise<void> {
  unwrap(await supabase.rpc('dismiss_bank_message', { p_message_id: id }));
}

export async function retryMessages(): Promise<number> {
  return Number(unwrap(await supabase.rpc('retry_bank_messages')) ?? 0);
}

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

export async function fetchReviewQueue(): Promise<Transaction[]> {
  const rows = unwrap(
    await supabase
      .from('transactions_view')
      .select('*')
      .eq('needs_review', true)
      .order('occurred_at', { ascending: false })
      .limit(200),
  );
  return rows.map(mapTransaction);
}

export async function reviewTransaction(input: {
  id: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  remember?: boolean;
}): Promise<void> {
  unwrap(
    await supabase.rpc('review_transaction', {
      p_id: input.id,
      p_category_id: input.categoryId ?? null,
      p_subcategory_id: input.subcategoryId ?? null,
      p_remember: input.remember ?? false,
    }),
  );
}

export async function markReviewed(ids?: string[]): Promise<number> {
  return Number(unwrap(await supabase.rpc('mark_transactions_reviewed', { p_ids: ids ?? null })) ?? 0);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export async function fetchRules(): Promise<CategoryRule[]> {
  const rows = unwrap(
    await supabase.from('categorisation_rules').select('*').order('pattern', { ascending: true }),
  );
  return rows.map(mapRule);
}

export async function createRule(input: {
  pattern: string;
  kind: CategoryKind;
  categoryId: string;
  subcategoryId: string | null;
}): Promise<void> {
  unwrap(
    await supabase
      .from('categorisation_rules')
      .insert({
        pattern: input.pattern.trim().toLowerCase(),
        kind: input.kind,
        category_id: input.categoryId,
        subcategory_id: input.subcategoryId,
      })
      .select('id'),
  );
}

export async function deleteRule(id: string): Promise<void> {
  unwrap(await supabase.from('categorisation_rules').delete().eq('id', id).select('id'));
}

// ---------------------------------------------------------------------------
// Subscriptions, splits, aliases
// ---------------------------------------------------------------------------

export async function fetchDetectedRecurring(): Promise<DetectedRecurring[]> {
  const rows = unwrap(await supabase.rpc('detect_recurring_payments')) as Record<string, unknown>[];
  return (rows ?? []).map(mapDetectedRecurring);
}

export interface SplitPart {
  amount: Minor;
  categoryId: string;
  subcategoryId: string | null;
  notes?: string | null;
}

export async function splitTransaction(id: string, parts: SplitPart[]): Promise<void> {
  unwrap(
    await supabase.rpc('split_transaction', {
      p_id: id,
      p_parts: parts.map((p) => ({
        amount: toDecimalString(p.amount),
        category_id: p.categoryId,
        subcategory_id: p.subcategoryId,
        notes: p.notes ?? null,
      })),
    }),
  );
}

export async function fetchAliases(
  accountId: string,
): Promise<{ id: string; last4: string; bank: string | null }[]> {
  const rows = unwrap(
    await supabase
      .from('account_aliases')
      .select('id, last4, bank')
      .eq('account_id', accountId)
      .order('created_at'),
  );
  return rows.map((r) => ({ id: r.id, last4: r.last4, bank: r.bank ?? null }));
}

export async function addAlias(accountId: string, last4: string): Promise<void> {
  unwrap(await supabase.from('account_aliases').insert({ account_id: accountId, last4 }).select('id'));
}

export async function deleteAlias(id: string): Promise<void> {
  unwrap(await supabase.from('account_aliases').delete().eq('id', id).select('id'));
}
