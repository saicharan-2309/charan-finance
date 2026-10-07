/**
 * Friends, messaging, groups, shared expenses and settlements.
 *
 * Everything that changes data goes through a database function that checks
 * friendship, group membership and that a split adds up; the tables are
 * read-only to the app and filtered by row-level security to what you're a
 * participant in. Nothing here can read another person's accounts.
 */
import { toDecimalString, toMinor, type Minor } from '@/lib/money';
import { supabase, unwrap } from '@/lib/supabase';
import type {
  AppNotification,
  ChatMessage,
  Conversation,
  FriendBalance,
  Friendship,
  PersonCard,
  SearchResult,
  Settlement,
  SharedExpense,
  SplitGroup,
} from '@/types/domain';

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? null : String(v));

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
export async function setUsername(username: string): Promise<string> {
  return String(unwrap(await supabase.rpc('set_username', { p_username: username })));
}

export async function searchPeople(query: string): Promise<SearchResult[]> {
  const rows = unwrap(await supabase.rpc('search_people', { p_query: query })) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    username: s(r.username),
    status: s(r.status),
    relation: r.relation as SearchResult['relation'],
  }));
}

export async function personCards(ids: string[]): Promise<Map<string, PersonCard>> {
  const unique = [...new Set(ids)];
  const cards = await Promise.all(
    unique.map(async (id) => {
      const card = unwrap(await supabase.rpc('profile_card', { p_user_id: id })) as Row | null;
      return card
        ? ({ id, name: String(card.name), username: s(card.username), status: s(card.status) } as PersonCard)
        : ({ id, name: 'BUD user', username: null, status: null } as PersonCard);
    }),
  );
  return new Map(cards.map((c) => [c.id, c]));
}

// ---------------------------------------------------------------------------
// Friendships
// ---------------------------------------------------------------------------
export async function fetchFriendships(me: string): Promise<Friendship[]> {
  const rows = unwrap(
    await supabase.from('friendships').select('*').in('status', ['pending', 'accepted', 'blocked']),
  ) as Row[];
  const others = rows.map((r) => (r.user_low === me ? String(r.user_high) : String(r.user_low)));
  const cards = await personCards(others);
  return rows.map((r, i) => ({
    id: String(r.id),
    other: cards.get(others[i]!)!,
    status: r.status as Friendship['status'],
    outgoing: r.requested_by === me,
    blockedByMe: r.blocked_by === me,
    createdAt: String(r.created_at),
  }));
}

export const sendFriendRequest = async (userId: string) =>
  String(unwrap(await supabase.rpc('send_friend_request', { p_user_id: userId })));
export const respondFriendRequest = async (userId: string, accept: boolean) =>
  String(unwrap(await supabase.rpc('respond_friend_request', { p_user_id: userId, p_accept: accept })));
export const removeFriend = async (userId: string) =>
  void unwrap(await supabase.rpc('remove_friend', { p_user_id: userId }));
export const blockUser = async (userId: string) =>
  void unwrap(await supabase.rpc('block_user', { p_user_id: userId }));
export const unblockUser = async (userId: string) =>
  void unwrap(await supabase.rpc('unblock_user', { p_user_id: userId }));

export async function fetchFriendBalances(): Promise<FriendBalance[]> {
  const rows = unwrap(await supabase.rpc('friend_balances')) as Row[];
  return rows.map((r) => ({
    userId: String(r.user_id),
    name: String(r.name),
    username: s(r.username),
    net: toMinor(r.net as string),
    currency: String(r.currency ?? 'INR'),
  }));
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------
export async function fetchConversations(): Promise<Conversation[]> {
  const rows = unwrap(await supabase.rpc('list_conversations')) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind as Conversation['kind'],
    title: String(r.title),
    otherUserId: s(r.other_user_id),
    groupId: s(r.group_id),
    lastBody: s(r.last_body),
    lastKind: (r.last_kind as Conversation['lastKind']) ?? null,
    lastAt: s(r.last_at),
    unread: Number(r.unread ?? 0),
  }));
}

export const directConversation = async (userId: string) =>
  String(unwrap(await supabase.rpc('direct_conversation', { p_user_id: userId })));

