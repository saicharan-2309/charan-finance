-- =============================================================================
-- Charan Finance — core schema
-- =============================================================================
-- Conventions
--   * UUID primary keys (gen_random_uuid()).
--   * Money is NUMERIC(18,2) — never float. Currency is stored explicitly (ISO 4217).
--   * Every user-owned row carries user_id (default auth.uid()).
--   * Cross-table references use COMPOSITE foreign keys (child_id, user_id) ->
--     parent(id, user_id). Postgres FK checks bypass RLS, so a plain FK would let
--     user A reference user B's account id. The composite FK makes that impossible
--     at the database level.
--   * Timestamps: created_at / updated_at (timestamptz).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------
create type public.account_type as enum (
  'bank', 'savings', 'cash', 'credit_card', 'debit_card', 'wallet',
  'investment', 'loan', 'other_asset', 'other_liability'
);

-- 'adjustment' is a signed balance correction (reconciliation, manual investment
-- revaluation). It never counts as income or expense in any report.
create type public.txn_type as enum ('expense', 'income', 'transfer', 'adjustment');

create type public.category_kind as enum ('expense', 'income');

create type public.spend_class as enum ('essential', 'discretionary');

create type public.recurrence_frequency as enum ('daily', 'weekly', 'monthly', 'quarterly', 'yearly');

create type public.recurring_kind as enum ('general', 'bill', 'subscription');

create type public.budget_period as enum ('weekly', 'monthly', 'yearly', 'custom');

-- ---------------------------------------------------------------------------
-- Domains
-- ---------------------------------------------------------------------------
create domain public.currency_code as char(3) check (value ~ '^[A-Z]{3}$');
create domain public.money_amount as numeric(18, 2);

-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Liability account types (balances are negative when money is owed).
create or replace function public.is_liability(t public.account_type)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select t in ('credit_card', 'loan', 'other_liability');
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  display_name      text check (char_length(display_name) <= 80),
  default_currency  public.currency_code not null default 'INR',
  timezone          text not null default 'Asia/Kolkata'
                    check (char_length(timezone) between 1 and 64),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- app_settings (one row per user)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  user_id                    uuid primary key references auth.users (id) on delete cascade,
  week_starts_on             smallint not null default 1 check (week_starts_on between 0 and 6),
  budget_warning_percent     smallint not null default 80 check (budget_warning_percent between 1 and 100),
  notify_upcoming_bills      boolean not null default true,
  notify_budget_warnings     boolean not null default true,
  notify_goal_reminders      boolean not null default false,
  notify_subscription_renewals boolean not null default true,
  notify_monthly_summary     boolean not null default true,
  bill_reminder_days_before  smallint not null default 1 check (bill_reminder_days_before between 0 and 14),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
create table public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                  text not null check (char_length(btrim(name)) between 1 and 60),
  type                  public.account_type not null,
  institution           text check (char_length(institution) <= 80),
  last4                 char(4) check (last4 ~ '^[0-9]{4}$'),
  currency              public.currency_code not null default 'INR',
  opening_balance       public.money_amount not null default 0,
  -- Maintained exclusively by triggers on transactions/accounts. Clients cannot write it.
  current_balance       public.money_amount not null default 0,
  credit_limit          public.money_amount check (credit_limit is null or credit_limit >= 0),
  is_active             boolean not null default true,
  include_in_net_worth  boolean not null default true,
  color                 text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon                  text check (char_length(icon) <= 40),
  notes                 text check (char_length(notes) <= 1000),
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, user_id)
);
create index accounts_user_idx on public.accounts (user_id, is_active, sort_order);
create unique index accounts_user_name_uq on public.accounts (user_id, lower(btrim(name)));
create trigger accounts_updated_at before update on public.accounts
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- transaction_categories (two levels: category -> subcategory)
-- ---------------------------------------------------------------------------
create table public.transaction_categories (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id       uuid,
  name            text not null check (char_length(btrim(name)) between 1 and 40),
  kind            public.category_kind not null default 'expense',
  classification  public.spend_class,
  icon            text check (char_length(icon) <= 40),
  color           text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_archived     boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, user_id),
  foreign key (parent_id, user_id) references public.transaction_categories (id, user_id) on delete restrict,
  check (parent_id is null or parent_id <> id)
);
create index categories_user_idx on public.transaction_categories (user_id, kind, is_archived);
create index categories_parent_idx on public.transaction_categories (parent_id);
create unique index categories_name_uq on public.transaction_categories
  (user_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, lower(btrim(name)));
