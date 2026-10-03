/**
 * Loans and EMIs.
 *
 * A loan holds the agreement; a recurring transaction posts the instalments.
 * Creating an EMI therefore writes two rows, and the loan is only considered
 * created once both exist — if the second write fails the first is rolled back
 * by hand so no half-made EMI is left behind.
 *
 * The payment method is whatever account the instalment charges. Nothing here
 * assumes a credit card.
 */
import type { ISODate } from '@/lib/dates';
import { toDecimalString, type Minor } from '@/lib/money';
import { supabase, unwrap } from '@/lib/supabase';
import type { CardCycle, Loan } from '@/types/domain';
import { mapCardCycle, mapLoan, type Row } from './mappers';

export async function fetchLoans(): Promise<Loan[]> {
  const rows = unwrap(
    await supabase
      .from('loan_status')
      .select('*')
      .order('is_closed')
      .order('start_date', { ascending: false }),
  ) as Row[];
  return rows.map(mapLoan);
}

export interface LoanInput {
  name: string;
  lender: string | null;
  principalAmount: Minor;
  emiAmount: Minor;
  interestRate: number | null;
  tenureMonths: number | null;
  currency: string;
  startDate: ISODate;
  /** The payment method the instalment is charged to. */
  accountId: string;
  categoryId: string | null;
  notes: string | null;
  color: string | null;
  icon: string | null;
  /** Day the next instalment is due; drives the recurring schedule. */
  nextPaymentDate: ISODate;
  autoPost: boolean;
  remindDaysBefore: number;
  isActive: boolean;
}

function scheduleBody(i: LoanInput): Row {
  // The schedule ends when the tenure does, so the EMI stops on its own.
  const end = i.tenureMonths && i.tenureMonths > 0 ? addMonths(i.nextPaymentDate, i.tenureMonths - 1) : null;
  return {
    name: i.name.trim(),
    type: 'expense',
    kind: 'bill',
    amount: toDecimalString(i.emiAmount),
    currency: i.currency,
    account_id: i.accountId,
    category_id: i.categoryId,
    notes: i.notes?.trim() || null,
    frequency: 'monthly',
    interval_count: 1,
    start_date: i.nextPaymentDate,
    end_date: end,
    auto_post: i.autoPost,
    remind_days_before: i.remindDaysBefore,
    is_active: i.isActive,
  };
}

function loanBody(i: LoanInput): Row {
  return {
    name: i.name.trim(),
    lender: i.lender?.trim() || null,
    principal_amount: toDecimalString(i.principalAmount),
    emi_amount: toDecimalString(i.emiAmount),
    interest_rate: i.interestRate,
    tenure_months: i.tenureMonths,
    currency: i.currency,
    start_date: i.startDate,
    account_id: i.accountId,
    category_id: i.categoryId,
    notes: i.notes?.trim() || null,
    color: i.color,
    icon: i.icon,
  };
}

export async function createLoan(input: LoanInput): Promise<string> {
  const schedule = unwrap(
    await supabase.from('recurring_transactions').insert(scheduleBody(input)).select('id').single(),
  ) as Row;
  try {
    const loan = unwrap(
      await supabase
        .from('loans')
        .insert({ ...loanBody(input), recurring_id: schedule.id })
        .select('id')
        .single(),
    ) as Row;
    return loan.id as string;
  } catch (err) {
    // Leave nothing dangling: the schedule has posted nothing yet, so removing
    // it cannot destroy history.
    await supabase.from('recurring_transactions').delete().eq('id', schedule.id);
    throw err;
  }
}

export async function updateLoan(loan: Loan, input: LoanInput): Promise<void> {
  unwrap(await supabase.from('loans').update(loanBody(input)).eq('id', loan.id).select('id'));
  if (loan.recurringId) {
    // Keep the already-posted instalments: only the forward-looking schedule
    // changes, and last_occurrence_date is left untouched.
    unwrap(
      await supabase
        .from('recurring_transactions')
        .update(scheduleBody(input))
        .eq('id', loan.recurringId)
        .select('id'),
    );
  } else {
    const schedule = unwrap(
      await supabase.from('recurring_transactions').insert(scheduleBody(input)).select('id').single(),
    ) as Row;
    unwrap(await supabase.from('loans').update({ recurring_id: schedule.id }).eq('id', loan.id).select('id'));
  }
}

/** Closing a loan stops future instalments but keeps every recorded payment. */
export async function setLoanClosed(loan: Loan, closed: boolean): Promise<void> {
  unwrap(await supabase.from('loans').update({ is_closed: closed }).eq('id', loan.id).select('id'));
  if (loan.recurringId) {
    unwrap(
      await supabase
        .from('recurring_transactions')
        .update({ is_active: !closed })
        .eq('id', loan.recurringId)
        .select('id'),
    );
  }
}

/** Deletes the agreement and its schedule. Instalments already recorded stay. */
export async function deleteLoan(loan: Loan): Promise<void> {
  unwrap(await supabase.from('loans').delete().eq('id', loan.id).select('id'));
  if (loan.recurringId) {
    unwrap(await supabase.from('recurring_transactions').delete().eq('id', loan.recurringId).select('id'));
  }
}

export async function fetchCardCycle(accountId: string): Promise<CardCycle | null> {
  const rows = unwrap(await supabase.rpc('credit_card_cycle', { p_account_id: accountId })) as Row[] | null;
  const row = Array.isArray(rows) ? rows[0] : rows;
  return row ? mapCardCycle(row) : null;
}

/** Month arithmetic that clamps to month length (31 Jan + 1 month = 28 Feb). */
function addMonths(date: ISODate, months: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const day = Math.min(d, last);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
