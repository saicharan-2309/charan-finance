/**
 * BUD AI — talks to the `bud-ai` Edge Function and performs the changes it
 * proposes, once the user confirms, through the app's existing functions:
 *
 *   new expense / income   → saveTransaction (save_transaction), as the Add screen does
 *   recategorise           → reviewTransaction (review_transaction)
 *   merchant / note change → saveTransaction in update mode, with the row's version check
 *   split with a friend    → createSharedExpense (create_shared_expense), equal split
 *
 * Nothing here writes on the model's say-so alone: every action arrives as a
 * proposal the user has tapped Confirm on, and the database validates it again.
 */
import { randomUUID } from 'expo-crypto';

import type { ProposedAction } from '@/lib/bud-ai';
import { todayISO } from '@/lib/dates';
import { toMinor, type Minor } from '@/lib/money';
import { splitBill } from '@/lib/splits';
import { supabase } from '@/lib/supabase';
import { reviewTransaction } from './bank-sync';
import { createSharedExpense } from './friends';
import { fetchTransaction, saveTransaction } from './transactions';

export type { ProposedAction } from '@/lib/bud-ai';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantReply {
  reply: string;
  actions: ProposedAction[];
  sources: string[];
}

export type AssistantOutcome =
  | { status: 'ok'; data: AssistantReply }
  | { status: 'not_configured'; message: string }
  | { status: 'failed'; message: string };

export async function askBudAi(history: ChatTurn[]): Promise<AssistantOutcome> {
  const { data, error } = await supabase.functions.invoke<AssistantReply & { error?: string; code?: string }>(
    'bud-ai',
    { body: { messages: history.slice(-20) } },
  );
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let body: { error?: string; code?: string } = {};
    try {
      body = ctx && typeof ctx.json === 'function' ? await ctx.json() : {};
    } catch {
      body = {};
    }
    if (ctx?.status === 503 && body.code === 'not_configured') {
      return { status: 'not_configured', message: body.error ?? 'BUD AI isn’t set up on the server yet.' };
    }
    if (ctx?.status === 404) {
      return { status: 'not_configured', message: 'The bud-ai function isn’t deployed yet.' };
    }
    return {
      status: 'failed',
      message: body.error ?? 'BUD AI couldn’t answer just now. Check your connection and try again.',
    };
  }
  if (!data) return { status: 'failed', message: 'BUD AI sent an empty answer. Try again.' };
  return {
    status: 'ok',
    data: { reply: data.reply ?? '', actions: data.actions ?? [], sources: data.sources ?? [] },
  };
}

/** The moment to record: now for today, otherwise midday on that day (local time). */
function occurredAtFor(day: string): string {
  if (day === todayISO()) return new Date().toISOString();
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12, 0, 0).toISOString();
}

/** Performs a confirmed proposal. Returns a one-line result for the chat. */
export async function performAction(action: ProposedAction, me: string): Promise<string> {
  switch (action.kind) {
    case 'create_transaction': {
      await saveTransaction({
        mode: 'create',
        id: randomUUID(),
        type: action.type,
        amount: toMinor(action.amount),
        accountId: action.accountId,
        occurredAt: occurredAtFor(action.occurredOn),
        toAccountId: null,
        categoryId: action.categoryId,
        subcategoryId: null,
        merchantId: null,
        merchantName: action.merchantName,
        notes: action.notes,
        tags: null,
        expectedUpdatedAt: null,
      });
      return `Saved: ${action.summary}`;
    }
    case 'update_transaction': {
      const t = await fetchTransaction(action.transactionId);
      if (!t) throw new Error('That transaction no longer exists.');
      const onlyCategory =
        action.categoryId && action.merchantName === undefined && action.notes === undefined;
      if (onlyCategory) {
        await reviewTransaction({ id: t.id, categoryId: action.categoryId!, subcategoryId: null });
        return `Updated: ${action.summary}`;
      }
      if (t.type !== 'expense' && t.type !== 'income' && t.type !== 'transfer') {
        throw new Error('Adjustments can’t be edited here.');
      }
      await saveTransaction({
        mode: 'update',
        id: t.id,
        type: t.type,
        amount: t.amount,
        accountId: t.accountId,
        occurredAt: t.occurredAt,
        toAccountId: t.toAccountId,
        categoryId: action.categoryId ?? t.categoryId,
        subcategoryId: action.categoryId ? null : t.subcategoryId,
        merchantId: action.merchantName === undefined ? t.merchantId : null,
        merchantName: action.merchantName ?? t.merchantName,
        notes: action.notes ?? t.notes,
        tags: null,
        expectedUpdatedAt: t.updatedAt,
      });
      return `Updated: ${action.summary}`;
    }
    case 'split_with_friend': {
      const total = toMinor(action.total) as Minor;
      const split = splitBill(total, 'equal', [{ userId: me }, { userId: action.friendId }]);
      if (!split.ok) throw new Error(split.error);
      await createSharedExpense({
        groupId: null,
        paidBy: me,
        title: action.title,
        categoryName: action.categoryName,
        total,
        occurredOn: action.occurredOn,
        splitMethod: 'equal',
        shares: split.shares,
        payerAccountId: action.accountId,
      });
      return `Split saved: ${action.summary}`;
    }
  }
}
