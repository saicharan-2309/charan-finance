/**
 * Account classification, balance effects and net worth.
 *
 * The effect rules are identical to the database trigger
 * `apply_transaction_effect`; the app uses them for optimistic offline updates
 * and they are unit-tested against the same scenarios as the SQL tests.
 *
 * Icons, providers, per-type field rules and the display helpers built on top
 * of these live in `payment-methods.ts`.
 */
import type { Minor } from './money';
import type { AccountType, TxnType, UUID } from '@/types/domain';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: 'Bank account',
  savings: 'Savings account',
  cash: 'Cash',
  credit_card: 'Credit card',
  debit_card: 'Debit card',
  wallet: 'UPI or wallet',
  investment: 'Investment',
  loan: 'Loan',
  other_asset: 'Other asset',
  other_liability: 'Other liability',
};

const LIABILITIES: ReadonlySet<AccountType> = new Set(['credit_card', 'loan', 'other_liability']);
const LIQUID: ReadonlySet<AccountType> = new Set(['bank', 'savings', 'cash', 'wallet', 'debit_card']);

export const isLiability = (t: AccountType) => LIABILITIES.has(t);
export const isLiquid = (t: AccountType) => LIQUID.has(t);

export interface EffectInput {
  type: TxnType;
  amount: Minor;
  accountId: UUID;
  toAccountId: UUID | null;
}

/** Balance deltas a transaction applies, keyed by account id. */
export function transactionEffects(t: EffectInput): Map<UUID, Minor> {
  const out = new Map<UUID, number>();
  const add = (id: UUID, delta: number) => out.set(id, (out.get(id) ?? 0) + delta);
  switch (t.type) {
    case 'expense':
      add(t.accountId, -t.amount);
      break;
    case 'income':
    case 'adjustment':
      add(t.accountId, t.amount);
      break;
    case 'transfer':
      if (!t.toAccountId) throw new Error('Transfer needs a destination account');
      add(t.accountId, -t.amount);
      add(t.toAccountId, t.amount);
      break;
  }
  return out as Map<UUID, Minor>;
}

/** Applies a create (+1), delete (−1) or edit (old −1, new +1) to balances. */
export function applyEffects(
  balances: ReadonlyMap<UUID, Minor>,
  changes: { before?: EffectInput | null; after?: EffectInput | null },
): Map<UUID, Minor> {
  const next = new Map<UUID, number>(balances);
  if (changes.before) {
    for (const [id, d] of transactionEffects(changes.before)) next.set(id, (next.get(id) ?? 0) - d);
  }
  if (changes.after) {
    for (const [id, d] of transactionEffects(changes.after)) next.set(id, (next.get(id) ?? 0) + d);
  }
  return next as Map<UUID, Minor>;
}

export interface NetWorthAccount {
  type: AccountType;
  currentBalance: Minor;
  includeInNetWorth: boolean;
  isActive?: boolean;
  currency: string;
}

export interface NetWorthResult {
  assets: Minor;
  liabilities: Minor;
  netWorth: Minor;
  excludedCurrencies: string[];
}

/**
 * Assets − Liabilities. Mirrors `capture_net_worth_snapshot`: a positive balance
 * is an asset and a negative balance a liability regardless of account type
 * (an overdrawn bank account is a liability; an overpaid card is an asset).
 * Accounts in other currencies are excluded (no FX conversion is fabricated).
 */
export function computeNetWorth(accounts: readonly NetWorthAccount[], currency: string): NetWorthResult {
  let assets = 0;
  let liabilities = 0;
  const excluded = new Set<string>();
  for (const a of accounts) {
    if (a.isActive === false || !a.includeInNetWorth) continue;
    if (a.currency !== currency) {
      excluded.add(a.currency);
      continue;
    }
    if (a.currentBalance >= 0) assets += a.currentBalance;
    else liabilities += -a.currentBalance;
  }
  return {
    assets: assets as Minor,
    liabilities: liabilities as Minor,
    netWorth: (assets - liabilities) as Minor,
    excludedCurrencies: [...excluded],
  };
}

/** Sum of balances in liquid accounts ("How much money do I have?"). */
export function liquidBalance(accounts: readonly NetWorthAccount[], currency: string): Minor {
  let total = 0;
  for (const a of accounts) {
    if (a.isActive === false || a.currency !== currency || !isLiquid(a.type)) continue;
    total += a.currentBalance;
  }
  return total as Minor;
}

/** Outstanding amount owed on credit cards (positive number). */
export function creditCardDues(accounts: readonly NetWorthAccount[], currency: string): Minor {
  let total = 0;
  for (const a of accounts) {
    if (a.isActive === false || a.currency !== currency || a.type !== 'credit_card') continue;
    if (a.currentBalance < 0) total += -a.currentBalance;
  }
  return total as Minor;
}
