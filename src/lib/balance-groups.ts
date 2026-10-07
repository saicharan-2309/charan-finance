/**
 * What a balance group adds up to. Cash-type methods (bank, savings, cash,
 * UPI, debit card) add their balance. Credit cards never add their limit as
 * cash: they contribute what is owed and how much credit is still available.
 */
import { cardStanding } from './payment-methods';
import type { Minor } from './money';
import type { Account } from '@/types/domain';

const CASH_TYPES = new Set(['bank', 'savings', 'cash', 'wallet', 'debit_card']);

export interface GroupSummary {
  /** Sum of cash-type balances. */
  cash: Minor;
  /** Credit-card balances owed. */
  owed: Minor;
  /** Credit still available on cards with a limit. */
  availableCredit: Minor;
  /** Sum of the limits of cards in the group (shown as "of ₹… limit"). */
  creditLimit: Minor;
  cashCount: number;
  cardCount: number;
  /** Other kinds (investments, loans…) — listed, not added. */
  otherCount: number;
}

export function summariseGroup(accounts: readonly Account[], currency: string): GroupSummary {
  let cash = 0;
  let owed = 0;
  let available = 0;
  let limit = 0;
  let cashCount = 0;
  let cardCount = 0;
  let otherCount = 0;
  for (const a of accounts) {
    if (!a.isActive || a.currency !== currency) continue;
    if (CASH_TYPES.has(a.type)) {
      cash += a.currentBalance;
      cashCount += 1;
    } else if (a.type === 'credit_card') {
      const s = cardStanding(a);
      owed += s.used;
      if (s.available !== null) available += s.available;
      limit += a.creditLimit ?? 0;
      cardCount += 1;
    } else {
      otherCount += 1;
    }
  }
  return {
    cash: cash as Minor,
    owed: owed as Minor,
    availableCredit: available as Minor,
    creditLimit: limit as Minor,
    cashCount,
    cardCount,
    otherCount,
  };
}

/** The figure a group's card leads with: cash for cash groups, owed for card-only groups. */
export function groupHeadline(s: GroupSummary): { amount: Minor; label: string } {
  if (s.cashCount === 0 && s.cardCount > 0) return { amount: s.owed, label: 'Owed on cards' };
  return { amount: s.cash, label: s.cardCount ? 'Cash' : 'Available' };
}
