/**
 * The payment-method catalogue.
 *
 * One account row models every way money moves: a bank account, a credit or
 * debit card, cash, a UPI app, an investment or a loan account. Nothing in the
 * app is tied to a credit card — a card is simply one type in this list, and
 * the app works the same with none of them.
 *
 * Each type declares which fields actually apply to it, so a Cash account is
 * never asked for a credit limit or a billing date.
 */
import { isLiability, isLiquid } from './accounts';
import type { ISODate } from './dates';
import type { Minor } from './money';
import type { Account, AccountType } from '@/types/domain';

// ---------------------------------------------------------------------------
// Groups — how accounts are presented, in this order
// ---------------------------------------------------------------------------
export type MethodGroup = 'bank' | 'cards' | 'cash' | 'other';

export const GROUP_LABELS: Record<MethodGroup, string> = {
  bank: 'Bank accounts',
  cards: 'Credit cards',
  cash: 'Cash & wallets',
  other: 'Investments & loans',
};

export const GROUP_ORDER: MethodGroup[] = ['bank', 'cards', 'cash', 'other'];

const GROUP_OF: Record<AccountType, MethodGroup> = {
  bank: 'bank',
  savings: 'bank',
  credit_card: 'cards',
  debit_card: 'cards',
  cash: 'cash',
  wallet: 'cash',
  investment: 'other',
  loan: 'other',
  other_asset: 'other',
  other_liability: 'other',
};

export const groupOf = (type: AccountType): MethodGroup => GROUP_OF[type];

/** Groups accounts for the Accounts & Payment Methods screen, keeping order. */
export function groupAccounts(accounts: readonly Account[]): { group: MethodGroup; items: Account[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    items: accounts.filter((a) => groupOf(a.type) === group),
  })).filter((g) => g.items.length > 0);
}

// ---------------------------------------------------------------------------
// Which fields apply to which type
// ---------------------------------------------------------------------------
export interface MethodFields {
  /** Bank/card last four digits. Never a full number, CVV or PIN. */
  last4: boolean;
  institution: boolean;
  /** A chooseable provider (bank brand or UPI app). */
  provider: boolean;
  balance: boolean;
  creditLimit: boolean;
  billingDates: boolean;
}

const NO_FIELDS: MethodFields = {
  last4: false,
  institution: false,
  provider: false,
  balance: true,
  creditLimit: false,
  billingDates: false,
};

export function fieldsFor(type: AccountType): MethodFields {
  switch (type) {
    case 'bank':
    case 'savings':
      return { ...NO_FIELDS, last4: true, institution: true, provider: true };
    case 'credit_card':
      return {
        last4: true,
        institution: true,
        provider: true,
        balance: true,
        creditLimit: true,
        billingDates: true,
      };
    case 'debit_card':
      return { ...NO_FIELDS, last4: true, institution: true, provider: true };
    case 'wallet':
      return { ...NO_FIELDS, provider: true };
    case 'cash':
      return NO_FIELDS;
    case 'loan':
      return { ...NO_FIELDS, last4: true, institution: true };
    case 'investment':
      return { ...NO_FIELDS, institution: true };
    default:
      return NO_FIELDS;
  }
}

// ---------------------------------------------------------------------------
// Providers
//
// A provider is display identity only — a name, an icon and a tint. It never
// implies any connection to the institution and stores no credentials.
// `custom` is always available: the user can name anything.
// ---------------------------------------------------------------------------
export interface Provider {
  key: string;
  label: string;
  icon: string;
  color: string;
  /** Suggested institution text when this provider is chosen. */
  institution?: string;
}

/** UPI apps and digital wallets. */
export const UPI_PROVIDERS: Provider[] = [
  { key: 'gpay', label: 'Google Pay', icon: 'logo-google', color: '#1F86C7' },
  { key: 'phonepe', label: 'PhonePe', icon: 'phone-portrait-outline', color: '#7A5CCB' },
  { key: 'paytm', label: 'Paytm', icon: 'wallet-outline', color: '#127F9E' },
  { key: 'amazonpay', label: 'Amazon Pay', icon: 'cart-outline', color: '#A2541F' },
  { key: 'upi_other', label: 'Other UPI app', icon: 'at-outline', color: '#7B828C' },
];

