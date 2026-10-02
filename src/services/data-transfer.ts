/**
 * Export (CSV / JSON) and validated CSV import.
 */
import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { toCsv, type ImportRow } from '@/lib/csv';
import { toDecimalString, toMinor } from '@/lib/money';
import { supabase, unwrap } from '@/lib/supabase';
import type { Row } from './mappers';
import { saveTransaction } from './transactions';

const EXPORT_PAGE = 1000;

async function fetchAll(table: string, select = '*', order = 'created_at'): Promise<Row[]> {
  const out: Row[] = [];
  for (let page = 0; page < 1000; page++) {
    const rows = unwrap(
      await supabase
        .from(table)
        .select(select)
        .order(order, { ascending: true })
        .order('id', { ascending: true })
        .range(page * EXPORT_PAGE, (page + 1) * EXPORT_PAGE - 1),
    ) as unknown as Row[];
    out.push(...rows);
    if (rows.length < EXPORT_PAGE) break;
  }
  return out;
}

async function writeAndShare(
  fileName: string,
  content: string,
  mimeType: string,
  uti: string,
): Promise<void> {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, UTI: uti, dialogTitle: 'Export Charan Finance data' });
  } else {
    throw new Error('Sharing is not available on this device.');
  }
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function exportTransactionsCsv(): Promise<number> {
  const rows = await fetchAll('transactions_view', '*', 'occurred_at');
  const csv = toCsv(
    [
      'date',
      'time',
      'type',
      'amount',
      'currency',
      'account',
      'to_account',
      'category',
      'subcategory',
      'merchant',
      'notes',
      'tags',
      'id',
    ],
    rows.map((r) => {
      const d = new Date(r.occurred_at);
      const pad = (n: number) => String(n).padStart(2, '0');
      return [
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        r.type,
        // NUMERIC → integer paise → exact 2-dp string (no float formatting).
        toDecimalString(toMinor(r.amount)),
        r.currency,
        r.account_name,
        r.to_account_name ?? '',
        r.category_name ?? '',
        r.subcategory_name ?? '',
        r.merchant_name ?? '',
        r.notes ?? '',
        (r.tag_names ?? []).join(';'),
        r.id,
      ];
    }),
  );
  await writeAndShare(
    `charan-finance-transactions-${stamp()}.csv`,
    csv,
    'text/csv',
    'public.comma-separated-values-text',
  );
  return rows.length;
}

/** Full JSON backup of every table the user owns. */
export async function exportJson(): Promise<void> {
  const [
    profiles,
    settings,
    accounts,
    categories,
    merchants,
    transactions,
    tags,
    txTags,
    recurring,
    budgets,
    budgetItems,
    goals,
    contributions,
    snapshots,
    attachments,
  ] = await Promise.all([
    fetchAll('profiles', '*', 'created_at'),
    supabase.from('app_settings').select('*').then(unwrap),
    fetchAll('accounts'),
    fetchAll('transaction_categories'),
    fetchAll('merchants'),
    fetchAll('transactions'),
    fetchAll('tags'),
    supabase.from('transaction_tags').select('*').then(unwrap),
    fetchAll('recurring_transactions'),
    fetchAll('budgets'),
    fetchAll('budget_items'),
    fetchAll('savings_goals'),
    fetchAll('goal_contributions'),
    fetchAll('net_worth_snapshots'),
    fetchAll('attachments'),
  ]);
  const payload = {
    format: 'charan-finance-export',
    version: 1,
    exported_at: new Date().toISOString(),
    note: "Monetary values are decimal amounts in each row's currency. Receipt images are not included.",
    profile: profiles[0] ?? null,
    settings: (settings as Row[])[0] ?? null,
    accounts,
    categories,
    merchants,
    transactions,
    tags,
    transaction_tags: txTags,
    recurring_transactions: recurring,
    budgets,
    budget_items: budgetItems,
    savings_goals: goals,
    goal_contributions: contributions,
    net_worth_snapshots: snapshots,
    attachments,
  };
  await writeAndShare(
    `charan-finance-backup-${stamp()}.json`,
    JSON.stringify(payload, null, 2),
    'application/json',
    'public.json',
  );
}

export interface ImportProgress {
  done: number;
  total: number;
}

/**
 * Imports pre-validated rows sequentially. Each row gets a client-generated id
 * and goes through the idempotent `save_transaction` RPC, so if the import is
 * interrupted it can be re-run with the SAME ids without creating duplicates.
 * Returns the ids that were imported.
 */
export async function importRows(
  rows: readonly ImportRow[],
  ids: readonly string[],
  onProgress?: (p: ImportProgress) => void,
): Promise<{ imported: number; failedAt: number | null; error: unknown }> {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      await saveTransaction({
        mode: 'create',
        id: ids[i],
        type: r.type,
        amount: r.amount,
        accountId: r.accountId,
        occurredAt: r.occurredAt.toISOString(),
        toAccountId: r.toAccountId,
        categoryId: r.categoryId,
        subcategoryId: r.subcategoryId,
        merchantId: null,
        merchantName: r.merchantName,
        notes: r.notes,
        tags: r.tags.length ? r.tags : null,
        expectedUpdatedAt: null,
      });
    } catch (error) {
      return { imported: i, failedAt: r.rowNumber, error };
    }
    onProgress?.({ done: i + 1, total: rows.length });
  }
  return { imported: rows.length, failedAt: null, error: null };
}

export const newImportIds = (n: number) => Array.from({ length: n }, () => randomUUID());
