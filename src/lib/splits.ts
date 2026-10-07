/**
 * Splitting a bill between people — pure, exact, in integer paise.
 *
 * Every method returns shares that add up to the total *exactly*. Leftover
 * paise (₹100 ÷ 3) go one at a time to people in the order given, so the
 * result is deterministic and never off by a paisa. The database checks the
 * same rule again (shares must equal the total) before saving anything.
 */
import type { Minor } from './money';

export type SplitMethod = 'equal' | 'amount' | 'percent' | 'shares' | 'items';

export interface SplitInput {
  userId: string;
  /** amount (paise) for 'amount'; percent (0–100, up to 2 dp) for 'percent'; share count for 'shares'. */
  value?: number;
}

export interface Share {
  userId: string;
  amount: Minor;
  /** What was entered for this person, kept for editing later. */
  input: number | null;
}

export type SplitResult = { ok: true; shares: Share[] } | { ok: false; error: string };

/** Splits `total` in proportion to `weights` (all ≥ 0, at least one > 0), exactly. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floored = raw.map(Math.floor);
  let left = total - floored.reduce((s, v) => s + v, 0);
  // Largest remainders first; ties keep the original order.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (weights[i]! > 0) {
      floored[i]! += 1;
      left -= 1;
    }
  }
  return floored;
}

export function splitBill(total: Minor, method: SplitMethod, people: SplitInput[]): SplitResult {
  if (!Number.isInteger(total) || total <= 0) return { ok: false, error: 'Enter the bill total.' };
  if (people.length < 2) return { ok: false, error: 'Add at least one other person.' };
  if (new Set(people.map((p) => p.userId)).size !== people.length) {
    return { ok: false, error: 'Someone is in the split twice.' };
  }

  switch (method) {
    case 'equal': {
      const amounts = allocate(
        total,
        people.map(() => 1),
      );
      return ok(people.map((p, i) => ({ userId: p.userId, amount: amounts[i] as Minor, input: null })));
    }
    case 'amount': {
      const values = people.map((p) => p.value ?? 0);
      if (values.some((v) => !Number.isInteger(v) || v < 0))
        return { ok: false, error: 'Amounts can’t be negative.' };
      const sum = values.reduce((s, v) => s + v, 0);
      if (sum !== total) {
        const diff = total - sum;
        return {
          ok: false,
          error: diff > 0 ? `${paise(diff)} still to assign.` : `${paise(-diff)} more than the bill.`,
        };
      }
      return ok(people.map((p, i) => ({ userId: p.userId, amount: values[i] as Minor, input: values[i]! })));
    }
    case 'percent': {
      const values = people.map((p) => p.value ?? 0);
      if (values.some((v) => v < 0)) return { ok: false, error: 'Percentages can’t be negative.' };
      const sum = Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100;
      if (sum !== 100) return { ok: false, error: `Percentages add up to ${sum}%, not 100%.` };
      const amounts = allocate(total, values);
      return ok(people.map((p, i) => ({ userId: p.userId, amount: amounts[i] as Minor, input: values[i]! })));
    }
    case 'shares': {
      const values = people.map((p) => p.value ?? 0);
      if (values.some((v) => !Number.isInteger(v) || v < 0)) return { ok: false, error: 'Use whole shares.' };
      if (values.every((v) => v === 0)) return { ok: false, error: 'Give someone at least one share.' };
      const amounts = allocate(total, values);
      return ok(people.map((p, i) => ({ userId: p.userId, amount: amounts[i] as Minor, input: values[i]! })));
    }
    case 'items':
      return { ok: false, error: 'Use splitItems for itemised bills.' };
  }
}

export interface BillItem {
  label: string;
  amount: Minor;
  /** Who shares this item; empty = everyone (e.g. tax, service charge). */
  userIds: string[];
}

/** Itemised bill: each item split equally among the people on it; the total is the items' sum. */
export function splitItems(items: BillItem[], people: string[]): SplitResult {
  if (people.length < 2) return { ok: false, error: 'Add at least one other person.' };
  if (items.length === 0) return { ok: false, error: 'Add the items from the bill.' };
  const totals = new Map(people.map((p) => [p, 0]));
  for (const item of items) {
    const on = item.userIds.length ? item.userIds : people;
    if (on.some((u) => !totals.has(u)))
      return { ok: false, error: `${item.label}: someone isn’t in the split.` };
    const parts = allocate(
      item.amount,
      on.map(() => 1),
    );
    on.forEach((u, i) => totals.set(u, totals.get(u)! + parts[i]!));
  }
  return ok(people.map((u) => ({ userId: u, amount: totals.get(u)! as Minor, input: null })));
}

function ok(shares: Share[]): SplitResult {
  return { ok: true, shares };
}

function paise(v: number) {
  return `₹${(v / 100).toLocaleString('en-IN', { minimumFractionDigits: v % 100 ? 2 : 0 })}`;
}

// ---------------------------------------------------------------------------
// Smart settlement
// ---------------------------------------------------------------------------

export interface Transfer {
  from: string;
  to: string;
  amount: Minor;
}

/**
 * The fewest payments that settle a group. `net` is each member's position in
 * paise (positive = is owed, negative = owes); it must sum to zero.
 *
 * Greedy: the person who owes most pays the person owed most, repeatedly.
 * This settles n people in at most n − 1 payments and clears circular debts
 * (A→B→C→A) entirely. It only *suggests* payments — the expenses themselves
 * are never changed.
 */
export function minimiseTransfers(net: Record<string, number>): Transfer[] {
  const debtors = Object.entries(net)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, v: -v }));
  const creditors = Object.entries(net)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, v }));
  const out: Transfer[] = [];
  const byAmount = (a: { id: string; v: number }, b: { id: string; v: number }) =>
    b.v - a.v || a.id.localeCompare(b.id);
  while (debtors.length && creditors.length) {
    debtors.sort(byAmount);
    creditors.sort(byAmount);
    const d = debtors[0]!;
    const c = creditors[0]!;
    const amount = Math.min(d.v, c.v);
    if (amount > 0) out.push({ from: d.id, to: c.id, amount: amount as Minor });
    d.v -= amount;
    c.v -= amount;
    if (d.v === 0) debtors.shift();
    if (c.v === 0) creditors.shift();
  }
  return out;
}
