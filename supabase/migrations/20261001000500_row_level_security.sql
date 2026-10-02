-- =============================================================================
-- Row Level Security & privileges
-- =============================================================================
-- Defence in depth:
--   1. RLS on every user-owned table: rows are visible/writable only when
--      user_id = auth.uid().
--   2. Composite FKs (see core schema) stop cross-user references.
--   3. Column-level privileges stop clients writing derived values
--      (accounts.current_balance, savings_goals.current_amount, snapshots).
--   4. The anon role has no access to any table or function.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere (and force it for table owners' non-superuser roles)
-- ---------------------------------------------------------------------------
alter table public.profiles               enable row level security;
alter table public.app_settings           enable row level security;
alter table public.accounts               enable row level security;
alter table public.transaction_categories enable row level security;
alter table public.merchants              enable row level security;
alter table public.recurring_transactions enable row level security;
alter table public.transactions           enable row level security;
alter table public.tags                   enable row level security;
alter table public.transaction_tags       enable row level security;
alter table public.attachments            enable row level security;
alter table public.budgets                enable row level security;
alter table public.budget_items           enable row level security;
alter table public.savings_goals          enable row level security;
alter table public.goal_contributions     enable row level security;
alter table public.net_worth_snapshots    enable row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- profiles: keyed by id
create policy profiles_select on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- app_settings: keyed by user_id
create policy app_settings_select on public.app_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy app_settings_update on public.app_settings
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Generic owner policies for every other table
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'accounts', 'transaction_categories', 'merchants', 'recurring_transactions',
    'transactions', 'tags', 'transaction_tags', 'attachments', 'budgets',
    'budget_items', 'savings_goals', 'goal_contributions', 'net_worth_snapshots'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
      tbl || '_select', tbl);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
      tbl || '_insert', tbl);
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      tbl || '_update', tbl);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',
      tbl || '_delete', tbl);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select, update (display_name, default_currency, timezone) on public.profiles to authenticated;

grant select, update (
  week_starts_on, budget_warning_percent, notify_upcoming_bills, notify_budget_warnings,
  notify_goal_reminders, notify_subscription_renewals, notify_monthly_summary,
  bill_reminder_days_before
) on public.app_settings to authenticated;

-- accounts: current_balance is never client-writable
grant select, delete on public.accounts to authenticated;
grant insert (id, user_id, name, type, institution, last4, currency, opening_balance, credit_limit,
              is_active, include_in_net_worth, color, icon, notes, sort_order)
  on public.accounts to authenticated;
grant update (name, type, institution, last4, currency, opening_balance, credit_limit,
              is_active, include_in_net_worth, color, icon, notes, sort_order)
  on public.accounts to authenticated;

grant select, insert, delete on public.transaction_categories to authenticated;
grant update (parent_id, name, kind, classification, icon, color, is_archived, sort_order)
  on public.transaction_categories to authenticated;

grant select, insert, delete on public.merchants to authenticated;
grant update (name, default_category_id, is_archived) on public.merchants to authenticated;

grant select, insert, delete on public.recurring_transactions to authenticated;
grant update (name, type, kind, amount, account_id, to_account_id, category_id, subcategory_id,
              merchant_id, notes, frequency, interval_count, start_date, end_date,
              auto_post, remind_days_before, is_active,
              -- also advanced by post/skip RPCs; writing it directly is equivalent to "skip"
              last_occurrence_date)
  on public.recurring_transactions to authenticated;

grant select, insert, delete on public.transactions to authenticated;
grant update (type, amount, currency, account_id, to_account_id, category_id, subcategory_id,
              merchant_id, occurred_at, notes)
  on public.transactions to authenticated;

grant select, insert, delete on public.tags to authenticated;
grant update (name) on public.tags to authenticated;
grant select, insert, delete on public.transaction_tags to authenticated;

grant select, insert, delete on public.attachments to authenticated;
grant update (transaction_id, ocr_result) on public.attachments to authenticated;

grant select, insert, delete on public.budgets to authenticated;
grant update (name, period, start_date, end_date, currency, is_active) on public.budgets to authenticated;
grant select, insert, delete on public.budget_items to authenticated;
grant update (category_id, amount) on public.budget_items to authenticated;

-- savings_goals: current_amount is derived
grant select, delete on public.savings_goals to authenticated;
grant insert (id, user_id, name, description, target_amount, initial_amount, currency,
              target_date, account_id, icon, color, is_archived)
  on public.savings_goals to authenticated;
grant update (name, description, target_amount, initial_amount, currency, target_date,
              account_id, icon, color, is_archived)
  on public.savings_goals to authenticated;
grant select, insert, delete on public.goal_contributions to authenticated;
grant update (amount, contributed_on, note) on public.goal_contributions to authenticated;

-- snapshots are written only by capture_net_worth_snapshot()
grant select, delete on public.net_worth_snapshots to authenticated;

grant select on public.transactions_view to authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges: nothing for anon; explicit allow-list for authenticated
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.user_timezone(),
  public.user_default_currency(),
  public.user_today(),
  public.local_day_start(date, text),
  public.is_liability(public.account_type),
  public.verify_account_balances(),
  public.resolve_merchant(text, uuid),
  public.sync_transaction_tags(uuid, text[]),
  public.save_transaction(text, uuid, public.txn_type, numeric, uuid, timestamptz, uuid, uuid, uuid, uuid, text, text, text[], timestamptz),
  public.delete_transaction(uuid),
  public.set_account_balance(uuid, numeric, text),
  public.merge_merchants(uuid, uuid),
  public.recurrence_occurrences(date, public.recurrence_frequency, integer, date, date, date),
  public.next_due_date(public.recurring_transactions),
  public.post_recurring_occurrence(uuid, date, numeric, uuid),
  public.skip_recurring_occurrence(uuid, date),
  public.post_due_recurring(),
  public.capture_net_worth_snapshot(),
  public.budget_period_bounds(public.budget_period, date, date, date),
  public.get_budget_status(uuid, date),
  public.report_summary(date, date, text),
  public.report_by_category(date, date, public.category_kind, uuid, uuid, uuid),
  public.report_by_merchant(date, date, integer, uuid),
  public.report_by_account(date, date),
  public.report_time_series(date, date, text, uuid, uuid, uuid),
  public.merchant_stats(uuid),
  public.get_dashboard(date, date)
to authenticated;

-- Trigger functions still need EXECUTE for the role that fires the trigger.
grant execute on function
  public.tg_set_updated_at(),
  public.tg_accounts_before_write(),
  public.tg_transactions_balance(),
  public.tg_transactions_validate(),
  public.tg_recurring_validate(),
  public.tg_categories_validate(),
  public.tg_goals_before_write(),
  public.tg_goal_contributions_after(),
  public.tg_goal_contributions_validate()
to authenticated;

-- Future objects created by migrations should not be auto-exposed.
alter default privileges in schema public revoke execute on functions from public, anon;
