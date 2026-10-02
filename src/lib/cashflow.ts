/**
 * Cash-flow projection from recurring templates. Everything here is a
 * PROJECTION — derived from templates, never stored as transactions — and the
 * UI labels it as such.
 */
import { addDaysISO, type ISODate } from './dates';
import type { Minor } from './money';
import { pendingOccurrences } from './recurrence';
import type { RecurringItem, RecurringKind, TxnType, UUID } from '@/types/domain';

export interface ProjectedItem {
  key: string;
  recurringId: UUID;
  name: string;
  type: Exclude<TxnType, 'adjustment'>;
  kind: RecurringKind;
  amount: Minor;
  date: ISODate;
  accountId: UUID;
  toAccountId: UUID | null;
  categoryId: UUID | null;
  /** Due before today and not yet posted or skipped. */
  overdue: boolean;
  /** Only the first pending occurrence of a template can be posted/skipped. */
  actionable: boolean;
}

export function upcomingItems(
  recurring: readonly RecurringItem[],
  today: ISODate,
  until: ISODate,
): ProjectedItem[] {
  const out: ProjectedItem[] = [];
  for (const r of recurring) {
    if (!r.isActive) continue;
    const dates = pendingOccurrences(
      {
        startDate: r.startDate,
        endDate: r.endDate,
        frequency: r.frequency,
        intervalCount: r.intervalCount,
        lastOccurrenceDate: r.lastOccurrenceDate,
      },
      until,
      120,
    );
    dates.forEach((date, i) => {
      out.push({
        key: `${r.id}:${date}`,
        recurringId: r.id,
        name: r.name,
        type: r.type,
        kind: r.kind,
        amount: r.amount,
        date,
        accountId: r.accountId,
        toAccountId: r.toAccountId,
        categoryId: r.categoryId,
        overdue: date < today,
        actionable: i === 0,
      });
    });
  }
  return out.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1));
}

/** Effect of a projected item on the combined balance of `liquid` accounts. */
export function liquidDelta(
  item: Pick<ProjectedItem, 'type' | 'amount' | 'accountId' | 'toAccountId'>,
  liquid: ReadonlySet<UUID>,
): number {
  const fromLiquid = liquid.has(item.accountId);
  switch (item.type) {
    case 'expense':
      return fromLiquid ? -item.amount : 0;
    case 'income':
      return fromLiquid ? item.amount : 0;
    case 'transfer': {
      const toLiquid = item.toAccountId ? liquid.has(item.toAccountId) : false;
      if (fromLiquid && !toLiquid) return -item.amount;
      if (!fromLiquid && toLiquid) return item.amount;
      return 0;
    }
  }
}

export interface ProjectionPoint {
  date: ISODate;
  inflow: Minor;
  outflow: Minor;
  balance: Minor;
}

export interface Projection {
  points: ProjectionPoint[];
  totalInflow: Minor;
  totalOutflow: Minor;
  endBalance: Minor;
  lowestBalance: Minor;
  lowestDate: ISODate;
}

/**
 * Day-by-day projected liquid balance from `from` to `to`. Overdue items are
 * applied on `from` (they are still expected to happen).
 */
export function projectBalance(
  startBalance: Minor,
  items: readonly ProjectedItem[],
  liquid: ReadonlySet<UUID>,
  from: ISODate,
  to: ISODate,
): Projection {
  const byDay = new Map<ISODate, { inflow: number; outflow: number }>();
  for (const item of items) {
    const day = item.date < from ? from : item.date;
    if (day > to) continue;
    const delta = liquidDelta(item, liquid);
    if (delta === 0) continue;
    const slot = byDay.get(day) ?? { inflow: 0, outflow: 0 };
    if (delta > 0) slot.inflow += delta;
    else slot.outflow += -delta;
    byDay.set(day, slot);
  }

  const points: ProjectionPoint[] = [];
  let balance: number = startBalance;
  let totalIn = 0;
  let totalOut = 0;
  let lowest = startBalance as number;
  let lowestDate = from;
  for (let d = from; d <= to; d = addDaysISO(d, 1)) {
    const slot = byDay.get(d) ?? { inflow: 0, outflow: 0 };
    balance += slot.inflow - slot.outflow;
    totalIn += slot.inflow;
    totalOut += slot.outflow;
    if (balance < lowest) {
      lowest = balance;
      lowestDate = d;
    }
    points.push({
      date: d,
      inflow: slot.inflow as Minor,
      outflow: slot.outflow as Minor,
      balance: balance as Minor,
    });
    if (points.length > 800) break;
  }
  return {
    points,
    totalInflow: totalIn as Minor,
    totalOutflow: totalOut as Minor,
    endBalance: balance as Minor,
    lowestBalance: lowest as Minor,
    lowestDate,
  };
}

/**
 * "Available" money: liquid balance minus credit-card dues minus committed
 * outflows (recurring bills/transfers out of liquid accounts) due by `until`,
 * plus nothing for expected income (income is not counted until it arrives).
 */
export function availableBalance(
  liquidTotal: Minor,
  cardDues: Minor,
  items: readonly ProjectedItem[],
  liquid: ReadonlySet<UUID>,
  creditCards: ReadonlySet<UUID>,
  until: ISODate,
): Minor {
  let committed = 0;
  for (const i of items) {
    if (i.date > until) continue;
    const delta = liquidDelta(i, liquid);
    // Scheduled card payments are already represented by cardDues.
    const paysCard = i.type === 'transfer' && i.toAccountId !== null && creditCards.has(i.toAccountId);
    if (delta < 0 && !paysCard) committed += -delta;
  }
  return (liquidTotal - cardDues - committed) as Minor;
}
