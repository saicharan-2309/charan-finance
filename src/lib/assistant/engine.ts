/**
 * BUD AI's engine. It understands the question (language.ts), reads the
 * answer from the user's own data through `AssistantData` (the app's existing
 * report and ledger functions, under the user's login), and writes the reply
 * from those figures. Every number in a reply comes from a lookup; nothing is
 * estimated. Changes come back as proposals the user confirms in the app.
 *
 * When something is missing — which category, which account, which friend,
 * which transaction — it asks, with the user's own options as taps, and
 * carries on from the answer (`Conversation.pending`).
 */
import { formatMoney, type Minor } from '@/lib/money';
import type {
  Account,
  AccountTotal,
  Category,
  CategoryTotal,
  MerchantTotal,
  PeriodSummary,
} from '@/types/domain';

import {
  addDays,
  classify,
  dayLabel,
  daysIn,
  findAccount,
  findAccounts,
  findCategory,
  findFriend,
  findMerchant,
  mentionsTime,
  moneyMonth,
  parseAmount,
  parsePeriod,
  rangeLabel,
  thisMonth,
  type ISODate,
  type Period,
  type Range,
} from './language';

// ---------------------------------------------------------------------------
// Data the engine may read — implemented by services/assistant.ts
// ---------------------------------------------------------------------------

export interface TxnHit {
  id: string;
  occurredAt: string;
  /** The day in the user's time zone. */
  day: ISODate;
  type: 'expense' | 'income' | 'transfer' | 'adjustment';
  amount: Minor;
  merchant: string | null;
  categoryId: string | null;
  category: string | null;
  account: string | null;
  sharedExpenseId: string | null;
}

export interface FriendHit {
  userId: string;
  name: string;
  username: string | null;
  /** Positive: the friend owes the user. */
  net: Minor;
}

