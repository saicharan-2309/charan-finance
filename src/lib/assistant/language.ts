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
  /** Exact instants for windows shorter than a day ("last hour"); start/end are then today. */
  from?: string;
  to?: string;
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

/** "one" → 1 … "twelve" → 12, "a"/"an" → 1 (before a unit), "couple of" → 2. */
const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  'couple of': 2,
  few: 3,
};

/** Lower-case, "todays" → "today", word numbers before a time unit → digits. */
function normaliseTime(text: string): string {
  let t = ` ${text.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ')} `;
  t = t.replace(/\btodays\b/g, 'today').replace(/\byesterdays\b/g, 'yesterday');
  t = t.replace(
    /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|couple of|few)\s+(minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b/g,
    (_, n: string, unit: string) => `${WORD_NUMBERS[n]} ${unit}`,
  );
  return t;
}

/** Midnight of an ISO date in the device's time zone, as an instant. */
function localMidnight(d: ISODate): Date {
  const [y, m, day] = parts(d);
  return new Date(y, m - 1, day, 0, 0, 0, 0);
}
function clock(d: Date): string {
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
}

/**
 * The period a sentence talks about, or null if it names none. Windows shorter
 * than a day ("last hour", "this morning") carry exact instants in from/to.
 */
export function parsePeriod(
  text: string,
  today: ISODate,
  startDay: number,
  now: Date = new Date(),
): Period | null {
  const t = normaliseTime(text);

  // Minutes and hours: "last hour", "last 3 hours", "past 30 minutes", "in the last one hour".
  const shortWindow = t.match(
    /\b(?:last|past|previous|within|in the last|in the past)\s+(?:(\d{1,3})\s*)?(minutes?|mins?|hours?|hrs?)\b/,
  );
  if (shortWindow) {
    const n = Math.min(Math.max(Number(shortWindow[1] ?? 1), 1), 72);
    const unit = shortWindow[2]!.startsWith('h') ? 'hour' : 'minute';
    const ms = n * (unit === 'hour' ? 3_600_000 : 60_000);
    const from = new Date(now.getTime() - ms);
    return {
      start: today,
      end: today,
      from: from.toISOString(),
      to: now.toISOString(),
      label: `the last ${n === 1 ? '' : `${n} `}${unit}${n === 1 ? '' : 's'} (since ${clock(from)})`,
    };
  }
  const part = t.match(/\bthis (morning|afternoon|evening)\b|\btonight\b/);
  if (part) {
    const which = part[1] ?? 'evening';
    const startHour = which === 'morning' ? 0 : which === 'afternoon' ? 12 : 17;
    const endHour = which === 'morning' ? 12 : which === 'afternoon' ? 17 : 24;
    const from = new Date(localMidnight(today).getTime() + startHour * 3_600_000);
    const to = new Date(Math.min(now.getTime(), localMidnight(today).getTime() + endHour * 3_600_000));
    return {
      start: today,
      end: today,
      from: from.toISOString(),
      to: to.toISOString(),
      label: `this ${which}`,
    };
  }

  if (/\bday before yesterday\b/.test(t)) {
    const d = addDays(today, -2);
    return { start: d, end: d, label: `the day before yesterday (${dayLabel(d)})` };
  }
  if (/\btoday\b/.test(t)) return { start: today, end: today, label: 'today' };
  if (/\byesterday\b/.test(t)) {
    const y = addDays(today, -1);
    return { start: y, end: y, label: 'yesterday' };
  }

  // A specific day: "on 5 oct", "5th october", "october 5", "5/10", "05-10-2026".
  const [ty, tm] = parts(today);
  const pickYear = (month: number, day: number, year?: number) => {
    if (year) return year < 100 ? 2000 + year : year;
    return isoOf(ty, month, day) > today ? ty - 1 : ty;
  };
  const dayMonth =
    t.match(
      new RegExp(
        `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE.source.slice(2, -2)}\\b(?:,?\\s+(\\d{4}))?`,
      ),
    ) ?? null;
  const monthDay = t.match(
    new RegExp(
      `${MONTH_RE.source.slice(0, -2)}\\b\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\d)(?:,?\\s+(\\d{4}))?`,
    ),
  );
  const numeric = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  const monthIndex = (word: string) =>
    MONTH_LONG.findIndex((n) => n.toLowerCase().startsWith(word.slice(0, 3))) + 1;
  let specific: { d: number; m: number; y?: number } | null = null;
  if (dayMonth)
    specific = {
      d: Number(dayMonth[1]),
      m: monthIndex(dayMonth[2]!),
      y: dayMonth[3] ? Number(dayMonth[3]) : undefined,
    };
  else if (monthDay && Number(monthDay[2]) <= 31 && !/^\d{4}$/.test(monthDay[2]!))
    specific = {
      d: Number(monthDay[2]),
      m: monthIndex(monthDay[1]!),
      y: monthDay[3] ? Number(monthDay[3]) : undefined,
    };
  else if (numeric && Number(numeric[2]) <= 12 && Number(numeric[1]) <= 31)
    specific = {
      d: Number(numeric[1]),
      m: Number(numeric[2]),
      y: numeric[3] ? Number(numeric[3]) : undefined,
    };
  if (specific && specific.m >= 1 && specific.d >= 1) {
    const year = pickYear(specific.m, specific.d, specific.y);
    const d = isoOf(year, specific.m, specific.d);
    if (Number(d.slice(8, 10)) === specific.d) return { start: d, end: d, label: `on ${dayLabel(d)}` };
  }

  const nUnits = t.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+(days?|weeks?|months?|years?)\b/);
  if (nUnits) {
    const n = Math.min(Math.max(Number(nUnits[1]), 1), 3650);
    const unit = nUnits[2]!.replace(/s$/, '');
    const days = unit === 'day' ? n : unit === 'week' ? n * 7 : unit === 'month' ? n * 30 : n * 365;
    const start =
      unit === 'month'
        ? (() => {
            const [y, m, d] = parts(today);
            return addDays(isoOf(y, m - n, d), 1);
          })()
        : unit === 'year'
          ? addDays(isoOf(ty - n, tm, parts(today)[2]), 1)
          : addDays(today, -(days - 1));
    return { start, end: today, label: `the last ${n} ${unit}${n === 1 ? '' : 's'}` };
  }
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const monday = addDays(today, -weekday);
  if (/\b(?:last|previous|past) weekend\b/.test(t) || (/\bweekend\b/.test(t) && weekday < 5)) {
    return { start: addDays(monday, -2), end: addDays(monday, -1), label: 'last weekend' };
  }
  if (/\bthis weekend\b|\bweekend\b/.test(t)) {
    return { start: addDays(monday, 5), end: today, label: 'this weekend' };
  }
  if (/\bthis week\b/.test(t)) return { start: monday, end: today, label: 'this week' };
  if (/\b(?:last|previous|past) week\b/.test(t)) {
    return { start: addDays(monday, -7), end: addDays(monday, -1), label: 'last week' };
  }
  if (/\b(?:last|previous|past) (?:money |pay )?(?:month|cycle)\b|\blast pay ?cycle\b/.test(t)) {
    const current = moneyMonth(today, startDay);
    return { ...moneyMonth(addDays(current.start, -1), startDay), label: 'last month' };
  }
  if (/\bthis (?:money |pay )?(?:month|cycle)\b|\bsince pay ?day\b|\bso far\b|\bmonth to date\b/.test(t)) {
    return thisMonth(today, startDay);
  }
  if (/\bthis year\b/.test(t)) return { start: isoOf(ty, 1, 1), end: today, label: 'this year' };
  if (/\b(?:last|previous|past) year\b/.test(t)) {
    return { start: isoOf(ty - 1, 1, 1), end: isoOf(ty - 1, 12, 31), label: `${ty - 1}` };
  }
  // "in September", "for sept 2025", "september 2025" — "may" only with a cue word or year.
  const cue = t.match(
    new RegExp(`\\b(?:in|for|during|of|since)\\s+${MONTH_RE.source.slice(2, -2)}\\b(?:\\s+(\\d{4}))?`),
  );
  const withYear = t.match(new RegExp(`${MONTH_RE.source.slice(0, -2)}\\b\\s+(\\d{4})\\b`));
  const hit = cue ?? withYear;
  if (hit) {
    const word = hit[0].match(MONTH_RE)![1]!;
    const month = monthIndex(word);
    const yearText = hit[hit.length - 1];
    const year = yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : month > tm ? ty - 1 : ty;
    const end = isoOf(year, month + 1, 0);
    return {
      start: isoOf(year, month, 1),
      end: end > today ? today : end,
      label: year === ty ? MONTH_LONG[month - 1]! : `${MONTH_LONG[month - 1]} ${year}`,
    };
  }
  return null;
}

