/**
 * Recurring templates, budgets, savings goals, and net worth snapshots.
 */
import type { BudgetPeriod } from '@/lib/budget';
import type { ISODate } from '@/lib/dates';
import { toDecimalString, type Minor } from '@/lib/money';
import type { Frequency } from '@/lib/recurrence';
import { supabase, unwrap } from '@/lib/supabase';
import type {
  Budget,
  BudgetStatusRow,
  Goal,
  GoalContribution,
  NetWorthSnapshot,
  RecurringItem,
  RecurringKind,
  TxnType,
} from '@/types/domain';
import {
  mapBudget,
  mapBudgetStatus,
  mapContribution,
  mapGoal,
  mapRecurring,
  mapSnapshot,
  type Row,
} from './mappers';

// ---------------------------------------------------------------------------
// Recurring
// ---------------------------------------------------------------------------
export async function fetchRecurring(): Promise<RecurringItem[]> {
  // next_due_date is a PostgREST computed field backed by public.next_due_date(row).
  const rows = unwrap(
    await supabase.from('recurring_transactions').select('*, next_due_date').order('name'),
  ) as Row[];
  return rows.map(mapRecurring);
}

export interface RecurringInput {
  name: string;
  type: Exclude<TxnType, 'adjustment'>;
  kind: RecurringKind;
  amount: Minor;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  merchantId: string | null;
  notes: string | null;
  frequency: Frequency;
  intervalCount: number;
  startDate: ISODate;
  endDate: ISODate | null;
  autoPost: boolean;
  remindDaysBefore: number;
  isActive: boolean;
}

function recurringBody(i: RecurringInput): Row {
  const isTransfer = i.type === 'transfer';
  return {
    name: i.name.trim(),
    type: i.type,
    kind: i.kind,
    amount: toDecimalString(i.amount),
    account_id: i.accountId,
    to_account_id: isTransfer ? i.toAccountId : null,
    category_id: isTransfer ? null : i.categoryId,
    subcategory_id: isTransfer ? null : i.subcategoryId,
    merchant_id: isTransfer ? null : i.merchantId,
    notes: i.notes?.trim() || null,
    frequency: i.frequency,
    interval_count: i.intervalCount,
    start_date: i.startDate,
    end_date: i.endDate,
    auto_post: i.autoPost,
    remind_days_before: i.remindDaysBefore,
    is_active: i.isActive,
  };
}

export async function createRecurring(input: RecurringInput): Promise<void> {
  unwrap(await supabase.from('recurring_transactions').insert(recurringBody(input)).select('id'));
}

export async function updateRecurring(id: string, input: RecurringInput): Promise<void> {
  unwrap(
    await supabase.from('recurring_transactions').update(recurringBody(input)).eq('id', id).select('id'),
  );
}

export async function setRecurringActive(id: string, isActive: boolean): Promise<void> {
  unwrap(
    await supabase.from('recurring_transactions').update({ is_active: isActive }).eq('id', id).select('id'),
  );
}

export async function deleteRecurring(id: string): Promise<void> {
  unwrap(await supabase.from('recurring_transactions').delete().eq('id', id).select('id'));
}

export async function postRecurringOccurrence(
  id: string,
  occurrence: ISODate,
  amount?: Minor,
  transactionId?: string,
): Promise<void> {
  unwrap(
    await supabase.rpc('post_recurring_occurrence', {
      p_recurring_id: id,
      p_occurrence: occurrence,
      p_amount: amount === undefined ? null : toDecimalString(amount),
      p_transaction_id: transactionId ?? null,
    }),
  );
}

export async function skipRecurringOccurrence(id: string, occurrence: ISODate): Promise<void> {
  unwrap(await supabase.rpc('skip_recurring_occurrence', { p_recurring_id: id, p_occurrence: occurrence }));
}

