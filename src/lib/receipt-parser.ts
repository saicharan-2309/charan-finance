/**
 * Turns raw OCR text from a receipt into a SUGGESTION. The result pre-fills a
 * form; the user always reviews and confirms before any transaction exists.
 */
import { isISODate, type ISODate } from './dates';
import { toMinor, type Minor } from './money';

export interface ReceiptSuggestion {
  merchantName: string | null;
  merchantId: string | null;
  amount: Minor | null;
  date: ISODate | null;
  currency: string | null;
  categoryId: string | null;
  /** Per-field confidence, for highlighting fields that need attention. */
  confidence: { merchant: number; amount: number; date: number };
}

interface KnownMerchant {
  id: string;
  name: string;
  defaultCategoryId: string | null;
}

interface KnownCategory {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  parentId: string | null;
}

const TOTAL_KEYWORDS =
  /(grand\s*total|net\s*amount|total\s*amount|amount\s*payable|amount\s*paid|bill\s*amount|total\s*payable|total|amount\s*due|balance\s*due)/i;
const EXCLUDE_KEYWORDS =
  /(sub\s*total|subtotal|discount|savings|you\s*saved|tax|gst|cgst|sgst|igst|vat|change|tendered|round\s*off|qty|quantity|tip)/i;
const AMOUNT_RE =
  /(?:₹|rs\.?|inr|\$|usd|€|eur|£|gbp)?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?!\d)/gi;

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function amountsIn(line: string): Minor[] {
  const out: Minor[] = [];
  // Remove dates and clock times so their digits are not mistaken for amounts.
  const cleaned = line
    .replace(/\b\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ');
  for (const m of cleaned.matchAll(AMOUNT_RE)) {
    const raw = m[1].replace(/,/g, '');
    // Ignore things that look like years, phone numbers or long ids.
    if (!raw.includes('.') && raw.length > 7) continue;
    try {
      const v = toMinor(raw);
      if (v > 0) out.push(v);
    } catch {
      // not an amount
    }
  }
  return out;
}

export function detectCurrency(text: string): string | null {
  if (/₹|\brs\.?\s*\d|\binr\b|\bgstin\b/i.test(text)) return 'INR';
  if (/\$|\busd\b/i.test(text)) return 'USD';
  if (/€|\beur\b/i.test(text)) return 'EUR';
  if (/£|\bgbp\b/i.test(text)) return 'GBP';
  return null;
}

export function detectDate(text: string, today: Date = new Date()): ISODate | null {
  const candidates: ISODate[] = [];
  const push = (y: number, m: number, d: number) => {
    const year = y < 100 ? 2000 + y : y;
    const iso = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (isISODate(iso)) candidates.push(iso);
  };
  for (const m of text.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) push(+m[1], +m[2], +m[3]);
  // Day-first (India/UK) for numeric dates.
  for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g)) push(+m[3], +m[2], +m[1]);
  for (const m of text.matchAll(/\b(\d{1,2})[\s-]*([A-Za-z]{3,9})[,\s-]*(\d{2,4})\b/g)) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) push(+m[3], mon, +m[1]);
  }
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) push(+m[3], mon, +m[2]);
  }
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  // Receipts are not from the future, nor (usually) from more than two years ago.
  const minIso = `${today.getFullYear() - 2}-01-01`;
  return candidates.find((c) => c <= todayIso && c >= minIso) ?? null;
}

export function detectTotal(text: string): { amount: Minor | null; confidence: number } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // Prefer the LAST line with a total keyword (grand totals come after subtotals).
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!TOTAL_KEYWORDS.test(line) || EXCLUDE_KEYWORDS.test(line)) continue;
    let values = amountsIn(line);
    if (values.length === 0 && i + 1 < lines.length) values = amountsIn(lines[i + 1]);
    if (values.length > 0) return { amount: values[values.length - 1], confidence: 0.85 };
  }
  // Fallback: the largest currency-looking amount.
  const all = lines.filter((l) => !EXCLUDE_KEYWORDS.test(l)).flatMap(amountsIn);
  if (all.length === 0) return { amount: null, confidence: 0 };
  return { amount: Math.max(...all) as Minor, confidence: 0.4 };
}

function detectMerchantName(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    if (line.length < 3 || line.length > 40) continue;
    if (/\d{3,}/.test(line)) continue; // addresses, phone numbers
    if (/(invoice|receipt|tax|bill|gstin|date|tel|phone|www\.|@)/i.test(line)) continue;
    const letters = line.replace(/[^A-Za-z]/g, '');
    if (letters.length < 3) continue;
    return line
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\s+/g, ' ');
  }
  return null;
}

export function parseReceiptText(
  text: string,
  merchants: readonly KnownMerchant[] = [],
  categories: readonly KnownCategory[] = [],
  today: Date = new Date(),
): ReceiptSuggestion {
  const lower = text.toLowerCase();
  const total = detectTotal(text);
  const date = detectDate(text, today);

  // Known merchants win over the heuristic header line (longest name first).
  const known = [...merchants]
    .sort((a, b) => b.name.length - a.name.length)
    .find((m) => m.name.length >= 3 && lower.includes(m.name.toLowerCase()));

  const merchantName = known?.name ?? detectMerchantName(text);
  let categoryId = known?.defaultCategoryId ?? null;
  if (!categoryId) {
    const hints: [RegExp, string][] = [
      [/(restaurant|cafe|café|dine|kitchen|bistro|food)/i, 'Restaurants'],
      [/(mart|grocery|supermarket|fresh|bigbasket|dmart)/i, 'Groceries'],
      [/(petrol|fuel|diesel|hpcl|bpcl|indian oil|shell)/i, 'Fuel'],
      [/(pharmacy|chemist|medical|hospital|clinic)/i, 'Healthcare'],
      [/(uber|ola|rapido|metro|parking|toll)/i, 'Transport'],
      [/(cinema|pvr|inox|movie)/i, 'Entertainment'],
    ];
    for (const [re, name] of hints) {
      if (re.test(text)) {
        categoryId =
          categories.find((c) => c.kind === 'expense' && c.parentId === null && c.name === name)?.id ?? null;
        if (categoryId) break;
      }
    }
  }

  return {
    merchantName,
    merchantId: known?.id ?? null,
    amount: total.amount,
    date,
    currency: detectCurrency(text),
    categoryId,
    confidence: {
      merchant: known ? 0.9 : merchantName ? 0.5 : 0,
      amount: total.confidence,
      date: date ? 0.8 : 0,
    },
  };
}
