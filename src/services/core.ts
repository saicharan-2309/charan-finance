/**
 * Data access for reference data: profile, settings, accounts, categories,
 * merchants. Every query relies on RLS for scoping; no client-side user
 * filtering is used for security.
 */
import { toDecimalString, type Minor } from '@/lib/money';
import { supabase, unwrap } from '@/lib/supabase';
import type {
  Account,
  AccountType,
  AppSettings,
  Category,
  CategoryKind,
  Merchant,
  Profile,
  SpendClass,
} from '@/types/domain';
import { mapAccount, mapCategory, mapMerchant, mapProfile, mapSettings, type Row } from './mappers';

// ---------------------------------------------------------------------------
// Profile & settings
// ---------------------------------------------------------------------------
export async function fetchProfile(): Promise<Profile> {
  const row = unwrap(await supabase.from('profiles').select('*').single());
  return mapProfile(row);
}

export async function updateProfile(
  id: string,
  patch: Partial<{ displayName: string | null; defaultCurrency: string; timezone: string }>,
): Promise<void> {
  const body: Row = {};
  if (patch.displayName !== undefined) body.display_name = patch.displayName;
  if (patch.defaultCurrency !== undefined) body.default_currency = patch.defaultCurrency;
  if (patch.timezone !== undefined) body.timezone = patch.timezone;
  unwrap(await supabase.from('profiles').update(body).eq('id', id).select('id'));
}

export async function fetchSettings(): Promise<AppSettings> {
  return mapSettings(unwrap(await supabase.from('app_settings').select('*').single()));
}