export async function postDueRecurring(): Promise<number> {
  return (unwrap(await supabase.rpc('post_due_recurring')) as number) ?? 0;
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------
export async function fetchBudgets(): Promise<Budget[]> {
  const rows = unwrap(
    await supabase.from('budgets').select('*, budget_items(*)').order('created_at'),
  ) as Row[];
  return rows.map(mapBudget);
}

export async function fetchBudgetStatus(refDate: ISODate, budgetId?: string): Promise<BudgetStatusRow[]> {
  const rows = unwrap(
    await supabase.rpc('get_budget_status', { p_budget_id: budgetId ?? null, p_ref_date: refDate }),
  ) as Row[];
  return rows.map(mapBudgetStatus);
}

export interface BudgetInput {
  name: string;
  period: BudgetPeriod;
  startDate: ISODate;
  endDate: ISODate | null;
  currency: string;
  isActive: boolean;
  items: { categoryId: string | null; amount: Minor }[];
}

/**
 * Creates or updates a budget and replaces its items. Items are diffed so that
 * unchanged rows keep their ids.
 */
export async function saveBudget(id: string | null, input: BudgetInput): Promise<string> {
  const body = {
    name: input.name.trim(),
    period: input.period,
    start_date: input.startDate,
    end_date: input.period === 'custom' ? input.endDate : null,
    currency: input.currency,
    is_active: input.isActive,
  };
  let budgetId = id;
  if (budgetId) {
    unwrap(await supabase.from('budgets').update(body).eq('id', budgetId).select('id'));
  } else {
    const row = unwrap(await supabase.from('budgets').insert(body).select('id').single()) as Row;
    budgetId = row.id as string;
  }

  const existing = unwrap(
    await supabase.from('budget_items').select('id, category_id').eq('budget_id', budgetId),
  ) as Row[];
  const wanted = new Map(input.items.map((i) => [i.categoryId ?? 'overall', i]));
  const toDelete = existing.filter((e) => !wanted.has(e.category_id ?? 'overall')).map((e) => e.id);
  if (toDelete.length) unwrap(await supabase.from('budget_items').delete().in('id', toDelete).select('id'));

  const byKey = new Map(existing.map((e) => [e.category_id ?? 'overall', e.id as string]));
  for (const item of input.items) {
    const existingId = byKey.get(item.categoryId ?? 'overall');
    if (existingId) {
      unwrap(
        await supabase
          .from('budget_items')
          .update({ amount: toDecimalString(item.amount) })
          .eq('id', existingId)
          .select('id'),
      );
    } else {
      unwrap(
        await supabase
          .from('budget_items')
          .insert({ budget_id: budgetId, category_id: item.categoryId, amount: toDecimalString(item.amount) })
          .select('id'),
      );
    }
  }
  return budgetId;
}

export async function deleteBudget(id: string): Promise<void> {
  unwrap(await supabase.from('budgets').delete().eq('id', id).select('id'));
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------
export async function fetchGoals(): Promise<Goal[]> {
  const rows = unwrap(await supabase.from('savings_goals').select('*').order('created_at')) as Row[];
  return rows.map(mapGoal);
}

export interface GoalInput {
  name: string;
  description: string | null;
  targetAmount: Minor;
  initialAmount: Minor;
  currency: string;
  targetDate: ISODate | null;
  accountId: string | null;
  icon: string | null;
  color: string | null;
}

function goalBody(i: GoalInput): Row {
  return {
    name: i.name.trim(),
    description: i.description?.trim() || null,
    target_amount: toDecimalString(i.targetAmount),
    initial_amount: toDecimalString(i.initialAmount),
    currency: i.currency,
    target_date: i.targetDate,
    account_id: i.accountId,
    icon: i.icon,
    color: i.color,
  };
}

export async function createGoal(input: GoalInput): Promise<void> {
  unwrap(await supabase.from('savings_goals').insert(goalBody(input)).select('id'));
}

export async function updateGoal(id: string, input: GoalInput): Promise<void> {
  unwrap(await supabase.from('savings_goals').update(goalBody(input)).eq('id', id).select('id'));
}

export async function setGoalArchived(id: string, archived: boolean): Promise<void> {
  unwrap(await supabase.from('savings_goals').update({ is_archived: archived }).eq('id', id).select('id'));
}

export async function deleteGoal(id: string): Promise<void> {
  unwrap(await supabase.from('savings_goals').delete().eq('id', id).select('id'));
}

export async function fetchContributions(goalId?: string): Promise<GoalContribution[]> {
  let q = supabase
    .from('goal_contributions')
    .select('*')
    .order('contributed_on', { ascending: false })
    .limit(500);
  if (goalId) q = q.eq('goal_id', goalId);
  return (unwrap(await q) as Row[]).map(mapContribution);
}

export async function addContribution(
  goalId: string,
  amount: Minor,
  date: ISODate,
  note: string | null,
): Promise<void> {
  unwrap(
    await supabase
      .from('goal_contributions')
      .insert({
        goal_id: goalId,
        amount: toDecimalString(amount),
        contributed_on: date,
        note: note?.trim() || null,
      })
      .select('id'),
  );
}

export async function deleteContribution(id: string): Promise<void> {
  unwrap(await supabase.from('goal_contributions').delete().eq('id', id).select('id'));
}

// ---------------------------------------------------------------------------
// Net worth
// ---------------------------------------------------------------------------
export async function fetchNetWorthSnapshots(): Promise<NetWorthSnapshot[]> {
  const rows = unwrap(
    await supabase
      .from('net_worth_snapshots')
      .select('*')
      .order('snapshot_date', { ascending: true })
      .limit(1000),
  ) as Row[];
  return rows.map(mapSnapshot);
}

export async function captureNetWorthSnapshot(): Promise<NetWorthSnapshot> {
  const row = unwrap(await supabase.rpc('capture_net_worth_snapshot')) as Row;
  return mapSnapshot(row);
}
