/**
 * Lent & borrowed — money between you and anyone. Every write is a database
 * function (create_iou, record_iou_repayment, delete_iou, delete_iou_repayment)
 * that books the matching ledger movement on the "Lent & borrowed" system
 * account: a loan from before BUD never touches a bank balance, one made now
 * moves the money, and none of it is ever spending or income.
 */
import { toDecimalString, toMinor, type Minor } from '@/lib/money';
import { supabase, unwrap } from '@/lib/supabase';
import type { Iou } from '@/types/domain';

type Row = Record<string, unknown>;

export async function fetchIous(): Promise<Iou[]> {
  const [ious, reps] = await Promise.all([
    supabase.from('ious').select('*').order('occurred_on', { ascending: false }),
    supabase.from('iou_repayments').select('*').order('occurred_on', { ascending: true }),
  ]);
  const repayments = unwrap(reps) as Row[];
  return (unwrap(ious) as Row[]).map((r) => {
    const mine = repayments
      .filter((p) => p.iou_id === r.id)
      .map((p) => ({
        id: String(p.id),
        amount: toMinor(p.amount as string),
        occurredOn: String(p.occurred_on),
        accountId: (p.account_id as string | null) ?? null,
        note: (p.note as string | null) ?? null,
      }));
    const amount = toMinor(r.amount as string);
    const repaid = mine.reduce((s, p) => s + p.amount, 0) as Minor;
    return {
      id: String(r.id),
      direction: r.direction as Iou['direction'],
      person: String(r.person),
      amount,
      currency: String(r.currency ?? 'INR'),
      occurredOn: String(r.occurred_on),
      dueOn: (r.due_on as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      accountId: (r.account_id as string | null) ?? null,
      closedAt: (r.closed_at as string | null) ?? null,
      repaid,
      outstanding: Math.max(amount - repaid, 0) as Minor,
      repayments: mine,
    };
  });
}

export async function createIou(input: {
  direction: Iou['direction'];
  person: string;
  amount: Minor;
  occurredOn: string;
  dueOn?: string | null;
  note?: string | null;
  /** null = it happened before BUD: balances are not touched. */
  accountId: string | null;
}): Promise<string> {
  return String(
    unwrap(
      await supabase.rpc('create_iou', {
        p: {
          direction: input.direction,
          person: input.person.trim(),
          amount: toDecimalString(input.amount),
          occurred_on: input.occurredOn,
          due_on: input.dueOn ?? null,
          note: input.note ?? null,
          account_id: input.accountId,
        },
      }),
    ),
  );
}

export async function recordRepayment(input: {
  iouId: string;
  amount: Minor;
  occurredOn: string;
  accountId: string | null;
  note?: string | null;
}): Promise<void> {
  unwrap(
    await supabase.rpc('record_iou_repayment', {
      p_iou: input.iouId,
      p_amount: toDecimalString(input.amount),
      p_on: input.occurredOn,
      p_account_id: input.accountId,
      p_note: input.note ?? null,
    }),
  );
}

export const deleteIou = async (id: string) => void unwrap(await supabase.rpc('delete_iou', { p_id: id }));
export const deleteRepayment = async (id: string) =>
  void unwrap(await supabase.rpc('delete_iou_repayment', { p_id: id }));