export async function updateSettings(userId: string, patch: Partial<AppSettings>): Promise<void> {
  const map: Record<keyof AppSettings, string> = {
    weekStartsOn: 'week_starts_on',
    budgetWarningPercent: 'budget_warning_percent',
    notifyUpcomingBills: 'notify_upcoming_bills',
    notifyBudgetWarnings: 'notify_budget_warnings',
    notifyGoalReminders: 'notify_goal_reminders',
    notifySubscriptionRenewals: 'notify_subscription_renewals',
    notifyMonthlySummary: 'notify_monthly_summary',
    billReminderDaysBefore: 'bill_reminder_days_before',
  };
  const body: Row = {};
  for (const [k, v] of Object.entries(patch)) body[map[k as keyof AppSettings]] = v;
  unwrap(await supabase.from('app_settings').update(body).eq('user_id', userId).select('user_id'));
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
export async function fetchAccounts(): Promise<Account[]> {
  const rows = unwrap(await supabase.from('accounts').select('*').order('sort_order').order('name'));
  return rows.map(mapAccount);
}

export interface AccountInput {
  name: string;
  type: AccountType;
  institution: string | null;
  last4: string | null;
  currency: string;
  openingBalance: Minor;
  creditLimit: Minor | null;
  includeInNetWorth: boolean;
  color: string | null;
  icon: string | null;
  notes: string | null;
  /** Provider key for UPI apps and bank brands. Display identity only. */
  provider: string | null;
  statementDay: number | null;
  dueDay: number | null;
  minimumDue: Minor | null;
}

function accountBody(input: AccountInput): Row {
  // Fields that do not apply to the chosen type are written as NULL rather
  // than carried over, so a card converted to cash keeps no billing dates.
  const isCard = input.type === 'credit_card';
  return {
    name: input.name.trim(),
    type: input.type,
    institution: input.institution?.trim() || null,
    last4: input.last4?.trim() || null,
    currency: input.currency,
    opening_balance: toDecimalString(input.openingBalance),
    credit_limit: isCard && input.creditLimit !== null ? toDecimalString(input.creditLimit) : null,
    include_in_net_worth: input.includeInNetWorth,
    color: input.color,
    icon: input.icon,
    notes: input.notes?.trim() || null,
    provider: input.provider?.trim() || null,
    statement_day: isCard ? input.statementDay : null,
    due_day: isCard ? input.dueDay : null,
    minimum_due: isCard && input.minimumDue !== null ? toDecimalString(input.minimumDue) : null,
  };
}

export async function createAccount(input: AccountInput): Promise<Account> {
  const row = unwrap(await supabase.from('accounts').insert(accountBody(input)).select('*').single());
  return mapAccount(row);
}

export async function updateAccount(id: string, input: AccountInput): Promise<Account> {
  const row = unwrap(
    await supabase.from('accounts').update(accountBody(input)).eq('id', id).select('*').single(),
  );
  return mapAccount(row);
}

export async function setAccountActive(id: string, isActive: boolean): Promise<void> {
  unwrap(await supabase.from('accounts').update({ is_active: isActive }).eq('id', id).select('id'));
}

/** Deletes an account with no history. Accounts with transactions must be archived. */
export async function deleteAccount(id: string): Promise<void> {
  unwrap(await supabase.from('accounts').delete().eq('id', id).select('id'));
}

export async function reconcileAccountBalance(id: string, newBalance: Minor, note?: string): Promise<void> {
  unwrap(
    await supabase.rpc('set_account_balance', {
      p_account_id: id,
      p_new_balance: toDecimalString(newBalance),
      p_note: note ?? null,
    }),
  );
}

export async function reorderAccounts(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map((id, i) => supabase.from('accounts').update({ sort_order: i }).eq('id', id).then(unwrap)),
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export async function fetchCategories(): Promise<Category[]> {
  const rows = unwrap(
    await supabase.from('transaction_categories').select('*').order('sort_order').order('name'),
  );
  return rows.map(mapCategory);
}

export interface CategoryInput {
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  classification: SpendClass | null;
  icon: string | null;
  color: string | null;
}

export async function createCategory(input: CategoryInput): Promise<Category> {
  const row = unwrap(
    await supabase
      .from('transaction_categories')
      .insert({
        name: input.name.trim(),
        kind: input.kind,
        parent_id: input.parentId,
        classification: input.classification,
        icon: input.icon,
        color: input.color,
        sort_order: 1000,
      })
      .select('*')
      .single(),
  );
  return mapCategory(row);
}

export async function updateCategory(
  id: string,
  patch: Partial<CategoryInput> & { isArchived?: boolean },
): Promise<void> {
  const body: Row = {};
  if (patch.name !== undefined) body.name = patch.name.trim();
  if (patch.classification !== undefined) body.classification = patch.classification;
  if (patch.icon !== undefined) body.icon = patch.icon;
  if (patch.color !== undefined) body.color = patch.color;
  if (patch.isArchived !== undefined) body.is_archived = patch.isArchived;
  unwrap(await supabase.from('transaction_categories').update(body).eq('id', id).select('id'));
}

/** Only succeeds when nothing references the category (FK ON DELETE RESTRICT). */
export async function deleteCategory(id: string): Promise<void> {
  unwrap(await supabase.from('transaction_categories').delete().eq('id', id).select('id'));
}

// ---------------------------------------------------------------------------
// Merchants
// ---------------------------------------------------------------------------
export async function fetchMerchants(): Promise<Merchant[]> {
  const rows = unwrap(await supabase.from('merchants').select('*').order('name'));
  return rows.map(mapMerchant);
}

export async function updateMerchant(
  id: string,
  patch: Partial<{ name: string; defaultCategoryId: string | null; isArchived: boolean }>,
): Promise<void> {
  const body: Row = {};
  if (patch.name !== undefined) body.name = patch.name.trim();
  if (patch.defaultCategoryId !== undefined) body.default_category_id = patch.defaultCategoryId;
  if (patch.isArchived !== undefined) body.is_archived = patch.isArchived;
  unwrap(await supabase.from('merchants').update(body).eq('id', id).select('id'));
}

export async function mergeMerchants(sourceId: string, targetId: string): Promise<number> {
  return unwrap(
    await supabase.rpc('merge_merchants', { p_source_id: sourceId, p_target_id: targetId }),
  ) as number;
}

export async function createMerchant(name: string): Promise<Merchant> {
  const row = unwrap(await supabase.from('merchants').insert({ name: name.trim() }).select('*').single());
  return mapMerchant(row);
}