/** Indian banks and card issuers, as presets for name + institution. */
export const BANK_PROVIDERS: Provider[] = [
  { key: 'hdfc', label: 'HDFC', icon: 'business-outline', color: '#1F86C7', institution: 'HDFC Bank' },
  {
    key: 'sbi',
    label: 'SBI',
    icon: 'business-outline',
    color: '#5A67C2',
    institution: 'State Bank of India',
  },
  { key: 'icici', label: 'ICICI', icon: 'business-outline', color: '#C2703A', institution: 'ICICI Bank' },
  { key: 'axis', label: 'Axis', icon: 'business-outline', color: '#C23F5E', institution: 'Axis Bank' },
  {
    key: 'kotak',
    label: 'Kotak',
    icon: 'business-outline',
    color: '#127F9E',
    institution: 'Kotak Mahindra Bank',
  },
  { key: 'amex', label: 'Amex', icon: 'card-outline', color: '#0F7F73', institution: 'American Express' },
  { key: 'other_bank', label: 'Other', icon: 'business-outline', color: '#7B828C' },
];

export function providersFor(type: AccountType): Provider[] {
  if (type === 'wallet') return UPI_PROVIDERS;
  if (type === 'bank' || type === 'savings' || type === 'credit_card' || type === 'debit_card')
    return BANK_PROVIDERS;
  return [];
}

const ALL_PROVIDERS = [...UPI_PROVIDERS, ...BANK_PROVIDERS];

export const providerByKey = (key: string | null | undefined): Provider | null =>
  key ? (ALL_PROVIDERS.find((p) => p.key === key) ?? null) : null;

/**
 * The icon and tint an account should show.
 *
 * The provider supplies the tint; the type supplies the icon, because a card
 * should look like a card whoever issued it. A UPI wallet is the exception —
 * there the app *is* the identity, so its glyph wins. An icon saved on the
 * account always takes precedence over both.
 */
export function accountVisual(a: Pick<Account, 'type' | 'provider' | 'icon' | 'color'>): {
  icon: string;
  color: string | null;
} {
  const p = providerByKey(a.provider);
  return {
    icon: a.icon ?? (a.type === 'wallet' ? (p?.icon ?? METHOD_ICONS[a.type]) : METHOD_ICONS[a.type]),
    color: a.color ?? p?.color ?? null,
  };
}

export const METHOD_ICONS: Record<AccountType, string> = {
  bank: 'business-outline',
  // A savings account is a bank account: same glyph, so the two read as a pair.
  savings: 'business-outline',
  cash: 'cash-outline',
  credit_card: 'card-outline',
  debit_card: 'card-outline',
  wallet: 'phone-portrait-outline',
  investment: 'trending-up-outline',
  loan: 'document-text-outline',
  other_asset: 'diamond-outline',
  other_liability: 'alert-circle-outline',
};

// ---------------------------------------------------------------------------
// Add flow: the types offered, in the order they are offered
// ---------------------------------------------------------------------------
export interface MethodChoice {
  type: AccountType;
  label: string;
  hint: string;
  icon: string;
}

export const METHOD_CHOICES: MethodChoice[] = [
  { type: 'savings', label: 'Bank account', hint: 'Savings, salary or current', icon: 'business-outline' },
  { type: 'credit_card', label: 'Credit card', hint: 'Limit, billing and due dates', icon: 'card-outline' },
  { type: 'debit_card', label: 'Debit card', hint: 'Linked to a bank account', icon: 'card-outline' },
  { type: 'cash', label: 'Cash', hint: 'Wallet cash or petty cash', icon: 'cash-outline' },
  {
    type: 'wallet',
    label: 'UPI or wallet',
    hint: 'Google Pay, PhonePe, Paytm…',
    icon: 'phone-portrait-outline',
  },
  { type: 'investment', label: 'Investment', hint: 'Mutual funds, stocks, FD', icon: 'trending-up-outline' },
  { type: 'loan', label: 'Loan account', hint: 'Outstanding amount you owe', icon: 'document-text-outline' },
  {
    type: 'other_asset',
    label: 'Something else',
    hint: 'Any other asset or liability',
    icon: 'ellipse-outline',
  },
];

// ---------------------------------------------------------------------------
// Numbers to display
// ---------------------------------------------------------------------------
export interface CardStanding {
  /** Outstanding amount owed (positive), 0 when settled or in credit. */
  used: Minor;
  /** Limit − used, or null without a limit. Never negative. */
  available: Minor | null;
  /** Fraction of the limit used (0–1+), or null without a limit. */
  utilisation: number | null;
  /** Positive when the card has been overpaid. */
  inCredit: Minor;
}