const mapMessage = (r: Row): ChatMessage => ({
  id: String(r.id),
  conversationId: String(r.conversation_id),
  senderId: String(r.sender_id),
  kind: r.kind as ChatMessage['kind'],
  body: String(r.body),
  sharedExpenseId: s(r.shared_expense_id),
  settlementId: s(r.settlement_id),
  createdAt: String(r.created_at),
});

export async function fetchMessages(conversationId: string, limit = 200): Promise<ChatMessage[]> {
  const rows = unwrap(
    await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit),
  ) as Row[];
  return rows.map(mapMessage).reverse();
}

export const sendMessage = async (conversationId: string, body: string) =>
  String(unwrap(await supabase.rpc('send_message', { p_conversation_id: conversationId, p_body: body })));
export const markConversationRead = async (conversationId: string) =>
  void unwrap(await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId }));

/** Live new messages in one conversation (Supabase Realtime; RLS applies). */
export function subscribeToMessages(conversationId: string, onMessage: (m: ChatMessage) => void) {
  const channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onMessage(mapMessage(payload.new as Row)),
    )
    .subscribe();
  return () => void supabase.removeChannel(channel);
}

/** "Typing…" over a Realtime broadcast channel — nothing is stored. */
export function typingChannel(conversationId: string, me: string, onTyping: (userId: string) => void) {
  const channel = supabase.channel(`typing:${conversationId}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
    const uid = (payload as { userId?: string }).userId;
    if (uid && uid !== me) onTyping(uid);
  });
  channel.subscribe();
  return {
    ping: () => void channel.send({ type: 'broadcast', event: 'typing', payload: { userId: me } }),
    close: () => void supabase.removeChannel(channel),
  };
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
export async function fetchSplitGroups(): Promise<SplitGroup[]> {
  const groups = unwrap(await supabase.from('split_groups').select('*').eq('is_archived', false)) as Row[];
  const members = unwrap(await supabase.from('split_group_members').select('group_id, user_id')) as Row[];
  return groups.map((g) => ({
    id: String(g.id),
    name: String(g.name),
    createdBy: String(g.created_by),
    memberIds: members.filter((m) => m.group_id === g.id).map((m) => String(m.user_id)),
  }));
}

export const createSplitGroup = async (name: string, memberIds: string[]) =>
  String(unwrap(await supabase.rpc('create_split_group', { p_name: name, p_member_ids: memberIds })));
export const addGroupMember = async (groupId: string, userId: string) =>
  void unwrap(await supabase.rpc('add_group_member', { p_group_id: groupId, p_user_id: userId }));
export const leaveGroup = async (groupId: string) =>
  void unwrap(await supabase.rpc('leave_group', { p_group_id: groupId }));

export async function fetchGroupBalances(
  groupId: string,
): Promise<{ userId: string; name: string; net: Minor }[]> {
  const rows = unwrap(await supabase.rpc('group_balances', { p_group_id: groupId })) as Row[];
  return rows.map((r) => ({
    userId: String(r.user_id),
    name: String(r.name),
    net: toMinor(r.net as string),
  }));
}

// ---------------------------------------------------------------------------
// Shared expenses
// ---------------------------------------------------------------------------
export async function fetchSharedExpenses(
  filter: { groupId?: string; withUser?: string } = {},
): Promise<SharedExpense[]> {
  let q = supabase.from('shared_expenses').select('*').order('occurred_on', { ascending: false }).limit(200);
  if (filter.groupId) q = q.eq('group_id', filter.groupId);
  const rows = unwrap(await q) as Row[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => String(r.id));
  const shares = unwrap(
    await supabase.from('shared_expense_shares').select('*').in('shared_expense_id', ids),
  ) as Row[];
  const allocs = unwrap(
    await supabase
      .from('settlement_allocations')
      .select('shared_expense_id, amount, settlements(from_user)')
      .in('shared_expense_id', ids),
  ) as Row[];
  const list = rows.map((r) => mapExpense(r, shares, allocs));
  return filter.withUser
    ? list.filter((e) => e.paidBy === filter.withUser || e.shares.some((x) => x.userId === filter.withUser))
    : list;
}

export async function fetchSharedExpense(id: string): Promise<SharedExpense | null> {
  const row = unwrap(
    await supabase.from('shared_expenses').select('*').eq('id', id).maybeSingle(),
  ) as Row | null;
  if (!row) return null;
  const shares = unwrap(
    await supabase.from('shared_expense_shares').select('*').eq('shared_expense_id', id),
  ) as Row[];
  const allocs = unwrap(
    await supabase
      .from('settlement_allocations')
      .select('shared_expense_id, amount, settlements(from_user)')
      .eq('shared_expense_id', id),
  ) as Row[];
  return mapExpense(row, shares, allocs);
}

function mapExpense(r: Row, shares: Row[], allocs: Row[]): SharedExpense {
  const id = String(r.id);
  return {
    id,
    groupId: s(r.group_id),
    createdBy: String(r.created_by),
    paidBy: String(r.paid_by),
    title: String(r.title),
    categoryName: s(r.category_name),
    icon: s(r.icon),
    total: toMinor(r.total as string),
    currency: String(r.currency),
    occurredOn: String(r.occurred_on),
    notes: s(r.notes),
    splitMethod: r.split_method as SharedExpense['splitMethod'],
    status: r.status as SharedExpense['status'],
    payerBooked: !!r.payer_booked,
    linkedTransactionId: s(r.linked_transaction_id),
    createdAt: String(r.created_at),
    shares: shares
      .filter((x) => x.shared_expense_id === id)
      .map((x) => ({
        userId: String(x.user_id),
        amount: toMinor(x.amount as string),
        input: x.input_value === null || x.input_value === undefined ? null : Number(x.input_value),
        booked: !!x.booked,
        settled: allocs
          .filter(
            (a) =>
              a.shared_expense_id === id &&
              (a.settlements as { from_user?: string } | null)?.from_user === String(x.user_id),
          )
          .reduce((sum, a) => sum + toMinor(a.amount as string), 0) as Minor,
      })),
  };
}

export interface SharedExpenseInput {
  groupId?: string | null;
  paidBy: string;
  title: string;
  categoryName?: string | null;
  icon?: string | null;
  total: Minor;
  currency?: string;
  occurredOn: string;
  notes?: string | null;
  splitMethod: SharedExpense['splitMethod'];
  shares: { userId: string; amount: Minor; input?: number | null }[];
  /** When I paid: the account I paid from, or an existing expense to link (no duplicate). */
  payerAccountId?: string | null;
  payerTransactionId?: string | null;
  payerCategoryId?: string | null;
}

function toPayload(i: SharedExpenseInput) {
  return {
    group_id: i.groupId ?? null,
    paid_by: i.paidBy,
    title: i.title,
    category_name: i.categoryName ?? null,
    icon: i.icon ?? null,
    total: toDecimalString(i.total),
    currency: i.currency ?? 'INR',
    occurred_on: i.occurredOn,
    notes: i.notes ?? null,
    split_method: i.splitMethod,
    shares: i.shares.map((x) => ({
      user_id: x.userId,
      amount: toDecimalString(x.amount),
      input: x.input ?? null,
    })),
    payer_account_id: i.payerAccountId ?? null,
    payer_transaction_id: i.payerTransactionId ?? null,
    payer_category_id: i.payerCategoryId ?? null,
  };
}

export const createSharedExpense = async (input: SharedExpenseInput) =>
  String(unwrap(await supabase.rpc('create_shared_expense', { p: toPayload(input) })));
export const updateSharedExpense = async (id: string, input: SharedExpenseInput) =>
  void unwrap(await supabase.rpc('update_shared_expense', { p_id: id, p: toPayload(input) }));
export const cancelSharedExpense = async (id: string) =>
  void unwrap(await supabase.rpc('cancel_shared_expense', { p_id: id }));
export const bookPayerSide = async (v: {
  expenseId: string;
  accountId?: string | null;
  transactionId?: string | null;
  categoryId?: string | null;
}) =>
  void unwrap(
    await supabase.rpc('book_payer_side', {
      p_expense_id: v.expenseId,
      p_account_id: v.accountId ?? null,
      p_transaction_id: v.transactionId ?? null,
      p_category_id: v.categoryId ?? null,
    }),
  );
export const bookMyShare = async (expenseId: string) =>
  void unwrap(await supabase.rpc('book_my_share', { p_expense_id: expenseId }));

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------
export async function fetchSettlements(withUser?: string): Promise<Settlement[]> {
  const rows = unwrap(
    await supabase
      .from('settlements')
      .select('*, settlement_allocations(shared_expense_id, amount)')
      .order('created_at', { ascending: false })
      .limit(200),
  ) as Row[];
  return rows
    .map((r) => ({
      id: String(r.id),
      groupId: s(r.group_id),
      fromUser: String(r.from_user),
      toUser: String(r.to_user),
      amount: toMinor(r.amount as string),
      currency: String(r.currency),
      settledOn: String(r.settled_on),
      note: s(r.note),
      createdBy: String(r.created_by),
      fromBooked: !!r.from_booked,
      toBooked: !!r.to_booked,
      createdAt: String(r.created_at),
      allocations: ((r.settlement_allocations as Row[] | null) ?? []).map((a) => ({
        sharedExpenseId: String(a.shared_expense_id),
        amount: toMinor(a.amount as string),
      })),
    }))
    .filter((x) => !withUser || x.fromUser === withUser || x.toUser === withUser);
}

export const recordSettlement = async (v: {
  otherUserId: string;
  direction: 'i_paid' | 'they_paid';
  amount: Minor;
  accountId: string | null;
  groupId?: string | null;
  note?: string | null;
}) =>
  String(
    unwrap(
      await supabase.rpc('record_settlement', {
        p_other: v.otherUserId,
        p_direction: v.direction,
        p_amount: toDecimalString(v.amount),
        p_account_id: v.accountId,
        p_group_id: v.groupId ?? null,
        p_note: v.note ?? null,
      }),
    ),
  );
export const bookSettlementSide = async (settlementId: string, accountId: string) =>
  void unwrap(
    await supabase.rpc('book_settlement_side', { p_settlement_id: settlementId, p_account_id: accountId }),
  );
export const deleteSettlement = async (id: string) =>
  void unwrap(await supabase.rpc('delete_settlement', { p_settlement_id: id }));
export const remindFriend = async (userId: string, sharedExpenseId?: string | null) =>
  void unwrap(
    await supabase.rpc('remind_friend', { p_user_id: userId, p_shared_expense_id: sharedExpenseId ?? null }),
  );

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export async function fetchNotifications(): Promise<AppNotification[]> {
  const rows = unwrap(
    await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
  ) as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    actorId: s(r.actor_id),
    kind: r.kind as AppNotification['kind'],
    title: String(r.title),
    body: s(r.body),
    data: (r.data as Record<string, string>) ?? {},
    readAt: s(r.read_at),
    createdAt: String(r.created_at),
  }));
}

export const markNotificationsRead = async (ids?: string[]) =>
  Number(unwrap(await supabase.rpc('mark_notifications_read', { p_ids: ids ?? null })) ?? 0);

export function subscribeToNotifications(me: string, onInsert: (n: AppNotification) => void) {
  const channel = supabase
    .channel(`notifications:${me}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me}` },
      (payload) => {
        const r = payload.new as Row;
        onInsert({
          id: String(r.id),
          actorId: s(r.actor_id),
          kind: r.kind as AppNotification['kind'],
          title: String(r.title),
          body: s(r.body),
          data: (r.data as Record<string, string>) ?? {},
          readAt: null,
          createdAt: String(r.created_at),
        });
      },
    )
    .subscribe();
  return () => void supabase.removeChannel(channel);
}

export const registerPushToken = async (token: string, platform: 'ios' | 'android' | 'web') =>
  void unwrap(await supabase.rpc('register_push_token', { p_token: token, p_platform: platform }));

/** Your net position in each group (positive: the group owes you). */
export async function fetchMyGroupPositions(): Promise<{ groupId: string; name: string; net: Minor }[]> {
  const rows = unwrap(await supabase.rpc('my_group_positions')) as Row[];
  return rows.map((r) => ({
    groupId: String(r.group_id),
    name: String(r.name),
    net: toMinor(r.net as string),
  }));
}
