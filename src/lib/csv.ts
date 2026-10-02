/**
 * CSV parsing/serialisation (RFC 4180) and transaction-import validation.
 *
 * Import is all-or-nothing by design: `validateImport` returns every row's
 * problems so the UI can show a preview, and the app only imports when there
 * are zero errors (or the user explicitly excludes the failing rows).
 */
import { isISODate, type ISODate } from './dates';
import { toMinor, type Minor } from './money';
import type { Account, Category, TxnType } from '@/types/domain';

// ---------------------------------------------------------------------------
// Parsing & writing
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error('CSV has an unterminated quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header, ...rows].map((r) => r.map(escapeField).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export const IMPORT_COLUMNS = [
  'date',
  'time',
  'type',
  'amount',
  'account',
  'to_account',
  'category',
  'subcategory',
  'merchant',
  'notes',
  'tags',
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export interface ImportRow {
  rowNumber: number;
  occurredAt: Date;
  type: Exclude<TxnType, 'adjustment'>;
  amount: Minor;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  merchantName: string | null;
  notes: string | null;
  tags: string[];
}

export interface ImportError {
  rowNumber: number;
  message: string;
}

export interface ImportResult {
  rows: ImportRow[];
  errors: ImportError[];
  totalRows: number;
}

const HEADER_ALIASES: Record<string, ImportColumn> = {
  date: 'date',
  'transaction date': 'date',
  time: 'time',
  type: 'type',
  amount: 'amount',
  account: 'account',
  'from account': 'account',
  'to account': 'to_account',
  to_account: 'to_account',
  category: 'category',
  subcategory: 'subcategory',
  'sub category': 'subcategory',
  merchant: 'merchant',
  payee: 'merchant',
  description: 'notes',
  notes: 'notes',
  note: 'notes',
  tags: 'tags',
};

/** Parses dates in YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY (Indian day-first). */
export function parseImportDate(value: string): ISODate | null {
  const v = value.trim();
  if (isISODate(v)) return v;
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isISODate(iso) ? iso : null;
}

function parseImportAmount(value: string): Minor | null {
  const cleaned = value.replace(/[₹$€£,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return toMinor(cleaned);
}

export interface ImportContext {
  accounts: readonly Pick<Account, 'id' | 'name' | 'isActive'>[];
  categories: readonly Pick<Category, 'id' | 'name' | 'kind' | 'parentId' | 'isArchived'>[];
  maxRows?: number;
}

const norm = (s: string) => s.trim().toLowerCase();

export function validateImport(table: string[][], ctx: ImportContext): ImportResult {
  const errors: ImportError[] = [];
  const rows: ImportRow[] = [];
  if (table.length === 0) {
    return { rows, errors: [{ rowNumber: 0, message: 'The file is empty.' }], totalRows: 0 };
  }

  const header = table[0].map((h) => HEADER_ALIASES[norm(h)]);
  const col = (name: ImportColumn) => header.indexOf(name);
  for (const required of ['date', 'amount', 'account'] as const) {
    if (col(required) === -1) {
      errors.push({ rowNumber: 1, message: `Missing required column "${required}".` });
    }
  }
  if (errors.length) return { rows, errors, totalRows: table.length - 1 };

  const maxRows = ctx.maxRows ?? 5000;
  if (table.length - 1 > maxRows) {
    return {
      rows,
      errors: [
        {
          rowNumber: 0,
          message: `Files are limited to ${maxRows} rows. Split the file and import in parts.`,
        },
      ],
      totalRows: table.length - 1,
    };
  }

  const accountsByName = new Map(ctx.accounts.filter((a) => a.isActive).map((a) => [norm(a.name), a]));
  const topCats = ctx.categories.filter((c) => c.parentId === null && !c.isArchived);
  const subCats = ctx.categories.filter((c) => c.parentId !== null && !c.isArchived);

  for (let i = 1; i < table.length; i++) {
    const rowNumber = i + 1; // 1-based including header
    const r = table[i];
    const get = (name: ImportColumn) => {
      const idx = col(name);
      return idx === -1 ? '' : (r[idx] ?? '').trim();
    };
    const problems: string[] = [];

    const date = parseImportDate(get('date'));
    if (!date) problems.push(`Invalid date "${get('date')}" (use YYYY-MM-DD or DD/MM/YYYY)`);

    const time = get('time') || '12:00';
    if (!/^\d{1,2}:\d{2}$/.test(time)) problems.push(`Invalid time "${time}" (use HH:MM)`);

    const rawAmount = parseImportAmount(get('amount'));
    if (rawAmount === null || rawAmount === 0) problems.push(`Invalid amount "${get('amount')}"`);

    // With a type column, use it. Without one, follow the bank-statement
    // convention: negative = money out (expense), positive = money in (income).
    let type: ImportRow['type'] = 'expense';
    const typeText = norm(get('type'));
    if (col('type') !== -1 && typeText !== '') {
      if (typeText === 'income' || typeText === 'credit') type = 'income';
      else if (typeText === 'transfer') type = 'transfer';
      else if (typeText === 'expense' || typeText === 'debit') type = 'expense';
      else problems.push(`Unknown type "${get('type')}" (use expense, income or transfer)`);
    } else if (rawAmount !== null) {
      type = rawAmount < 0 ? 'expense' : 'income';
    }
    const amount = (rawAmount === null ? 0 : Math.abs(rawAmount)) as Minor;

    const account = accountsByName.get(norm(get('account')));
    if (!account) problems.push(`Unknown or archived account "${get('account')}"`);

    let toAccountId: string | null = null;
    let categoryId: string | null = null;
    let subcategoryId: string | null = null;

    if (type === 'transfer') {
      const to = accountsByName.get(norm(get('to_account')));
      if (!to) problems.push(`Transfer needs a valid "to_account" (got "${get('to_account')}")`);
      else if (account && to.id === account.id) problems.push('Transfer accounts must be different');
      else toAccountId = to.id;
    } else {
      const catName = get('category');
      const cat = topCats.find((c) => c.kind === type && norm(c.name) === norm(catName));
      if (!cat) {
        problems.push(catName ? `Unknown ${type} category "${catName}"` : `Missing category for ${type}`);
      } else {
        categoryId = cat.id;
        const subName = get('subcategory');
        if (subName) {
          const sub = subCats.find((s) => s.parentId === cat.id && norm(s.name) === norm(subName));
          if (!sub) problems.push(`Unknown subcategory "${subName}" under ${cat.name}`);
          else subcategoryId = sub.id;
        }
      }
    }

    const notes = get('notes');
    if (notes.length > 2000) problems.push('Notes are longer than 2000 characters');
    const merchant = get('merchant');
    if (merchant.length > 80) problems.push('Merchant name is longer than 80 characters');

    if (problems.length > 0 || !date || !account) {
      for (const message of problems) errors.push({ rowNumber, message });
      continue;
    }

    const [h, m] = time.split(':').map(Number);
    const [y, mo, d] = date.split('-').map(Number);
    rows.push({
      rowNumber,
      occurredAt: new Date(y, mo - 1, d, h, m),
      type,
      amount,
      accountId: account.id,
      toAccountId,
      categoryId,
      subcategoryId,
      merchantName: type === 'transfer' ? null : merchant || null,
      notes: notes || null,
      tags: get('tags')
        .split(/[;|]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10),
    });
  }

  return { rows, errors, totalRows: table.length - 1 };
}

/** Template the import screen offers for download. */
export function importTemplateCsv(): string {
  return toCsv(IMPORT_COLUMNS, [
    ['2026-09-01', '09:30', 'income', '125000.00', 'HDFC Bank', '', 'Salary', '', '', 'September salary', ''],
    [
      '2026-09-02',
      '20:15',
      'expense',
      '450.00',
      'HDFC Credit Card',
      '',
      'Food',
      'Food Delivery',
      'Swiggy',
      '',
      'dinner',
    ],
    ['2026-09-05', '11:00', 'transfer', '8000.00', 'HDFC Bank', 'Cash', '', '', '', 'ATM', ''],
  ]);
}