create trigger categories_updated_at before update on public.transaction_categories
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- merchants
-- ---------------------------------------------------------------------------
create table public.merchants (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                 text not null check (char_length(btrim(name)) between 1 and 80),
  normalized_name      text generated always as (lower(btrim(name))) stored,
  default_category_id  uuid,
  is_archived          boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, normalized_name),
  foreign key (default_category_id, user_id)
    references public.transaction_categories (id, user_id) on delete set null (default_category_id)
);
create trigger merchants_updated_at before update on public.merchants
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- recurring_transactions (templates — never counted as real transactions)
-- ---------------------------------------------------------------------------
create table public.recurring_transactions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                  text not null check (char_length(btrim(name)) between 1 and 80),
  type                  public.txn_type not null check (type <> 'adjustment'),
  kind                  public.recurring_kind not null default 'general',
  amount                public.money_amount not null check (amount > 0),
  currency              public.currency_code not null default 'INR',
  account_id            uuid not null,
  to_account_id         uuid,
  category_id           uuid,
  subcategory_id        uuid,
  merchant_id           uuid,
  notes                 text check (char_length(notes) <= 1000),
  frequency             public.recurrence_frequency not null,
  interval_count        smallint not null default 1 check (interval_count between 1 and 52),
  start_date            date not null,
  end_date              date,
  -- Last occurrence that was posted or skipped. Next due is derived from the schedule.
  last_occurrence_date  date,
  auto_post             boolean not null default false,
  remind_days_before    smallint not null default 1 check (remind_days_before between 0 and 30),
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, user_id),
  check (end_date is null or end_date >= start_date),
  check (last_occurrence_date is null or last_occurrence_date >= start_date),
  check ((type = 'transfer') = (to_account_id is not null)),
  check (to_account_id is null or to_account_id <> account_id),
  check (type = 'transfer' or category_id is not null),
  check (type <> 'transfer' or (category_id is null and subcategory_id is null)),
  check (subcategory_id is null or category_id is not null),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  foreign key (to_account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.transaction_categories (id, user_id) on delete restrict,
  foreign key (subcategory_id, user_id) references public.transaction_categories (id, user_id) on delete restrict,
  foreign key (merchant_id, user_id) references public.merchants (id, user_id) on delete set null (merchant_id)
);
create index recurring_user_idx on public.recurring_transactions (user_id, is_active);
create trigger recurring_updated_at before update on public.recurring_transactions
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
create table public.transactions (
  -- Clients may supply the id (offline queue idempotency).
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type                   public.txn_type not null,
  amount                 public.money_amount not null,
  currency               public.currency_code not null,
  account_id             uuid not null,
  to_account_id          uuid,
  category_id            uuid,
  subcategory_id         uuid,
  merchant_id            uuid,
  occurred_at            timestamptz not null,
  notes                  text check (char_length(notes) <= 2000),
  recurring_id           uuid,
  recurring_occurrence   date,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (id, user_id),
  -- Amount sign rules
  check ((type = 'adjustment' and amount <> 0) or (type <> 'adjustment' and amount > 0)),
  -- Transfers need a distinct destination; nothing else may have one.
  check ((type = 'transfer') = (to_account_id is not null)),
  check (to_account_id is null or to_account_id <> account_id),
  -- Income/expense must be categorised; transfers/adjustments must not be.
  check ((type in ('expense', 'income')) = (category_id is not null)),
  check (subcategory_id is null or category_id is not null),
  -- recurring_occurrence is kept as history if the template is later deleted.
  check (recurring_id is null or recurring_occurrence is not null),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete restrict,
  foreign key (to_account_id, user_id) references public.accounts (id, user_id) on delete restrict,
  foreign key (category_id, user_id) references public.transaction_categories (id, user_id) on delete restrict,
  foreign key (subcategory_id, user_id) references public.transaction_categories (id, user_id) on delete restrict,
  foreign key (merchant_id, user_id) references public.merchants (id, user_id) on delete set null (merchant_id),
  foreign key (recurring_id, user_id) references public.recurring_transactions (id, user_id)
    on delete set null (recurring_id),
  -- A recurring occurrence can only ever be posted once.
  unique (recurring_id, recurring_occurrence)
);
create index transactions_user_time_idx on public.transactions (user_id, occurred_at desc, id desc);
create index transactions_account_idx on public.transactions (account_id, occurred_at desc);
create index transactions_to_account_idx on public.transactions (to_account_id) where to_account_id is not null;
create index transactions_category_idx on public.transactions (category_id, occurred_at desc);
create index transactions_subcategory_idx on public.transactions (subcategory_id) where subcategory_id is not null;
create index transactions_merchant_idx on public.transactions (merchant_id, occurred_at desc) where merchant_id is not null;
create index transactions_user_type_time_idx on public.transactions (user_id, type, occurred_at);
create trigger transactions_updated_at before update on public.transactions
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- tags
-- ---------------------------------------------------------------------------
create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 30),
  created_at  timestamptz not null default now(),
  unique (id, user_id)
);
create unique index tags_name_uq on public.tags (user_id, lower(btrim(name)));