export interface AssistantData {
  today: ISODate;
  cycleStartDay: number;
  currency: string;
  summary(r: Range): Promise<PeriodSummary>;
  /**
   * Income and spending for a day range or exact instants (from/to), optionally
   * only some accounts or one category — the same rules as summary().
   */
  totals(f: {
    range: Range;
    from?: string;
    to?: string;
    accountIds?: string[];
    categoryId?: string;
  }): Promise<{ income: Minor; expense: Minor; count: number; expenseCount: number }>;
  byCategory(r: Range, kind: 'expense' | 'income'): Promise<CategoryTotal[]>;
  byMerchant(r: Range): Promise<MerchantTotal[]>;
  byAccount(r: Range): Promise<AccountTotal[]>;
  search(f: {
    range?: Range;
    text?: string;
    type?: 'expense' | 'income';
    categoryId?: string;
    accountId?: string;
    id?: string;
    limit?: number;
  }): Promise<TxnHit[]>;
  accounts(): Promise<Account[]>;
  categories(): Promise<Category[]>;
  friends(): Promise<FriendHit[]>;
  groups(): Promise<{ name: string; net: Minor }[]>;
  /** Lent & borrowed with anyone: positive = they owe you. Only what's still owed. */
  ious?(): Promise<{ person: string; net: Minor }[]>;
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

export type ProposedAction =
  | {
      kind: 'create_transaction';
      type: 'expense' | 'income';
      amount: Minor;
      accountId: string;
      accountName: string;
      categoryId: string;
      categoryName: string;
      merchantName: string | null;
      occurredOn: ISODate;
      summary: string;
    }
  | {
      kind: 'update_transaction';
      transactionId: string;
      categoryId: string;
      categoryName: string;
      summary: string;
    }
  | {
      kind: 'split_with_friend';
      friendId: string;
      friendName: string;
      total: Minor;
      title: string;
      occurredOn: ISODate;
      accountId: string;
      accountName: string;
      summary: string;
    };

/** A tap-to-answer option. `value` is sent back as the next message. */
export interface Choice {
  label: string;
  value: string;
}

export interface Reply {
  text: string;
  /** Figures listed under the sentence: label on the left, amount on the right. */
  lines: { label: string; value: string }[];
  actions: ProposedAction[];
  choices: Choice[];
  /** What was read to answer — shown as "From your data: …". */
  sources: string[];
}

type Slots = {
  type?: 'expense' | 'income';
  amount?: Minor | null;
  merchant?: string | null;
  categoryId?: string;
  accountId?: string;
  friendId?: string;
  title?: string;
  date?: ISODate;
  txnId?: string;
  /** For a recategorise: the text and period used to find the transaction. */
  findText?: string | null;
  findPeriod?: Period | null;
};

export interface Conversation {
  /** Transactions the last answer listed — "this", "it", "that one" refer to them. */
  lastTxns: TxnHit[];
  /** A request waiting for one more answer. */
  pending: { kind: 'create' | 'recategorise' | 'split'; slots: Slots; need: Need } | null;
}
type Need = 'category' | 'account' | 'friend' | 'transaction' | 'amount';

export const EMPTY_CONVERSATION: Conversation = { lastTxns: [], pending: null };

/** Prefix of a choice value that answers the pending question. */
const PICK = '§';

export const SUGGESTIONS = [
  'What did I spend this month?',
  'How much did I spend on food last month?',
  'Where did most of my money go this month?',
  'Did I spend more than last month?',
  'How much do my friends owe me?',
  'What are my balances?',
  'Record ₹500 spent at Starbucks',
];

const reply = (text: string, extra: Partial<Reply> = {}): Reply => ({
  text,
  lines: [],
  actions: [],
  choices: [],
  sources: [],
  ...extra,
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function respond(
  input: string,
  convo: Conversation,
  data: AssistantData,
): Promise<{ reply: Reply; convo: Conversation }> {
  const text = input.trim();
  const money = (v: number) => formatMoney(v, data.currency, { decimals: 'auto' });

  // An answer to the question we just asked.
  if (text.startsWith(PICK) && convo.pending) {
    const [need, value] = text.slice(1).split(':', 2) as [Need, string];
    const slots = { ...convo.pending.slots };
    if (need === 'category') slots.categoryId = value;
    if (need === 'account') slots.accountId = value;
    if (need === 'friend') slots.friendId = value;
    if (need === 'transaction') slots.txnId = value;
    return continueAction(convo.pending.kind, slots, convo, data);
  }

  const intent = classify(text);
  const period = parsePeriod(text, data.today, data.cycleStartDay);

  // A time was mentioned but not understood: ask, rather than quietly answer for this month.
  if (
    !period &&
    mentionsTime(text) &&
    (intent.kind === 'spend' ||
      intent.kind === 'income' ||
      intent.kind === 'breakdown' ||
      intent.kind === 'compare' ||
      intent.kind === 'list')
  ) {
    return {
      reply: reply(
        'I couldn’t tell which period you mean. Try “today”, “yesterday”, “last 3 hours”, “on 5 Oct”, “this week”, “last month” or “in September”.',
        {
          choices: ['today', 'this week', 'this month', 'last month'].map((p) => ({
            label: p.charAt(0).toUpperCase() + p.slice(1),
            value: `${text.replace(/[?.!]+$/, '')} ${p}`,
          })),
        },
      ),
      convo: { ...convo, pending: null },
    };
  }

  switch (intent.kind) {
    case 'create': {
      // A transaction happens on a day; "in December" doesn't say which.
      if (period && period.start !== period.end && !period.current) {
        return {
          reply: reply(
            `Which day was it? Say “today” or “yesterday” — or add it with the + button to pick any date ${periodText(period)}.`,
          ),
          convo: { ...convo, pending: null },
        };
      }
      const [categories, accounts] = await Promise.all([data.categories(), data.accounts()]);
      const kindCats = categories.filter((c) => c.kind === intent.type && !c.isArchived);
      const cat = findCategory(text, kindCats);
      const acct = findAccount(text, usable(accounts));
      const merchant = findMerchant(text, (p) => isKnownWord(p, kindCats, accounts));
      const slots: Slots = {
        type: intent.type,
        amount: parseAmount(text),
        merchant,
        categoryId: cat?.item.id,
        accountId: acct?.id,
        date: period && period.start === period.end ? period.start : data.today,
      };
      return continueAction('create', slots, { ...convo, pending: null }, data);
    }
    case 'recategorise': {
      const categories = (await data.categories()).filter((c) => !c.isArchived);
      // The category is what follows "to / as / under / into".
      const target =
        text.match(/\b(?:to|as|under|into|in)\s+([a-z][a-z &]*?)\s*(?:category)?[?.!]*$/i)?.[1] ?? '';
      const cat = findCategory(target, categories) ?? findCategory(text, categories);
      const refersToLast =
        /\b(?:this|that|it|the last one|that one)\b/i.test(text) && convo.lastTxns.length > 0;
      const withoutTarget = text.replace(/\b(?:to|as|under|into)\s+[a-z &]+[?.!]*$/i, '');
      const merchant =
        findMerchant(withoutTarget, (p) => !!findCategory(p, categories)) ??
        withoutTarget.match(
          /\bmy\s+([a-z0-9&'. -]+?)\s+(?:transaction|payment|expense|order|purchase)\b/i,
        )?.[1] ??
        null;
      if (!cat) {
        return {
          reply: reply('Which category should it be?', {
            choices: categories
              .filter((c) => !c.parentId && c.kind === 'expense')
              .slice(0, 10)
              .map((c) => ({ label: c.name, value: `${PICK}category:${c.id}` })),
          }),
          convo: {
            ...convo,
            pending: {
              kind: 'recategorise',
              need: 'category',
              slots: {
                findText: merchant,
                findPeriod: period,
                txnId: refersToLast && convo.lastTxns.length === 1 ? convo.lastTxns[0]!.id : undefined,
              },
            },
          },
        };
      }
      const slots: Slots = {
        categoryId: cat.item.id,
        findText: merchant,
        findPeriod: period,
        txnId: refersToLast && convo.lastTxns.length === 1 ? convo.lastTxns[0]!.id : undefined,
      };
      if (refersToLast && convo.lastTxns.length > 1 && !merchant) {
        return askTransaction(convo.lastTxns, slots, convo, money);
      }
      return continueAction('recategorise', slots, { ...convo, pending: null }, data);
    }
    case 'split': {
      const [accounts, friends] = await Promise.all([data.accounts(), data.friends()]);
      const friend = findFriend(text, friends);
      const acct = findAccount(text, usable(accounts));
      const title =
        text.match(
          /\bfor\s+([a-z][a-z0-9 &'-]{1,40}?)(?:\s+(?:with|from|using|on|yesterday|today)\b|[?.!]*$)/i,
        )?.[1] ??
        findMerchant(text, (p) => !!findFriend(p, friends)) ??
        null;
      const slots: Slots = {
        amount: parseAmount(text),
        friendId: friend?.userId,
        accountId: acct?.id,
        title: title ? title.replace(/\b\w/g, (c) => c.toUpperCase()) : undefined,
        date: period && period.start === period.end ? period.start : data.today,
      };
      return continueAction('split', slots, { ...convo, pending: null }, data);
    }
    case 'spend':
      return {
        reply: await answerSpend(text, period ?? thisMonth(data.today, data.cycleStartDay), data),
        convo: { ...convo, pending: null },
      };
    case 'income':
      return {
        reply: await answerIncome(text, period ?? thisMonth(data.today, data.cycleStartDay), data),
        convo: { ...convo, pending: null },
      };
    case 'breakdown':
      if (period?.from)
        return { reply: await answerSpend(text, period, data), convo: { ...convo, pending: null } };
      return {
        reply: await answerBreakdown(intent.by, period ?? thisMonth(data.today, data.cycleStartDay), data),
        convo: { ...convo, pending: null },
      };
    case 'compare':
      if (period?.from)
        return { reply: await answerSpend(text, period, data), convo: { ...convo, pending: null } };
      return {
        reply: await answerCompare(period ?? thisMonth(data.today, data.cycleStartDay), data),
        convo: { ...convo, pending: null },
      };
    case 'balances':
      return { reply: await answerBalances(intent.cards, data), convo: { ...convo, pending: null } };
    case 'friends':
      return { reply: await answerFriends(text, data), convo: { ...convo, pending: null } };
    case 'list': {
      const { reply: r, txns } = await answerList(text, period, data);
      return { reply: r, convo: { lastTxns: txns, pending: null } };
    }
    case 'help':
    case 'unknown':
      return {
        reply: reply(
          intent.kind === 'help'
            ? 'I answer from your own BUD data — spending, income, balances, cards, categories, merchants and friends — and I can record, recategorise or split something for you to confirm. Try one of these:'
            : 'I didn’t catch that. I understand questions about your spending, income, balances, categories, merchants and friends, and requests to record, recategorise or split. Try one of these:',
          { choices: SUGGESTIONS.map((s) => ({ label: s, value: s })) },
        ),
        convo: { ...convo, pending: null },
      };
  }
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/** "the last hour (since 4:12 pm)" has no date range to show; days and months do. */
const periodText = (p: Period) => (p.from ? p.label : `${p.label} (${rangeLabel(p)})`);

async function answerSpend(text: string, period: Period, data: AssistantData): Promise<Reply> {
  const money = (v: number) => formatMoney(v, data.currency, { decimals: 'auto' });
  const [categories, accounts] = await Promise.all([data.categories(), data.accounts()]);
  const expenseCats = categories.filter((c) => c.kind === 'expense');
  const exact = findCategory(text, expenseCats);
  const which = findAccounts(text, usable(accounts));
  const merchantPhrase = findMerchant(text, (p) => isKnownWord(p, expenseCats, accounts));
  const window = { range: period, from: period.from, to: period.to };
  const src = (what: string) => [`${what} · ${periodText(period)}`];

  // A category ("on food") — optionally on one card or account.
  if (exact?.exact) {
    const t = await data.totals({
      ...window,
      categoryId: exact.item.id,
      accountIds: which ? ('one' in which ? [which.one.id] : which.many.map((x) => x.id)) : undefined,
    });
    const on = which ? ` with ${'one' in which ? which.one.name : which.label}` : '';
    return reply(
      t.expense > 0
        ? `You spent ${money(t.expense)} on ${exact.item.name}${on} ${periodText(period)}, across ${count(t.expenseCount, 'payment')}.`
        : `You haven’t spent anything on ${exact.item.name}${on} ${periodText(period)}.`,
      { sources: src('Spending by category') },
    );
  }

  // A payment method, or all of one kind ("my credit cards").
  if (which) {
    const ids = 'one' in which ? [which.one.id] : which.many.map((x) => x.id);
    const name = 'one' in which ? which.one.name : which.label;
    const t = await data.totals({ ...window, accountIds: ids });
    return reply(
      t.expense > 0
        ? `You spent ${money(t.expense)} with ${name} ${periodText(period)}, across ${count(t.expenseCount, 'payment')}.`
        : `Nothing was spent with ${name} ${periodText(period)}.`,
      { sources: src('By payment method') },
    );
  }

  // A merchant ("at Amazon").
  if (merchantPhrase) {
    if (period.from) {
      const hits = (
        await data.search({ range: period, text: merchantPhrase, type: 'expense', limit: 50 })
      ).filter((t) => t.occurredAt >= period.from! && t.occurredAt <= period.to!);
      const total = hits.reduce((x, t) => x + t.amount, 0);
      return reply(
        hits.length
          ? `You spent ${money(total)} at ${merchantPhrase} ${periodText(period)}, across ${count(hits.length, 'payment')}.`
          : `I can’t find any spending at ${merchantPhrase} ${periodText(period)}.`,
        { sources: src('Transactions') },
      );
    }
    const merchants = await data.byMerchant(period);
    const m =
      merchants.find((x) => x.name.toLowerCase() === merchantPhrase.toLowerCase()) ??
      merchants.find((x) => x.name.toLowerCase().includes(merchantPhrase.toLowerCase()));
    if (m) {
      return reply(
        `You spent ${money(m.total)} at ${m.name} ${periodText(period)}, across ${count(m.count, 'payment')}${
          m.count > 1 ? ` (largest ${money(m.largest)})` : ''
        }.`,
        { sources: src('Spending by merchant') },
      );
    }
    if (!exact) {
      return reply(`I can’t find any spending at ${merchantPhrase} ${periodText(period)}.`, {
        sources: src('Spending by merchant'),
      });
    }
  }

  // A loose category word ("groceries" for Groceries via everyday words).
  if (exact) {
    const t = await data.totals({ ...window, categoryId: exact.item.id });
    return reply(
      t.expense > 0
        ? `You spent ${money(t.expense)} on ${exact.item.name} ${periodText(period)}, across ${count(t.expenseCount, 'payment')}.`
        : `You haven’t spent anything on ${exact.item.name} ${periodText(period)}.`,
      { sources: src('Spending by category') },
    );
  }

  // Everything.
  const t = await data.totals(window);
  if (t.expense === 0)
    return reply(`You haven’t spent anything ${periodText(period)}.`, { sources: src('Totals') });
  if (period.from) {
    return reply(
      `You spent ${money(t.expense)} ${periodText(period)}, across ${count(t.expenseCount, 'payment')}.`,
      { sources: src('Totals') },
    );
  }
  const cats = await data.byCategory(period, 'expense');
  return reply(
    `You spent ${money(t.expense)} ${periodText(period)}, across ${count(t.expenseCount, 'payment')}. Your biggest categories:`,
    {
      lines: cats
        .slice(0, 3)
        .map((c) => ({ label: c.name, value: `${money(c.total)} · ${pct(c.total, t.expense)}` })),
      sources: [...src('Totals'), ...src('Spending by category')],
    },
  );
}

async function answerIncome(text: string, period: Period, data: AssistantData): Promise<Reply> {
  const money = (v: number) => formatMoney(v, data.currency, { decimals: 'auto' });
  const which = findAccounts(text, usable(await data.accounts()));
  const ids = which ? ('one' in which ? [which.one.id] : which.many.map((x) => x.id)) : undefined;
  const t = await data.totals({ range: period, from: period.from, to: period.to, accountIds: ids });
  const into = which ? ` into ${'one' in which ? which.one.name : which.label}` : '';
  const sources = [`Totals · ${periodText(period)}`];
  if (t.income === 0) return reply(`No money came in${into} ${periodText(period)}.`, { sources });
  if (period.from || which) {
    return reply(`${money(t.income)} came in${into} ${periodText(period)}.`, { sources });
  }
  const cats = await data.byCategory(period, 'income');
  return reply(`${money(t.income)} came in ${periodText(period)}, and you spent ${money(t.expense)}.`, {
    lines: cats.slice(0, 4).map((c) => ({ label: c.name, value: money(c.total) })),
    sources: [...sources, `Income by category · ${periodText(period)}`],
  });
}

async function answerBreakdown(
  by: 'category' | 'merchant' | 'account',
  period: Period,
  data: AssistantData,
): Promise<Reply> {
  const money = (v: number) => formatMoney(v, data.currency, { decimals: 'never' });
  if (by === 'merchant') {
    const rows = (await data.byMerchant(period)).slice(0, 5);
    const src = { sources: [`Spending by merchant · ${rangeLabel(period)}`] };
    if (!rows.length) return reply(`No merchant spending ${periodText(period)}.`, src);
    return reply(`Where you spent most ${periodText(period)}: ${rows[0]!.name}, ${money(rows[0]!.total)}.`, {
      ...src,
      lines: rows.map((r) => ({ label: `${r.name} · ${count(r.count, 'payment')}`, value: money(r.total) })),
    });
  }
  if (by === 'account') {
    const rows = (await data.byAccount(period)).filter((r) => r.expense > 0);
    const total = rows.reduce((s, r) => s + r.expense, 0);
    const src = { sources: [`By payment method · ${rangeLabel(period)}`] };
    if (!rows.length) return reply(`Nothing was spent ${periodText(period)}.`, src);
    return reply(`How you paid ${periodText(period)}:`, {
      ...src,
      lines: rows.map((r) => ({ label: r.name, value: `${money(r.expense)} · ${pct(r.expense, total)}` })),
    });
  }
  const rows = await data.byCategory(period, 'expense');
  const total = rows.reduce((s, r) => s + r.total, 0);
  const src = { sources: [`Spending by category · ${rangeLabel(period)}`] };
  if (!rows.length || total === 0) return reply(`You haven’t spent anything ${periodText(period)}.`, src);
  return reply(
    `Most of your money went on ${rows[0]!.name} ${periodText(period)}: ${money(rows[0]!.total)}, ${pct(rows[0]!.total, total)} of ${money(total)}.`,
    {
      ...src,
      lines: rows
        .slice(0, 6)
        .map((r) => ({ label: r.name, value: `${money(r.total)} · ${pct(r.total, total)}` })),
    },
  );
}

/** The period before `p` of the same kind, cut to the same number of days when `p` is in progress. */
export function previousOf(p: Period, today: ISODate, startDay: number): Period {
  if (p.current) {
    const prev = moneyMonth(addDays(p.start, -1), startDay);
    const elapsed = daysIn({ start: p.start, end: today });
    const end = addDays(prev.start, elapsed - 1);
    return { start: prev.start, end: end > prev.end ? prev.end : end, label: 'by this point last month' };
  }
  if (p.label === 'last month') {
    return { ...moneyMonth(addDays(p.start, -1), startDay), label: 'the month before' };
  }
  const n = daysIn(p);
  return { start: addDays(p.start, -n), end: addDays(p.start, -1), label: `the ${n} days before` };
}

async function answerCompare(period: Period, data: AssistantData): Promise<Reply> {
  const money = (v: number) => formatMoney(v, data.currency, { decimals: 'never' });
  const now: Period = period.current ? { ...period, end: data.today } : period;
  const before = previousOf(period, data.today, data.cycleStartDay);
  const [a, b, ca, cb] = await Promise.all([
    data.summary(now),
    data.summary(before),
    data.byCategory(now, 'expense'),
    data.byCategory(before, 'expense'),
  ]);
  const sources = [
    `Totals · ${rangeLabel(now)} and ${rangeLabel(before)}`,
    'Spending by category, both periods',
  ];
  if (a.expense === 0 && b.expense === 0) {
    return reply(`There’s no spending ${periodText(now)} or ${before.label} to compare.`, { sources });
  }
  if (b.expense === 0) {
    return reply(
      `You spent ${money(a.expense)} ${periodText(now)}; there was no spending ${before.label} (${rangeLabel(before)}) to compare with.`,
      { sources },
    );
  }
  const change = Math.round(((a.expense - b.expense) / b.expense) * 100);
  const prevBy = new Map(cb.map((c) => [c.categoryId ?? c.name, c.total as number]));
  const nowBy = new Map(ca.map((c) => [c.categoryId ?? c.name, c.total as number]));
  const names = new Map([...cb, ...ca].map((c) => [c.categoryId ?? c.name, c.name]));
  const deltas = [...names.keys()]
    .map((k) => ({ name: names.get(k)!, now: nowBy.get(k) ?? 0, before: prevBy.get(k) ?? 0 }))
    .map((d) => ({ ...d, diff: d.now - d.before }))
    .filter((d) => d.diff !== 0)
    .sort((x, y) => (change >= 0 ? y.diff - x.diff : x.diff - y.diff))
    .slice(0, 3);
  const head =
    change === 0
      ? `You spent ${money(a.expense)} ${periodText(now)} — the same as ${before.label} (${rangeLabel(before)}).`
      : `You spent ${money(a.expense)} ${periodText(now)} — ${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than ${
          before.label
        } (${money(b.expense)}, ${rangeLabel(before)}).`;
  return reply(deltas.length ? `${head} ${change >= 0 ? 'Biggest increases:' : 'Biggest drops:'}` : head, {
    lines: deltas.map((d) => ({
      label: d.name,
      value: `${d.diff > 0 ? '+' : '−'}${money(Math.abs(d.diff))} (${money(d.now)} vs ${money(d.before)})`,
    })),
    sources,
  });
}

const CASH = new Set(['bank', 'savings', 'cash', 'wallet', 'debit_card']);

async function answerBalances(cardsOnly: boolean, data: AssistantData): Promise<Reply> {
  const money = (v: number) => formatMoney(v, data.currency, { decimals: 'auto' });
  const accts = usable(await data.accounts());
  const cash = accts.filter((a) => CASH.has(a.type));
  const cards = accts.filter((a) => a.type === 'credit_card');
  const owed = cards.reduce((s, a) => s + Math.max(-a.currentBalance, 0), 0);
  const cardLine = (a: Account) => {
    const used = Math.max(-a.currentBalance, 0);
    return {
      label: a.name,
      value:
        a.creditLimit == null
          ? `${money(used)} owed`
          : `${money(used)} owed · ${money(Math.max(a.creditLimit - used, 0))} available`,
    };
  };
  if (!accts.length) return reply('You haven’t added any payment methods yet.');
  if (cardsOnly) {
    if (!cards.length) return reply('You don’t have any credit cards in BUD.');
    return reply(`You owe ${money(owed)} across ${count(cards.length, 'credit card')}.`, {
      lines: cards.map(cardLine),
      sources: ['Your payment methods'],
    });
  }
  const cashTotal = cash.reduce((s, a) => s + a.currentBalance, 0);
  return reply(
    `You have ${money(cashTotal)} across ${count(cash.length, 'bank, cash or wallet account')}${
      cards.length
        ? `, and owe ${money(owed)} on credit cards — a card limit isn’t counted as money you have`
        : ''
    }.`,
    {
      lines: [
        ...cash.map((a) => ({ label: a.name, value: money(a.currentBalance) })),
        ...cards.map(cardLine),
        ...accts
          .filter((a) => !CASH.has(a.type) && a.type !== 'credit_card')
          .map((a) => ({ label: a.name, value: money(a.currentBalance) })),
      ],
      sources: ['Your payment methods'],
    },
  );
}

async function answerFriends(text: string, data: AssistantData): Promise<Reply> {
  const money = (v: number) => formatMoney(v, data.currency, { decimals: 'auto' });
  const [friends, groups, ious] = await Promise.all([data.friends(), data.groups(), data.ious?.() ?? []]);
  // BUD friends and anyone in Lent & borrowed, as one list of people (same name = same person).
  const people = new Map<string, { name: string; username: string | null; net: number; userId: string }>();
  for (const f of friends)
    people.set(f.name.toLowerCase(), { name: f.name, username: f.username, net: f.net, userId: f.userId });
  for (const i of ious) {
    const k = i.person.toLowerCase();
    const p = people.get(k) ?? { name: i.person, username: null, net: 0, userId: `iou:${k}` };
    people.set(k, { ...p, net: p.net + i.net });
  }
  const all = [...people.values()];
  const sources = ['Friends, shared expenses, and Lent & borrowed'];
  if (!all.length) {
    return reply(
      'Nobody owes you anything in BUD, and you don’t owe anyone. Add friends in Friends, or money you lent in Lent & borrowed.',
      { sources },
    );
  }
  const one = findFriend(text, all);
  if (one) {
    return reply(
      one.net > 0
        ? `${one.name} owes you ${money(one.net)}.`
        : one.net < 0
          ? `You owe ${one.name} ${money(-one.net)}.`
          : `You and ${one.name} are settled up.`,
      { sources },
    );
  }
  const owedToMe = all.reduce((x, p) => x + Math.max(p.net, 0), 0);
  const iOwe = all.reduce((x, p) => x + Math.max(-p.net, 0), 0);
  const open = all.filter((p) => p.net !== 0);
  const head =
    owedToMe === 0 && iOwe === 0
      ? 'You’re settled up with everyone.'
      : `People owe you ${money(owedToMe)}${iOwe ? `, and you owe ${money(iOwe)}` : ''}.`;
  return reply(head, {
    lines: [
      ...open.map((p) => ({
        label: p.name,
        value: p.net > 0 ? `owes you ${money(p.net)}` : `you owe ${money(-p.net)}`,
      })),
      ...groups
        .filter((g) => g.net !== 0)
        .map((g) => ({
          label: `${g.name} (group)`,
          value: g.net > 0 ? `you’re owed ${money(g.net)}` : `you owe ${money(-g.net)}`,
        })),
    ],
    sources,
  });
}

async function answerList(
  text: string,
  period: Period | null,
  data: AssistantData,
): Promise<{ reply: Reply; txns: TxnHit[] }> {
  const money = (v: number) => formatMoney(v, data.currency, { decimals: 'auto' });
  const [categories, accounts] = await Promise.all([data.categories(), data.accounts()]);
  const limit = Math.min(Number(text.match(/\b(?:last|latest|recent|top)\s+(\d{1,2})\b/i)?.[1] ?? 8), 20);
  const cat = findCategory(text, categories);
  const acct = findAccount(text, usable(accounts));
  const merchant = findMerchant(text, (p) => isKnownWord(p, categories, accounts));
  const type = /\bincome|money in|received\b/i.test(text)
    ? 'income'
    : /\bexpenses?|spent|spending\b/i.test(text)
      ? 'expense'
      : undefined;
  const found = await data.search({
    range: period ?? undefined,
    text: merchant ?? undefined,
    categoryId: cat?.exact ? cat.item.id : undefined,
    accountId: acct?.id,
    type,
    limit: period?.from ? 50 : limit,
  });
  const txns = period?.from
    ? found.filter((t) => t.occurredAt >= period.from! && t.occurredAt <= period.to!).slice(0, limit)
    : found;
  const what = [merchant, cat?.exact ? cat.item.name : null, acct?.name].filter(Boolean).join(', ');
  const sources = [`Transactions${period ? ` · ${rangeLabel(period)}` : ''}`];
  if (!txns.length) {
    return {
      reply: reply(
        `I couldn’t find any ${what ? `${what} ` : ''}transactions${period ? ` ${periodText(period)}` : ''}.`,
        { sources },
      ),
      txns,
    };
  }
  return {
    reply: reply(
      `${txns.length === limit ? `Your latest ${txns.length}` : `${count(txns.length, 'transaction')}`}${what ? ` for ${what}` : ''}${period ? ` ${periodText(period)}` : ''}:`,
      { lines: txns.map((t) => txnLine(t, money)), sources },
    ),
    txns,
  };
}

// ---------------------------------------------------------------------------
// Changes — built up until nothing is missing, then proposed for Confirm
// ---------------------------------------------------------------------------

async function continueAction(
  kind: 'create' | 'recategorise' | 'split',
  slots: Slots,
  convo: Conversation,
  data: AssistantData,
): Promise<{ reply: Reply; convo: Conversation }> {
  const money = (v: number) => formatMoney(v, data.currency, { decimals: 'auto' });
  const ask = (need: Need, text: string, choices: Choice[]) => ({
    reply: reply(text, { choices }),
    convo: { ...convo, pending: { kind, slots, need } },
  });
  const done = (r: Reply) => ({ reply: r, convo: { ...convo, pending: null } });
  const [categories, accounts] = await Promise.all([data.categories(), data.accounts()]);
  const methods = usable(accounts);

  if (kind === 'create') {
    const type = slots.type ?? 'expense';
    if (!slots.amount)
      return done(reply('How much was it? Say it with the amount, e.g. “Record ₹500 spent at Starbucks”.'));
    if (slots.date && slots.date > data.today)
      return done(reply('That date is in the future — I can only record what has happened.'));
    const kindCats = categories.filter((c) => c.kind === type && !c.isArchived);
    if (!slots.categoryId && slots.merchant) {
      // The category this merchant was filed under last time.
      const last = (await data.search({ text: slots.merchant, type, limit: 1 }))[0];
      if (last?.categoryId) slots.categoryId = last.categoryId;
    }
    if (!slots.categoryId) {
      return ask(
        'category',
        `Which category is ${money(slots.amount)}${slots.merchant ? ` at ${slots.merchant}` : ''}?`,
        kindCats
          .filter((c) => !c.parentId)
          .slice(0, 12)
          .map((c) => ({ label: c.name, value: `${PICK}category:${c.id}` })),
      );
    }
    if (!slots.accountId) {
      const options = type === 'income' ? methods.filter((a) => CASH.has(a.type)) : methods;
      if (options.length === 1) slots.accountId = options[0]!.id;
      else if (!options.length) return done(reply('Add a payment method first (More → Payment methods).'));
      else
        return ask(
          'account',
          type === 'income' ? 'Which account did it go into?' : 'What did you pay with?',
          options.map((a) => ({ label: a.name, value: `${PICK}account:${a.id}` })),
        );
    }
    const cat = categories.find((c) => c.id === slots.categoryId);
    const acct = accounts.find((a) => a.id === slots.accountId);
    if (!cat || !acct) return done(reply('That option is no longer available — please ask again.'));
    const day = slots.date ?? data.today;
    const summary = `${type === 'income' ? 'Money in' : 'Expense'} ${money(slots.amount)}${
      slots.merchant ? ` · ${slots.merchant}` : ''
    } · ${cat.name} · ${acct.name}${day === data.today ? '' : ` · ${dayLabel(day)}`}`;
    return done(
      reply('Here it is — tap Confirm to save it.', {
        actions: [
          {
            kind: 'create_transaction',
            type,
            amount: slots.amount,
            accountId: acct.id,
            accountName: acct.name,
            categoryId: cat.id,
            categoryName: cat.name,
            merchantName: slots.merchant ?? null,
            occurredOn: day,
            summary,
          },
        ],
      }),
    );
  }

  if (kind === 'recategorise') {
    if (!slots.categoryId) return ask('category', 'Which category should it be?', []);
    let txn: TxnHit | undefined;
    if (slots.txnId) {
      txn =
        convo.lastTxns.find((t) => t.id === slots.txnId) ??
        (await data.search({ id: slots.txnId, limit: 1 }))[0];
    } else {
      const range = slots.findPeriod ?? { start: addDays(data.today, -60), end: data.today };
      const hits = (await data.search({ range, text: slots.findText ?? undefined, limit: 6 })).filter(
        (t) => (t.type === 'expense' || t.type === 'income') && !t.sharedExpenseId,
      );
      if (!hits.length) {
        return done(
          reply(
            `I couldn’t find ${slots.findText ? `a ${slots.findText} transaction` : 'that transaction'} ${
              slots.findPeriod ? periodText(slots.findPeriod) : 'in the last 60 days'
            }. Try “show my ${slots.findText ?? 'recent'} transactions”, then “change it to …”.`,
          ),
        );
      }
      if (hits.length > 1) return askTransaction(hits, slots, convo, money);
      txn = hits[0];
    }
    if (!txn) return done(reply('That transaction no longer exists.'));
    if (txn.sharedExpenseId)
      return done(
        reply('That one belongs to a shared expense — change it from the shared expense in Friends.'),
      );
    if (txn.type !== 'expense' && txn.type !== 'income')
      return done(reply('Transfers and adjustments don’t have a category.'));
    const cat = categories.find((c) => c.id === slots.categoryId);
    if (!cat) return done(reply('That category is no longer available.'));
    if (cat.kind !== txn.type) {
      return done(
        reply(
          `${cat.name} is ${cat.kind === 'income' ? 'an income' : 'a spending'} category, but that transaction is ${txn.type === 'income' ? 'money in' : 'spending'}.`,
        ),
      );
    }
    if (txn.categoryId === cat.id) return done(reply(`It’s already in ${cat.name}.`));
    return done(
      reply('Tap Confirm to change it.', {
        actions: [
          {
            kind: 'update_transaction',
            transactionId: txn.id,
            categoryId: cat.id,
            categoryName: cat.name,
            summary: `${txn.merchant ?? txn.category ?? 'Transaction'} · ${money(txn.amount)} · ${dayLabel(txn.day)}: ${
              txn.category ?? 'no category'
            } → ${cat.name}`,
          },
        ],
      }),
    );
  }

  // split
  const friends = await data.friends();
  if (!slots.amount) return done(reply('How much was the bill? e.g. “Split ₹2,000 dinner with Rahul”.'));
  if (slots.amount < 2) return done(reply('That’s too small to split.'));
  if (!friends.length) return done(reply('Add a friend in Friends first, then I can split bills with them.'));
  if (!slots.friendId) {
    return ask(
      'friend',
      'Who did you split it with?',
      friends.map((f) => ({ label: f.name, value: `${PICK}friend:${f.userId}` })),
    );
  }
  if (!slots.accountId) {
    if (methods.length === 1) slots.accountId = methods[0]!.id;
    else
      return ask(
        'account',
        'What did you pay with?',
        methods.map((a) => ({ label: a.name, value: `${PICK}account:${a.id}` })),
      );
  }
  const friend = friends.find((f) => f.userId === slots.friendId);
  const acct = accounts.find((a) => a.id === slots.accountId);
  if (!friend || !acct) return done(reply('That option is no longer available — please ask again.'));
  const mine = Math.ceil(slots.amount / 2);
  const title = slots.title ?? `Split with ${friend.name}`;
  return done(
    reply('Tap Confirm to save the split.', {
      actions: [
        {
          kind: 'split_with_friend',
          friendId: friend.userId,
          friendName: friend.name,
          total: slots.amount,
          title,
          occurredOn: slots.date ?? data.today,
          accountId: acct.id,
          accountName: acct.name,
          summary: `${title} · ${money(slots.amount)} paid from ${acct.name}, split equally — your share ${money(
            mine,
          )}, ${friend.name} owes you ${money(slots.amount - mine)}`,
        },
      ],
    }),
  );
}

function askTransaction(
  hits: TxnHit[],
  slots: Slots,
  convo: Conversation,
  money: (v: number) => string,
): { reply: Reply; convo: Conversation } {
  return {
    reply: reply('Which one?', {
      choices: hits.slice(0, 6).map((t) => ({
        label: `${dayLabel(t.day)} · ${t.merchant ?? t.category ?? 'Transaction'} · ${money(t.amount)}`,
        value: `${PICK}transaction:${t.id}`,
      })),
    }),
    convo: { lastTxns: hits, pending: { kind: 'recategorise', slots, need: 'transaction' } },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function usable(accounts: Account[]): Account[] {
  return accounts.filter((a) => a.isActive && !a.systemKind);
}

function isKnownWord(phrase: string, categories: Category[], accounts: Account[]): boolean {
  if (/\b(?:credit|debit|cards?|bank|accounts?|savings?|upi|wallets?|cash|a\/?c)\b/i.test(phrase))
    return true;
  return (
    !!findCategory(phrase, categories)?.exact ||
    !!findAccount(phrase, usable(accounts)) ||
    /^(?:my|this|that|it|me|food|today|yesterday|last|the)\b/i.test(phrase)
  );
}

function count(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : noun.endsWith('y') && !/[aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;
}

function pct(part: number, total: number): string {
  return `${total ? Math.round((part / total) * 100) : 0}%`;
}

function txnLine(t: TxnHit, money: (v: number) => string) {
  const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '' : '↔ ';
  return {
    label: `${dayLabel(t.day)} · ${t.merchant ?? t.category ?? (t.type === 'transfer' ? 'Transfer' : 'Transaction')}${
      t.category && t.merchant ? ` · ${t.category}` : ''
    }`,
    value: `${sign}${money(t.amount)}`,
  };
}
