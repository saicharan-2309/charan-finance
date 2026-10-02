/**
 * Money handling.
 *
 * All arithmetic in the app happens on integer MINOR units (paise for INR) held
 * in JS numbers. Integers are exact in IEEE-754 up to 2^53, i.e. ~90 trillion
 * rupees, so there is no rounding drift. Floating-point decimals are only ever
 * produced at the edges: parsing database values and formatting for display.
 *
 * The database stores NUMERIC(18,2); values are sent to it as decimal STRINGS
 * (see `toDecimalString`) so they never pass through a float.
 */

export type Minor = number & { readonly __minor?: unique symbol };

export const MINOR_PER_UNIT = 100;

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

function assertSafe(value: number): Minor {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError('Amount is out of range');
  }
  return value as Minor;
}

/**
 * Converts a database numeric (PostgREST returns NUMERIC as a JSON number or a
 * string) into minor units. Exact for any value with ≤ 2 decimals.
 */
export function toMinor(value: string | number | null | undefined): Minor {
  if (value === null || value === undefined || value === '') return 0 as Minor;
  const str = typeof value === 'number' ? value.toFixed(2) : value.trim();
  const m = DECIMAL_RE.exec(str);
  if (!m) {
    // Tolerate values like "12.500" coming from numeric without scale.
    const n = Number(str);
    if (!Number.isFinite(n)) throw new MoneyError(`Invalid amount: ${str}`);
    return toMinor(n);
  }
  const [, sign, whole, frac = ''] = m;
  const minor = Number(whole) * MINOR_PER_UNIT + Number(frac.padEnd(2, '0'));
  return assertSafe(sign ? -minor : minor);
}

/** Minor units → exact decimal string for the database, e.g. 124910 → "1249.10". */
export function toDecimalString(minor: Minor | number): string {
  assertSafe(minor);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / MINOR_PER_UNIT);
  const frac = abs % MINOR_PER_UNIT;
  return `${negative ? '-' : ''}${whole}.${String(frac).padStart(2, '0')}`;
}

/**
 * Parses what a user typed in an amount field. Accepts grouping commas, spaces
 * and a leading currency symbol. Returns null when the input is not a valid
 * positive amount with at most two decimals.
 */
export function parseAmountInput(input: string): Minor | null {
  const cleaned = input.replace(/[₹$€£,\s]/g, '').replace(/^\+/, '');
  if (cleaned === '' || cleaned === '.') return null;
  const normalised = cleaned.endsWith('.') ? cleaned.slice(0, -1) : cleaned;
  const m = DECIMAL_RE.exec(normalised.startsWith('.') ? `0${normalised}` : normalised);
  if (!m || m[1]) return null;
  try {
    return toMinor(normalised.startsWith('.') ? `0${normalised}` : normalised);
  } catch {
    return null;
  }
}

/**
 * Sanitises keystrokes for an amount field: digits and one decimal point with
 * at most two decimals, max 13 integer digits.
 */
export function sanitizeAmountKeystrokes(input: string): string {
  let intPart = '';
  let fracPart = '';
  let seenDot = false;
  for (const ch of input) {
    if (ch >= '0' && ch <= '9') {
      if (seenDot) {
        if (fracPart.length < 2) fracPart += ch;
      } else if (intPart.length < 13) {
        intPart = intPart === '0' ? ch : intPart + ch;
      }
    } else if (ch === '.' && !seenDot) {
      seenDot = true;
    }
  }
  if (!seenDot) return intPart;
  return `${intPart === '' ? '0' : intPart}.${fracPart}`;
}

export function sumMinor(values: readonly (Minor | number)[]): Minor {
  let total = 0;
  for (const v of values) total += v;
  return assertSafe(total);
}

/** Percentage of part in whole, rounded to one decimal. Returns 0 when whole is 0. */
export function percentOf(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Multiplies a minor amount by a ratio and rounds half away from zero to the
 * nearest minor unit. Used for projections (never for stored values).
 */
export function scaleMinor(minor: Minor | number, ratio: number): Minor {
  const raw = minor * ratio;
  const rounded = Math.sign(raw) * Math.round(Math.abs(raw));
  return assertSafe(rounded === 0 ? 0 : rounded);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  AUD: 'A$',
  CAD: 'C$',
  SGD: 'S$',
  AED: 'AED ',
};

export function currencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? `${currency} `;
}

/** Groups an integer digit string: Indian (12,34,567) for INR, Western otherwise. */
function groupDigits(digits: string, indian: boolean): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const size = indian ? 2 : 3;
  const parts: string[] = [];
  while (rest.length > size) {
    parts.unshift(rest.slice(-size));
    rest = rest.slice(0, -size);
  }
  if (rest) parts.unshift(rest);
  return `${parts.join(',')},${last3}`;
}

export interface FormatOptions {
  /** 'auto' hides ".00" for whole amounts; 'always' shows paise; 'never' rounds. */
  decimals?: 'auto' | 'always' | 'never';
  /** Prefix "+" for positive values. */
  signed?: boolean;
  /** Compact notation: ₹1.25L, ₹3.4Cr, ₹12.5K (INR) or 12.5K / 3.4M (others). */
  compact?: boolean;
  /** Omit the currency symbol. */
  plain?: boolean;
}

export function formatMoney(minor: Minor | number, currency = 'INR', options: FormatOptions = {}): string {
  const { decimals = 'auto', signed = false, compact = false, plain = false } = options;
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const sign = negative ? '−' : signed && minor > 0 ? '+' : '';
  const symbol = plain ? '' : currencySymbol(currency);
  const indian = currency === 'INR';

  if (compact) {
    const units = abs / MINOR_PER_UNIT;
    const scales = indian
      ? ([
          [1e7, 'Cr'],
          [1e5, 'L'],
          [1e3, 'K'],
        ] as const)
      : ([
          [1e9, 'B'],
          [1e6, 'M'],
          [1e3, 'K'],
        ] as const);
    for (const [size, suffix] of scales) {
      if (units >= size) {
        const scaled = units / size;
        const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(scaled >= 10 ? 1 : 2);
        return `${sign}${symbol}${text.replace(/\.?0+$/, '')}${suffix}`;
      }
    }
  }

  let whole = Math.floor(abs / MINOR_PER_UNIT);
  let frac = abs % MINOR_PER_UNIT;
  if (decimals === 'never' || (compact && frac !== 0 && abs >= 100 * MINOR_PER_UNIT)) {
    if (frac >= 50) whole += 1;
    frac = 0;
  }
  const showFrac = decimals === 'always' || (decimals === 'auto' && frac !== 0);
  const body = groupDigits(String(whole), indian) + (showFrac ? `.${String(frac).padStart(2, '0')}` : '');
  return `${sign}${symbol}${body}`;
}

/** Display form of a minor amount for an editable text field (no grouping). */
export function minorToInput(minor: Minor | number): string {
  const s = toDecimalString(Math.abs(minor));
  return s.endsWith('.00') ? s.slice(0, -3) : s;
}