create table public.transaction_tags (
  transaction_id  uuid not null,
  tag_id          uuid not null,
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (transaction_id, tag_id),
  foreign key (transaction_id, user_id) references public.transactions (id, user_id) on delete cascade,
  foreign key (tag_id, user_id) references public.tags (id, user_id) on delete cascade
);
create index transaction_tags_tag_idx on public.transaction_tags (tag_id);

-- ---------------------------------------------------------------------------
-- attachments (receipts). Files live in the private `receipts` storage bucket.
-- ---------------------------------------------------------------------------
create table public.attachments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  transaction_id  uuid,
  storage_path    text not null unique,
  mime_type       text not null check (mime_type in ('image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf')),
  size_bytes      integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  ocr_result      jsonb,
  created_at      timestamptz not null default now(),
  unique (id, user_id),
  -- Path must live under the owner's folder: <user_id>/...
  check (storage_path like user_id::text || '/%'),
  foreign key (transaction_id, user_id) references public.transactions (id, user_id) on delete cascade
);
create index attachments_transaction_idx on public.attachments (transaction_id);
create index attachments_user_idx on public.attachments (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- budgets & budget_items
-- ---------------------------------------------------------------------------
create table public.budgets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  period      public.budget_period not null default 'monthly',
  start_date  date not null,
  end_date    date,
  currency    public.currency_code not null default 'INR',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id),
  check ((period = 'custom') = (end_date is not null)),
  check (end_date is null or end_date >= start_date)
);
create index budgets_user_idx on public.budgets (user_id, is_active);
create trigger budgets_updated_at before update on public.budgets
  for each row execute function public.tg_set_updated_at();

create table public.budget_items (
  id           uuid primary key default gen_random_uuid(),
  budget_id    uuid not null,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- NULL category = overall spending limit for the budget.
  category_id  uuid,
  amount       public.money_amount not null check (amount > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (budget_id, user_id) references public.budgets (id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.transaction_categories (id, user_id) on delete cascade,
  unique nulls not distinct (budget_id, category_id)
);
create index budget_items_budget_idx on public.budget_items (budget_id);
create trigger budget_items_updated_at before update on public.budget_items
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- savings goals & contributions
-- ---------------------------------------------------------------------------
create table public.savings_goals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 60),
  description     text check (char_length(description) <= 500),
  target_amount   public.money_amount not null check (target_amount > 0),
  -- Amount already saved when the goal was created.
  initial_amount  public.money_amount not null default 0 check (initial_amount >= 0),
  -- Maintained by trigger: initial_amount + sum(contributions).
  current_amount  public.money_amount not null default 0,
  currency        public.currency_code not null default 'INR',
  target_date     date,
  account_id      uuid,
  icon            text check (char_length(icon) <= 40),
  color           text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_archived     boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete set null (account_id)
);
create index goals_user_idx on public.savings_goals (user_id, is_archived);
create trigger goals_updated_at before update on public.savings_goals
  for each row execute function public.tg_set_updated_at();

create table public.goal_contributions (
  id              uuid primary key default gen_random_uuid(),
  goal_id         uuid not null,
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount          public.money_amount not null check (amount <> 0),
  contributed_on  date not null default current_date,
  note            text check (char_length(note) <= 200),
  created_at      timestamptz not null default now(),
  foreign key (goal_id, user_id) references public.savings_goals (id, user_id) on delete cascade
);
create index goal_contributions_goal_idx on public.goal_contributions (goal_id, contributed_on);

-- ---------------------------------------------------------------------------
-- net worth snapshots
-- ---------------------------------------------------------------------------
create table public.net_worth_snapshots (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  snapshot_date  date not null,
  currency       public.currency_code not null,
  assets         public.money_amount not null check (assets >= 0),
  liabilities    public.money_amount not null check (liabilities >= 0),
  net_worth      public.money_amount generated always as (assets - liabilities) stored,
  breakdown      jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, snapshot_date, currency)
);
create trigger nws_updated_at before update on public.net_worth_snapshots
  for each row execute function public.tg_set_updated_at();
