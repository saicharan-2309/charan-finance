/**
 * BUD AI's language layer — turns a sentence into what the user wants, with
 * no model and no network: periods ("last month", "in September", "last 7
 * days"), amounts ("₹1,250", "2k", "1.5 lakh"), and the names of the user's own
 * categories, payment methods and friends. Pure and unit-tested.
 */
import type { Minor } from '@/lib/money';

export type ISODate = string;
export interface Range {
  start: ISODate;
  end: ISODate;
}
export interface Period extends Range {
  /** How to say it: "last month", "this week", "September". */
  label: string;
  /** The money month in progress — compared like-for-like up to today. */
  current?: boolean;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function parts(d: ISODate): [number, number, number] {
  const [y, m, day] = d.split('-').map(Number);
  return [y!, m!, day!];
}
export function isoOf(y: number, m: number, d: number): ISODate {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}
export function addDays(date: ISODate, n: number): ISODate {
  const [y, m, d] = parts(date);
  return isoOf(y, m, d + n);
}
export function daysIn(r: Range): number {
  return Math.round((Date.parse(`${r.end}T00:00:00Z`) - Date.parse(`${r.start}T00:00:00Z`)) / 86400000) + 1;
}

/** The payday "money month" containing `date` (same rule as the app's cycleRange). */
export function moneyMonth(date: ISODate, startDay: number): Range {
  const [y, m, d] = parts(date);
  if (!Number.isInteger(startDay) || startDay <= 1 || startDay > 28) {
    return { start: isoOf(y, m, 1), end: isoOf(y, m + 1, 0) };
  }
  const sm = d >= startDay ? m : m - 1;
  return { start: isoOf(y, sm, startDay), end: isoOf(y, sm + 1, startDay - 1) };
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function dayLabel(d: ISODate): string {
  const [, m, day] = parts(d);
  return `${day} ${MONTH_SHORT[m - 1]}`;
}
export function rangeLabel(r: Range): string {
  return r.start === r.end ? dayLabel(r.start) : `${dayLabel(r.start)} – ${dayLabel(r.end)}`;
}

export function thisMonth(today: ISODate, startDay: number): Period {
  return { ...moneyMonth(today, startDay), label: 'this month', current: true };
}

const MONTH_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/;

/** The period a sentence talks about, or null if it names none. */
export function parsePeriod(text: string, today: ISODate, startDay: number): Period | null {
  const t = text.toLowerCase();
  if (/\btoday\b/.test(t)) return { start: today, end: today, label: 'today' };
  if (/\byesterday\b/.test(t)) {
    const y = addDays(today, -1);
    return { start: y, end: y, label: 'yesterday' };
  }
  const nDays = t.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/);
  if (nDays) {
    const n = Math.min(Math.max(Number(nDays[1]), 1), 366);
    return { start: addDays(today, -(n - 1)), end: today, label: `the last ${n} days` };
  }
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const monday = addDays(today, -weekday);
  if (/\bthis week\b/.test(t)) return { start: monday, end: today, label: 'this week' };
  if (/\b(?:last|previous|past) week\b/.test(t)) {
    return { start: addDays(monday, -7), end: addDays(monday, -1), label: 'last week' };
  }
  if (/\b(?:last|previous|past) (?:money |pay )?(?:month|cycle)\b|\blast pay ?cycle\b/.test(t)) {
    const now = moneyMonth(today, startDay);
    return { ...moneyMonth(addDays(now.start, -1), startDay), label: 'last month' };
  }
  if (/\bthis (?:money |pay )?(?:month|cycle)\b|\bsince pay ?day\b|\bso far\b|\bmonth to date\b/.test(t)) {
    return thisMonth(today, startDay);
  }
  const [y, m] = parts(today);
  if (/\bthis year\b/.test(t)) return { start: isoOf(y, 1, 1), end: today, label: 'this year' };
  if (/\b(?:last|previous|past) year\b/.test(t)) {
    return { start: isoOf(y - 1, 1, 1), end: isoOf(y - 1, 12, 31), label: `${y - 1}` };
  }
  // "in September", "for sept 2025", "september 2025" — "may" only with a cue word or year.
  const cue = t.match(
    new RegExp(`\\b(?:in|for|during|of|since)\\s+${MONTH_RE.source.slice(2, -2)}\\b(?:\\s+(\\d{4}))?`),
  );
  const withYear = t.match(new RegExp(`${MONTH_RE.source.slice(0, -2)}\\b\\s+(\\d{4})\\b`));
  const hit = cue ?? withYear;
  if (hit) {
    const word = hit[0].match(MONTH_RE)![1]!;
    const month = MONTH_LONG.findIndex((n) => n.toLowerCase().startsWith(word.slice(0, 3))) + 1;
    const yearText = hit[hit.length - 1];
    const year = yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : month > m ? y - 1 : y;
    const end = isoOf(year, month + 1, 0);
    return {
      start: isoOf(year, month, 1),
      end: end > today ? today : end,
      label: year === y ? MONTH_LONG[month - 1]! : `${MONTH_LONG[month - 1]} ${year}`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/** The money amount in a sentence, in paise — "₹1,250", "rs 500", "2k", "1.5 lakh", "500". */
export function parseAmount(text: string): Minor | null {
  const t = text.toLowerCase().replace(/(\d),(?=\d)/g, '$1');
  const scale = (n: number, unit: string | undefined) =>
    unit?.startsWith('k') ? n * 1000 : unit && /^(?:lakhs?|lacs?|l)$/.test(unit) ? n * 100000 : n;
  const toPaise = (n: number) =>
    Number.isFinite(n) && n > 0 && n < 1e10 ? (Math.round(n * 100) as Minor) : null;

  const marked = t.match(/(?:₹|\brs\.?|\binr)\s*(\d+(?:\.\d{1,2})?)\s*(k\b|lakhs?\b|lacs?\b|l\b)?/);
  if (marked) return toPaise(scale(Number(marked[1]), marked[2]));
  const after = t.match(/\b(\d+(?:\.\d{1,2})?)\s*(k\b|lakhs?\b|lacs?\b)?\s*(?:rupees|rs\b|inr\b|bucks\b)/);
  if (after) return toPaise(scale(Number(after[1]), after[2]));

  // A bare number that isn't a date, a count of days, or "last 5 transactions".
  for (const m of t.matchAll(/\b(\d+(?:\.\d{1,2})?)\s*(k\b|lakhs?\b|lacs?\b)?/g)) {
    const before = t.slice(0, m.index).trimEnd();
    const rest = t.slice(m.index! + m[0].length).trimStart();
    if (/(?:last|past|previous|top|first)$/.test(before)) continue;
    if (/^(?:st|nd|rd|th|days?|weeks?|months?|years?|transactions?|payments?|items?)\b/.test(rest)) continue;
    if (/^\d{4}$/.test(m[1]!) && Number(m[1]) > 1900 && Number(m[1]) < 2100) continue;
    if (MONTH_RE.test(rest.slice(0, 10)) || MONTH_RE.test(before.slice(-10))) continue;
    return toPaise(scale(Number(m[1]), m[2]));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Names — the user's own categories, payment methods and friends
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9&@ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const hasPhrase = (text: string, phrase: string) =>
  !!phrase && ` ${norm(text)} `.includes(` ${norm(phrase)} `);

/** Everyday words for the default categories (only used when the user has that category). */
export const CATEGORY_WORDS: Record<string, string[]> = {
  Food: [
    'food',
    'meal',
    'meals',
    'lunch',
    'dinner',
    'breakfast',
    'snacks',
    'coffee',
    'tea',
    'starbucks',
    'cafe',
  ],
  Restaurants: ['restaurant', 'restaurants', 'eating out', 'dining', 'dine out', 'swiggy', 'zomato'],
  Groceries: ['grocery', 'groceries', 'vegetables', 'bigbasket', 'blinkit', 'zepto', 'dmart', 'instamart'],
  Shopping: ['shopping', 'clothes', 'shoes', 'amazon', 'flipkart', 'myntra', 'ajio', 'meesho'],
  Transport: ['transport', 'cab', 'cabs', 'taxi', 'uber', 'ola', 'rapido', 'auto', 'metro', 'bus', 'train'],
  Fuel: ['fuel', 'petrol', 'diesel'],
  Travel: ['travel', 'flight', 'flights', 'hotel', 'hotels', 'trip', 'holiday'],
  Entertainment: ['entertainment', 'movie', 'movies', 'cinema', 'concert', 'games'],
  Bills: ['bill', 'bills'],
  Utilities: ['utilities', 'electricity', 'internet', 'wifi', 'broadband', 'recharge', 'gas cylinder'],
  Rent: ['rent'],
  Healthcare: ['health', 'healthcare', 'medicine', 'medicines', 'doctor', 'hospital', 'pharmacy'],
  Fitness: ['gym', 'fitness', 'yoga'],
  Education: ['education', 'course', 'courses', 'books', 'tuition', 'fees'],
  Subscriptions: [
    'subscription',
    'subscriptions',
    'netflix',
    'spotify',
    'prime',
    'hotstar',
    'youtube premium',
  ],
  Insurance: ['insurance'],
  'Personal Care': ['salon', 'haircut', 'grooming', 'spa'],
  Gifts: ['gift', 'gifts'],
  Investments: ['investment', 'investments', 'sip', 'mutual fund', 'stocks'],
  Salary: ['salary', 'paycheck', 'payslip'],
  Bonus: ['bonus'],
  Freelance: ['freelance', 'freelancing'],
  Interest: ['interest'],
  Dividends: ['dividend', 'dividends'],
  Refunds: ['refund', 'refunds', 'cashback'],
  'Loans & EMI': ['emi', 'emis', 'loan', 'loans'],
};

export interface Named {
  id: string;
  name: string;
}

/**
 * The category a sentence names: the user's own category name first (longest
 * wins, so "Personal Care" beats "Care"), then everyday words for it.
 */
export function findCategory<T extends Named>(
  text: string,
  categories: readonly T[],
): { item: T; exact: boolean } | null {
  const byLength = [...categories].sort((a, b) => b.name.length - a.name.length);
  const exact = byLength.find((c) => hasPhrase(text, c.name) || hasPhrase(text, c.name.replace(/s$/i, '')));
  if (exact) return { item: exact, exact: true };
  for (const c of byLength) {
    const words = CATEGORY_WORDS[c.name] ?? [];
    if (words.some((w) => hasPhrase(text, w))) return { item: c, exact: false };
  }
  return null;
}

/** A payment method named in the sentence: its full name, or a distinctive first word ("hdfc"). */
export function findAccount<T extends Named & { type: string }>(
  text: string,
  accounts: readonly T[],
): T | null {
  const full = accounts.filter((a) => hasPhrase(text, a.name));
  if (full.length === 1) return full[0]!;
  const generic = new Set([
    'my',
    'the',
    'bank',
    'card',
    'credit',
    'debit',
    'account',
    'savings',
    'cash',
    'wallet',
  ]);
  const first = accounts.filter((a) => {
    const w = norm(a.name).split(' ')[0] ?? '';
    return w.length >= 3 && !generic.has(w) && hasPhrase(text, w);
  });
  if (first.length === 1) return first[0]!;
  // "my credit card" when there is exactly one; "cash" when there is a cash account.
  if (/\bcredit card\b/i.test(text)) {
    const cards = accounts.filter((a) => a.type === 'credit_card');
    if (cards.length === 1) return cards[0]!;
  }
  if (/\b(?:in|from|with|by|using) cash\b|\bpaid cash\b/i.test(text)) {
    const cash = accounts.filter((a) => a.type === 'cash');
    if (cash.length === 1) return cash[0]!;
  }
  return null;
}

/** A friend named in the sentence: full name, first name or @username. */
export function findFriend<T extends { userId: string; name: string; username: string | null }>(
  text: string,
  friends: readonly T[],
): T | null {
  const hits = friends.filter(
    (f) =>
      hasPhrase(text, f.name) ||
      (norm(f.name).split(' ')[0]!.length >= 3 && hasPhrase(text, norm(f.name).split(' ')[0]!)) ||
      (!!f.username && (hasPhrase(text, f.username) || hasPhrase(text, `@${f.username}`))),
  );
  return hits.length === 1 ? hits[0]! : null;
}

const STOP =
  /\s+(?:using|via|with|by|from|on|in|for|last|this|yesterday|today|as|under|into|to|and|at|paid|spent|through|card|account|my)\b.*$/;

/** The merchant after "at" / "from" / "to" / "on" ("spent 500 at Starbucks yesterday" → Starbucks). */
export function findMerchant(text: string, exclude: (phrase: string) => boolean): string | null {
  const t = text.replace(/[?!]+$/, '');
  for (const re of [/\bat\s+(.+)$/i, /\bfrom\s+(.+)$/i, /\bon\s+(.+)$/i, /\bto\s+(.+)$/i]) {
    const m = t.match(re);
    if (!m) continue;
    const phrase = m[1]!
      .replace(STOP, '')
      .replace(/[.,;:]+.*$/, '')
      .replace(/^(?:the|a|an)\s+/i, '')
      .trim();
    if (phrase.length < 2 || phrase.length > 40 || /^\d/.test(phrase) || exclude(phrase)) continue;
    // "from yesterday", "on this week" — a time, not a merchant.
    if (
      /^(?:yesterday|today|tonight|last|this|past|previous|next)\b/i.test(phrase) ||
      MONTH_RE.test(phrase.toLowerCase())
    ) {
      continue;
    }
    return phrase.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return null;
}

// ---------------------------------------------------------------------------
// What the user wants
// ---------------------------------------------------------------------------

export type Intent =
  | { kind: 'spend' }
  | { kind: 'income' }
  | { kind: 'breakdown'; by: 'category' | 'merchant' | 'account' }
  | { kind: 'compare' }
  | { kind: 'balances'; cards: boolean }
  | { kind: 'friends' }
  | { kind: 'list' }
  | { kind: 'create'; type: 'expense' | 'income' }
  | { kind: 'recategorise' }
  | { kind: 'split' }
  | { kind: 'help' }
  | { kind: 'unknown' };

const QUESTION =
  /^(?:how|what|which|where|why|when|did|do|does|am|is|are|was|were|show|list|tell|give|can you tell)\b/i;

export function classify(text: string): Intent {
  const t = text.toLowerCase().trim();
  const amount = parseAmount(t) !== null;
  const question = QUESTION.test(t) || t.endsWith('?');

  if (/^(?:hi|hello|hey|help|what can you do|how do (?:i|you) use)\b/.test(t)) return { kind: 'help' };
  if (/\bsplit\b/.test(t) && !question) return { kind: 'split' };
  if (
    /\b(?:change|move|mark|set|re-?categori[sz]e|categori[sz]e|put|file|switch|make)\b/.test(t) &&
    /\b(?:to|as|under|into|in)\s+\w/.test(t) &&
    !question
  ) {
    return { kind: 'recategorise' };
  }
  if (
    amount &&
    !question &&
    /\b(?:record|add|log|note|spent|spend|paid|pay|bought|buy|got|received|earned|expense|income|credited)\b/.test(
      t,
    )
  ) {
    const income =
      /\b(?:income|salary|received|earned|got paid|credited|refund|bonus|freelance|dividend|interest)\b/.test(
        t,
      ) && !/\b(?:spent|paid|bought|expense)\b/.test(t);
    return { kind: 'create', type: income ? 'income' : 'expense' };
  }
  if (/\b(?:owe|owes|owed|lent|lend|borrowed|settle|settled|friends?)\b/.test(t)) return { kind: 'friends' };
  if (
    /\bwhy\b|\b(?:more|less) than\b|\bincrease[sd]?\b|\bdecrease[sd]?\b|\bwent up\b|\bwent down\b|\bcompare|\bvs\b|\bversus\b/.test(
      t,
    )
  ) {
    return { kind: 'compare' };
  }
  if (
    /\b(?:balance|balances|how much (?:money )?(?:do i have|have i got|is (?:in|left|there))|money (?:do i have|left)|available credit|credit limit|net worth|owe on|card (?:due|dues|bill)|outstanding)\b/.test(
      t,
    )
  ) {
    return { kind: 'balances', cards: /\bcard|credit\b/.test(t) };
  }
  if (
    /\b(?:where|biggest|largest|top|most|breakdown|split up|by category|categories|merchants?|shops?|stores?|which card|payment methods?|paid with)\b/.test(
      t,
    )
  ) {
    const by = /\bmerchants?\b|\bshops?\b|\bstores?\b|\bwhere did i (?:shop|buy)\b|\bat which\b/.test(t)
      ? 'merchant'
      : /\bwhich card\b|\bpayment methods?\b|\bpaid with\b|\baccounts?\b/.test(t)
        ? 'account'
        : 'category';
    if (!/\bhow much\b/.test(t) || /\bwhere\b|\bbreakdown\b/.test(t)) return { kind: 'breakdown', by };
  }
  if (/\b(?:show|list|recent|latest|last \d+|transactions|payments)\b/.test(t) && !/\bhow much\b/.test(t)) {
    return { kind: 'list' };
  }
  if (/\b(?:income|earned|earn|salary|money in|received|got paid)\b/.test(t)) return { kind: 'income' };
  if (
    /\b(?:spend|spent|spending|expense|expenses|cost|paid|pay for|bought)\b/.test(t) ||
    /\bhow much\b/.test(t)
  ) {
    return { kind: 'spend' };
  }
  return { kind: 'unknown' };
}
