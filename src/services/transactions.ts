/**
 * Transactions: paged listing with filters/search, atomic save via RPC,
 * deletion (including receipt files), and "recently used" quick picks.
 */
import { toDecimalString, type Minor } from '@/lib/money';
import { supabase, unwrap } from '@/lib/supabase';
import type { Transaction, TxnType } from '@/types/domain';
import { mapTransaction, type Row } from './mappers';

export const PAGE_SIZE = 40;

export type TransactionSort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';

export interface TransactionFilters {
  search?: string;
  types?: TxnType[];
  /** Top-level categories (transactions always store the parent in category_id). */
  categoryIds?: string[];
  subcategoryIds?: string[];
  merchantIds?: string[];
  accountIds?: string[];
  minAmount?: Minor | null;
  maxAmount?: Minor | null;
  /** Inclusive instants (ISO). */
  from?: string | null;
  to?: string | null;
  sort?: TransactionSort;
}

/** PostgREST `in` lists need quoting-safe UUIDs only. */
const UUID_RE = /^[0-9a-f-]{36}$/i;
const uuidList = (ids: string[]) => ids.filter((id) => UUID_RE.test(id)).join(',');

export async function fetchTransactionsPage(
  filters: TransactionFilters,
  page: number,
): Promise<{ items: Transaction[]; nextPage: number | null }> {
  let q = supabase.from('transactions_view').select('*');

  const search = filters.search?.trim().toLowerCase();
  if (search) {
    // Escape LIKE wildcards; the value is sent as a bound parameter.
    const escaped = search.replace(/[\\%_]/g, (c) => `\\${c}`).slice(0, 100);
    q = q.ilike('search_text', `%${escaped}%`);
  }
  if (filters.types?.length) q = q.in('type', filters.types);
  if (filters.categoryIds?.length) q = q.in('category_id', filters.categoryIds);
  if (filters.subcategoryIds?.length) q = q.in('subcategory_id', filters.subcategoryIds);
  if (filters.merchantIds?.length) q = q.in('merchant_id', filters.merchantIds);
  if (filters.accountIds?.length) {
    // The only OR filter: an account matches as source or transfer destination.
    const ids = uuidList(filters.accountIds);
    q = q.or(`account_id.in.(${ids}),to_account_id.in.(${ids})`);
  }
  if (filters.minAmount != null) q = q.gte('amount', toDecimalString(filters.minAmount));
  if (filters.maxAmount != null) q = q.lte('amount', toDecimalString(filters.maxAmount));
  if (filters.from) q = q.gte('occurred_at', filters.from);
  if (filters.to) q = q.lte('occurred_at', filters.to);

  switch (filters.sort ?? 'date_desc') {
    case 'date_desc':
      q = q.order('occurred_at', { ascending: false }).order('id', { ascending: false });
      break;
    case 'date_asc':
      q = q.order('occurred_at', { ascending: true }).order('id', { ascending: true });
      break;
    case 'amount_desc':
      q = q.order('amount', { ascending: false }).order('occurred_at', { ascending: false }).order('id');
      break;
    case 'amount_asc':
      q = q.order('amount', { ascending: true }).order('occurred_at', { ascending: false }).order('id');
      break;
  }

  const fromIdx = page * PAGE_SIZE;
  const rows = unwrap(await q.range(fromIdx, fromIdx + PAGE_SIZE - 1));
  const items = (rows as Row[]).map(mapTransaction);
  return { items, nextPage: items.length === PAGE_SIZE ? page + 1 : null };
}

export async function fetchTransaction(id: string): Promise<Transaction | null> {
  const { data, error } = await supabase.from('transactions_view').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? mapTransaction(data) : null;
}

export async function fetchRecentTransactions(limit = 8): Promise<Transaction[]> {
  const rows = unwrap(
    await supabase
      .from('transactions_view')
      .select('*')
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit),
  );
  return (rows as Row[]).map(mapTransaction);
}