/**
 * True when a sentence mentions a time we may not have understood — then the
 * engine asks instead of quietly answering for a different period.
 */
export function mentionsTime(text: string): boolean {
  return /\b(today|tonight|yesterday|morning|afternoon|evening|night|noon|hour|hours|hr|hrs|minute|minutes|mins?|week|weeks|weekend|fortnight|month|months|year|years|days?|ago|since|until|till|between|from|before|after|\d{1,2}(?:st|nd|rd|th)|\d{1,2}[/-]\d{1,2}|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i.test(
    normaliseTime(text),
  );
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

/** Words that describe an account's kind, not which one it is. */
const ACCOUNT_GENERIC = new Set([
  'my',
  'the',
  'a',
  'an',
  'bank',
  'card',
  'cards',
  'credit',
  'debit',
  'account',
  'accounts',
  'acc',
  'ac',
  'savings',
  'saving',
  'current',
  'cash',
  'wallet',
  'upi',
  'ending',
  'with',
  'on',
  'using',
  'via',
  'from',
  'in',
  'of',
  'ltd',
  'limited',
  'india',
]);

type AccountLike = Named & {
  type: string;
  provider?: string | null;
  institution?: string | null;
  last4?: string | null;
};

/** The kind of account a sentence asks about, if any. */
function typeHint(t: string): Set<string> | null {
  if (/\bdebit cards?\b/.test(t)) return new Set(['debit_card']);
  if (/\bcredit ?cards?\b|\bcc\b|\bcards?\b/.test(t)) return new Set(['credit_card']);
  if (/\b(?:bank accounts?|savings?(?: account)?|current account|accounts?|a ?c)\b/.test(t)) {
    return new Set(['bank', 'savings']);
  }
  if (/\bcash\b/.test(t)) return new Set(['cash']);
  if (/\b(?:wallets?|upi|gpay|google pay|paytm|phonepe|amazon pay)\b/.test(t)) return new Set(['wallet']);
  return null;
}

/**
 * Which payment method(s) a sentence means. Scored on distinctive name words
 * ("axis"), the bank, the last four digits, and the kind of account asked for
 * ("credit card" → cards, "account" → bank accounts). "Axis bank credit card"
 * is the Axis card, not the Axis savings account; "my credit cards" with
 * several cards is all of them.
 */
export function findAccounts<T extends AccountLike>(
  text: string,
  accounts: readonly T[],
): { one: T } | { many: T[]; label: string } | null {
  const t = ` ${norm(text)} `;
  const hint = typeHint(t);
  const digits = t.match(/\b(\d{4})\b/)?.[1];
  const scored = accounts.map((a) => {
    const words = new Set(
      [a.name, a.provider ?? '', a.institution ?? '']
        .flatMap((s) => norm(s).split(' '))
        .filter((w) => w.length >= 3 && !ACCOUNT_GENERIC.has(w)),
    );
    let score = 0;
    for (const w of words) if (t.includes(` ${w} `)) score += 1;
    if (hasPhrase(t, a.name)) score += 3;
    if (digits && a.last4 === digits) score += 5;
    if (hint) score += hint.has(a.type) ? 2 : -3;
    return {
      a,
      score,
      named: [...words].some((w) => t.includes(` ${w} `)) || (!!digits && a.last4 === digits),
    };
  });
  const best = Math.max(...scored.map((x) => x.score), 0);
  if (best <= 0) return null;
  const top = scored.filter((x) => x.score === best);
  if (top.length === 1) return { one: top[0]!.a };
  // Several equally good: "my credit cards" means all of them — but only when no
  // distinctive name was given (then it's genuinely ambiguous).
  if (hint && top.every((x) => hint.has(x.a.type)) && !top.some((x) => x.named)) {
    const label = hint.has('credit_card')
      ? 'your credit cards'
      : hint.has('debit_card')
        ? 'your debit cards'
        : hint.has('cash')
          ? 'cash'
          : hint.has('wallet')
            ? 'your wallets'
            : 'your bank accounts';
    return { many: top.map((x) => x.a), label };
  }
  return null;
}

/** The single payment method a sentence names, if it names exactly one. */
export function findAccount<T extends AccountLike>(text: string, accounts: readonly T[]): T | null {
  const r = findAccounts(text, accounts);
  return r && 'one' in r ? r.one : null;
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
