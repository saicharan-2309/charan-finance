/**
 * BUD AI — runs entirely inside the app. No AI service, no API key: the
 * engine (lib/assistant) understands the question and answers it from the
 * user's own data, read through the app's existing functions under the
 * user's own login (so row-level security applies). Nothing leaves the
 * user's phone and their BUD database.
 *
 * Changes are proposals; once the user taps Confirm they're performed by the
 * same functions the rest of the app uses:
 *   new expense / income → saveTransaction (save_transaction)
 *   recategorise         → reviewTransaction (review_transaction)
 *   split with a friend  → createSharedExpense (create_shared_expense), equal split
 */
import { randomUUID } from 'expo-crypto';

import {
  respond,
  type AssistantData,
  type Conversation,
  type ProposedAction,
  type Reply,
  type TxnHit,
} from '@/lib/assistant/engine';
import { todayISO, toISODate } from '@/lib/dates';
import { toMinor, type Minor } from '@/lib/money';
import { splitBill } from '@/lib/splits';
import { supabase, unwrap } from '@/lib/supabase';
import { reviewTransaction } from './bank-sync';
import { fetchAccounts, fetchCategories } from './core';
import { createSharedExpense, fetchMyGroupPositions } from './friends';
import {
  fetchAccountBreakdown,
  fetchCategoryBreakdown,
  fetchMerchantBreakdown,
  fetchSummary,
} from './reports';
import { fetchIous } from './lending';
import { saveTransaction } from './transactions';

export type { Choice, Conversation, ProposedAction, Reply } from '@/lib/assistant/engine';
export { EMPTY_CONVERSATION, SUGGESTIONS } from '@/lib/assistant/engine';

type Row = Record<string, unknown>;

/** The engine's view of the user's data, through the app's existing functions. */
export function liveData(opts: { cycleStartDay: number; currency: string }): AssistantData {
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key) as Promise<T>;
  };
  return {
    today: todayISO(),
    cycleStartDay: opts.cycleStartDay,
    currency: opts.currency,
    summary: (r) => fetchSummary(r.start, r.end),
    totals: async (f) => {
      const rows = unwrap(
        await supabase.rpc('ai_totals', {
          p_start: f.from ? null : f.range.start,
          p_end: f.from ? null : f.range.end,
          p_from: f.from ?? null,
          p_to: f.to ?? null,
          p_account_ids: f.accountIds ?? null,
          p_category_id: f.categoryId ?? null,
        }),
      ) as Row[];
      const r = rows[0] ?? {};
      return {
        income: toMinor(r.income as string),
        expense: toMinor(r.expense as string),
        count: Number(r.tx_count ?? 0),
        expenseCount: Number(r.expense_count ?? 0),
      };
    },
    byCategory: (r, kind) => fetchCategoryBreakdown(r.start, r.end, { kind }),
    byMerchant: (r) => fetchMerchantBreakdown(r.start, r.end, 200),
    byAccount: (r) => fetchAccountBreakdown(r.start, r.end),
    search: async (f) => {
      const rows = unwrap(
        await supabase.rpc('ai_search_transactions', {
          p_start: f.range?.start ?? null,
          p_end: f.range?.end ?? null,
          p_text: f.text ?? null,
          p_type: f.type ?? null,
          p_category_id: f.categoryId ?? null,
          p_account_id: f.accountId ?? null,
          p_limit: f.limit ?? 20,
          p_id: f.id ?? null,
        }),
      ) as Row[];
      return rows.map((r): TxnHit => ({
        id: String(r.id),
        occurredAt: String(r.occurred_at),
        day: toISODate(new Date(String(r.occurred_at))),
        type: r.type as TxnHit['type'],
        amount: toMinor(r.amount as string),
        merchant: (r.merchant_name as string | null) ?? null,
        categoryId: (r.category_id as string | null) ?? null,
        category: (r.category_name as string | null) ?? null,
        account: (r.account_name as string | null) ?? null,
        sharedExpenseId: (r.shared_expense_id as string | null) ?? null,
      }));
    },
    accounts: () => once('accounts', fetchAccounts),
    categories: () => once('categories', fetchCategories),
    friends: () =>
      once('friends', async () =>
        (unwrap(await supabase.rpc('ai_friends')) as Row[]).map((f) => ({
          userId: String(f.user_id),
          name: String(f.name),
          username: (f.username as string | null) ?? null,
          net: toMinor(f.net as string),
        })),
      ),
    groups: async () => (await fetchMyGroupPositions()).map((g) => ({ name: g.name, net: g.net })),
    ious: async () =>
      (await fetchIous())
        .filter((i) => i.outstanding > 0)
        .map((i) => ({
          person: i.person,
          net: (i.direction === 'lent' ? i.outstanding : -i.outstanding) as Minor,
        })),
  };
}

export async function askBudAi(
  text: string,
  convo: Conversation,
  opts: { cycleStartDay: number; currency: string },
): Promise<{ reply: Reply; convo: Conversation }> {
  return respond(text, convo, liveData(opts));
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
    case 'create_transaction':
      await saveTransaction({
        mode: 'create',
        id: randomUUID(),
        type: action.type,
        amount: action.amount,
        accountId: action.accountId,
        occurredAt: occurredAtFor(action.occurredOn),
        toAccountId: null,
        categoryId: action.categoryId,
        subcategoryId: null,
        merchantId: null,
        merchantName: action.merchantName,
        notes: null,
        tags: null,
        expectedUpdatedAt: null,
      });
      return `Saved: ${action.summary}`;
    case 'update_transaction':
      await reviewTransaction({
        id: action.transactionId,
        categoryId: action.categoryId,
        subcategoryId: null,
      });
      return `Updated: ${action.summary}`;
    case 'split_with_friend': {
      const total = action.total as Minor;
      const split = splitBill(total, 'equal', [{ userId: me }, { userId: action.friendId }]);
      if (!split.ok) throw new Error(split.error);
      await createSharedExpense({
        groupId: null,
        paidBy: me,
        title: action.title,
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