/**
 * A credit card's standing from its balance alone: a negative balance is debt.
 * Available credit is always derived, never stored.
 */
export function cardStanding(a: Pick<Account, 'currentBalance' | 'creditLimit'>): CardStanding {
  const used = Math.max(-a.currentBalance, 0) as Minor;
  const inCredit = Math.max(a.currentBalance, 0) as Minor;
  const limit = a.creditLimit;
  return {
    used,
    available: limit == null ? null : (Math.max(limit - used, 0) as Minor),
    utilisation: limit == null || limit === 0 ? null : used / limit,
    inCredit,
  };
}

/** What a row should show as its headline figure, and how to caption it. */
export function balanceDisplay(a: Account): { amount: Minor; caption: string | null } {
  if (a.type === 'credit_card') {
    const s = cardStanding(a);
    if (s.inCredit > 0) return { amount: s.inCredit, caption: 'in credit' };
    return { amount: s.used, caption: s.used === 0 ? 'nothing owed' : 'used' };
  }
  if (isLiability(a.type)) {
    const owed = Math.max(-a.currentBalance, 0) as Minor;
    return { amount: owed, caption: owed === 0 ? 'settled' : 'owed' };
  }
  return { amount: a.currentBalance, caption: null };
}

/** True when an account can fund spending (so "Paid from" shows it first). */
export const canSpendFrom = (a: Account): boolean =>
  a.isActive && (isLiquid(a.type) || a.type === 'credit_card');

// ---------------------------------------------------------------------------
// Billing dates
//
// Pure date arithmetic, clamped to month length so a statement day of 31
// lands on 28 February instead of overflowing — the same rule as the SQL
// `day_in_month`.
// ---------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number): ISODate => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** The given day of month, clamped to that month's length. */
export function dayInMonth(year: number, month: number, day: number): ISODate {
  return iso(year, month, Math.min(Math.max(day, 1), daysInMonth(year, month)));
}

/** The next occurrence of `day` strictly after `afterISO`. */
export function nextMonthlyDay(day: number, afterISO: ISODate): ISODate {
  const [y, m, d] = afterISO.split('-').map(Number);
  const thisMonth = dayInMonth(y, m - 1, day);
  if (thisMonth > iso(y, m - 1, d)) return thisMonth;
  return dayInMonth(m === 12 ? y + 1 : y, m === 12 ? 0 : m, day);
}

export interface CardDates {
  nextStatement: ISODate | null;
  nextDue: ISODate | null;
}

export function cardDates(a: Pick<Account, 'statementDay' | 'dueDay'>, todayISODate: ISODate): CardDates {
  return {
    nextStatement: a.statementDay ? nextMonthlyDay(a.statementDay, todayISODate) : null,
    nextDue: a.dueDay ? nextMonthlyDay(a.dueDay, todayISODate) : null,
  };
}

// ---------------------------------------------------------------------------
// Flow: what a transaction actually is
//
// A transfer into a credit card is a card payment — it reduces what is owed
// and must never read as a second expense. The distinction is derived from the
// destination account type, so it stays correct for past transactions too.
// ---------------------------------------------------------------------------
export type TransactionFlow = 'expense' | 'income' | 'card_payment' | 'transfer' | 'adjustment';

export const FLOW_LABELS: Record<TransactionFlow, string> = {
  expense: 'Expense',
  income: 'Income',
  card_payment: 'Card payment',
  transfer: 'Transfer',
  adjustment: 'Adjustment',
};

export const FLOW_ICONS: Record<TransactionFlow, string> = {
  expense: 'arrow-up-circle-outline',
  income: 'arrow-down-circle-outline',
  card_payment: 'card-outline',
  transfer: 'swap-horizontal',
  adjustment: 'construct-outline',
};

export function transactionFlow(t: {
  type: 'expense' | 'income' | 'transfer' | 'adjustment';
  toAccountType?: AccountType | null;
}): TransactionFlow {
  if (t.type === 'transfer') return t.toAccountType === 'credit_card' ? 'card_payment' : 'transfer';
  return t.type;
}

/** True for the two flows that move money without spending it. */
export const isMoveNotSpend = (flow: TransactionFlow): boolean =>
  flow === 'transfer' || flow === 'card_payment';