export async function fetchLargestExpenses(
  fromIso: string,
  toIso: string,
  limit = 10,
): Promise<Transaction[]> {
  const rows = unwrap(
    await supabase
      .from('transactions_view')
      .select('*')
      .eq('type', 'expense')
      .gte('occurred_at', fromIso)
      .lte('occurred_at', toIso)
      .order('amount', { ascending: false })
      .limit(limit),
  );
  return (rows as Row[]).map(mapTransaction);
}

// ---------------------------------------------------------------------------
// Save / delete
// ---------------------------------------------------------------------------

export interface SaveTransactionInput {
  mode: 'create' | 'update';
  id: string;
  type: Exclude<TxnType, 'adjustment'>;
  amount: Minor;
  accountId: string;
  occurredAt: string; // ISO instant
  toAccountId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  merchantId: string | null;
  merchantName: string | null;
  notes: string | null;
  tags: string[] | null;
  expectedUpdatedAt: string | null;
}

export async function saveTransaction(input: SaveTransactionInput): Promise<Row> {
  return unwrap(
    await supabase.rpc('save_transaction', {
      p_mode: input.mode,
      p_id: input.id,
      p_type: input.type,
      p_amount: toDecimalString(input.amount),
      p_account_id: input.accountId,
      p_occurred_at: input.occurredAt,
      p_to_account_id: input.type === 'transfer' ? input.toAccountId : null,
      p_category_id: input.type === 'transfer' ? null : input.categoryId,
      p_subcategory_id: input.type === 'transfer' ? null : input.subcategoryId,
      p_merchant_id: input.type === 'transfer' ? null : input.merchantId,
      p_merchant_name: input.type === 'transfer' ? null : input.merchantName,
      p_notes: input.notes,
      p_tags: input.tags,
      p_expected_updated_at: input.expectedUpdatedAt,
    }),
  ) as Row;
}

/** Deletes the transaction, then best-effort removes its receipt files. */
export async function deleteTransaction(id: string): Promise<void> {
  const paths = unwrap(await supabase.rpc('delete_transaction', { p_id: id })) as string[] | null;
  if (paths && paths.length > 0) {
    const { error } = await supabase.storage.from('receipts').remove(paths);
    if (error && __DEV__) console.warn('[receipts] cleanup failed');
  }
}

// ---------------------------------------------------------------------------
// Quick picks: most-used categories / merchants / accounts from recent history
// ---------------------------------------------------------------------------
export interface RecentUsage {
  categoryIds: string[];
  merchantIds: string[];
  accountIds: string[];
  /** Most common category for each merchant (for smart defaults). */
  merchantCategory: Record<string, string>;
  lastAccountId: string | null;
}

export async function fetchRecentUsage(type: 'expense' | 'income' = 'expense'): Promise<RecentUsage> {
  const rows = unwrap(
    await supabase
      .from('transactions')
      .select('category_id, merchant_id, account_id, occurred_at')
      .eq('type', type)
      .order('occurred_at', { ascending: false })
      .limit(150),
  ) as Row[];

  const rank = (key: 'category_id' | 'merchant_id' | 'account_id') => {
    const score = new Map<string, number>();
    rows.forEach((r, i) => {
      const id = r[key];
      if (!id) return;
      // Frequency with a recency boost.
      score.set(id, (score.get(id) ?? 0) + 1 + (150 - i) / 150);
    });
    return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  };

  const merchantCategory: Record<string, string> = {};
  const counts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.merchant_id || !r.category_id) continue;
    const m = counts.get(r.merchant_id) ?? new Map<string, number>();
    m.set(r.category_id, (m.get(r.category_id) ?? 0) + 1);
    counts.set(r.merchant_id, m);
  }
  for (const [mid, m] of counts) {
    merchantCategory[mid] = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  return {
    categoryIds: rank('category_id').slice(0, 8),
    merchantIds: rank('merchant_id').slice(0, 10),
    accountIds: rank('account_id').slice(0, 5),
    merchantCategory,
    lastAccountId: rows[0]?.account_id ?? null,
  };
}
