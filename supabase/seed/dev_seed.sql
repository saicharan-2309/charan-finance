-- =============================================================================
-- DEVELOPMENT-ONLY demo data.  NOT a migration — never runs automatically.
-- =============================================================================
-- Usage (Supabase Dashboard → SQL Editor, on a DEVELOPMENT project only):
--   1. Sign up in the app with a throwaway demo account.
--   2. Run this whole file once (it creates the dev schema + function).
--   3. select dev.seed_demo_data('<demo user uuid from Authentication → Users>');
--
-- The function lives in the `dev` schema, which PostgREST does not expose, and
-- execute is revoked from app roles, so the mobile app can never call it.
-- It refuses to run for a user who already has transactions.
-- =============================================================================

create schema if not exists dev;
revoke all on schema dev from public;

create or replace function dev.seed_demo_data(p_user_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  bank uuid;
  savings uuid;
  cash uuid;
  upi uuid;
  card uuid;
  emi_schedule uuid;
  cat record;
  cats jsonb := '{}'::jsonb;
  m_names text[] := array['Swiggy', 'Zomato', 'Amazon', 'Flipkart', 'Uber', 'BigBasket', 'Netflix', 'Spotify', 'Nike', 'Cult.fit'];
  m_cats  text[] := array['Food',   'Restaurants', 'Shopping', 'Shopping', 'Transport', 'Groceries', 'Subscriptions', 'Subscriptions', 'Shopping', 'Fitness'];
  m_ids uuid[] := '{}';
  i integer;
  d integer;
  mid uuid;
  idx integer;
  acct uuid;
  day date;
  amt numeric(18, 2);
  card_spent numeric(18, 2);
  upi_spent numeric(18, 2);
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'User % not found', p_user_id;
  end if;
  if exists (select 1 from public.transactions where user_id = p_user_id) then
    raise exception 'User already has transactions — refusing to seed demo data';
  end if;

  perform public.create_default_categories(p_user_id);
  for cat in select id, name from public.transaction_categories where user_id = p_user_id and parent_id is null loop
    cats := cats || jsonb_build_object(cat.name, cat.id);
  end loop;

  -- A realistic mix of payment methods: two bank accounts, cash, a UPI app and
  -- a credit card with a billing cycle. Nothing here is special-cased.
  insert into public.accounts (user_id, name, type, institution, provider, last4, opening_balance,
                               sort_order, color, icon)
  values (p_user_id, 'HDFC Salary', 'bank', 'HDFC Bank', 'hdfc', '4821', 60000, 1, '#1F86C7',
          'business-outline')
  returning id into bank;
  insert into public.accounts (user_id, name, type, institution, provider, last4, opening_balance,
                               sort_order, color, icon)
  values (p_user_id, 'SBI Savings', 'savings', 'State Bank of India', 'sbi', '9182', 42800, 2, '#5A67C2',
          'business-outline')
  returning id into savings;
  insert into public.accounts (user_id, name, type, opening_balance, sort_order, color, icon)
  values (p_user_id, 'Cash', 'cash', 4000, 3, '#2F8A57', 'cash-outline')
  returning id into cash;
  insert into public.accounts (user_id, name, type, provider, opening_balance, sort_order, color, icon)
  values (p_user_id, 'Google Pay', 'wallet', 'gpay', 2300, 4, '#1F86C7', 'logo-google')
  returning id into upi;
  insert into public.accounts (user_id, name, type, institution, provider, last4, opening_balance,
                               credit_limit, statement_day, due_day, minimum_due, sort_order, color, icon)
  values (p_user_id, 'HDFC Credit Card', 'credit_card', 'HDFC Bank', 'hdfc', '9034', 0, 200000, 28, 12,
          5000, 5, '#C23F5E', 'card-outline')
  returning id into card;

  for i in 1 .. array_length(m_names, 1) loop
    insert into public.merchants (user_id, name, default_category_id)
    values (p_user_id, m_names[i], (cats ->> m_cats[i])::uuid)
    returning id into mid;
    m_ids := m_ids || mid;
  end loop;

  -- Six months of salary, rent and everyday spending. Nothing is dated in the
  -- future, and every balance stays believable: the card is paid off the
  -- following month, the UPI wallet is topped up from the bank, and cash
  -- comes from an ATM — all transfers, never income or expense.
  for d in 0 .. 5 loop
    day := (date_trunc('month', current_date) - make_interval(months => d))::date;
    card_spent := 0;
    upi_spent := 0;
    insert into public.transactions (user_id, type, amount, currency, account_id, category_id, occurred_at, notes)
    values (p_user_id, 'income', 125000, 'INR', bank, (cats ->> 'Salary')::uuid, day + time '09:00', 'Salary');
    if day + 4 <= current_date then
      insert into public.transactions (user_id, type, amount, currency, account_id, category_id, occurred_at, notes)
      values (p_user_id, 'expense', 25000, 'INR', bank, (cats ->> 'Rent')::uuid, day + 4 + time '10:00', 'Rent');
    end if;
    for i in 1 .. 18 loop
      idx := 1 + ((i * 7 + d * 3) % array_length(m_names, 1));
      -- Spread spending across every payment method, not just the card.
      acct := case (i % 5)
                when 0 then cash
                when 1 then card
                when 2 then upi
                when 3 then savings
                else bank
              end;
      if day + (i * 1.6)::integer <= current_date then
        amt := round((150 + ((i * 97 + d * 131) % 2400))::numeric, 2);
        insert into public.transactions (user_id, type, amount, currency, account_id, category_id, merchant_id, occurred_at)
        values (p_user_id, 'expense', amt, 'INR', acct,
                (cats ->> m_cats[idx])::uuid, m_ids[idx], day + (i * 1.6)::integer + time '13:30');
        if acct = card then card_spent := card_spent + amt; end if;
        if acct = upi then upi_spent := upi_spent + amt; end if;
      end if;
    end loop;
    -- Last month's card spend is paid in full early next month (a transfer).
    if d > 0 and day + interval '1 month' + interval '5 days' <= current_date and card_spent > 0 then
      insert into public.transactions (user_id, type, amount, currency, account_id, to_account_id, occurred_at, notes)
      values (p_user_id, 'transfer', card_spent, 'INR', bank, card,
              day + interval '1 month' + interval '5 days' + time '11:00', 'Card bill payment');
    end if;
    -- Top the UPI wallet back up, and draw cash at an ATM.
    if upi_spent > 0 then
      insert into public.transactions (user_id, type, amount, currency, account_id, to_account_id, occurred_at, notes)
      values (p_user_id, 'transfer', upi_spent, 'INR', bank, upi, day + 1 + time '08:00', 'Wallet top-up');
    end if;
    if day + 1 <= current_date then
      insert into public.transactions (user_id, type, amount, currency, account_id, to_account_id, occurred_at, notes)
      values (p_user_id, 'transfer', 5000, 'INR', bank, cash, day + 1 + time '18:00', 'ATM withdrawal');
    end if;
  end loop;

  insert into public.recurring_transactions (user_id, name, type, kind, amount, account_id, category_id, merchant_id, frequency, start_date)
  values
    (p_user_id, 'Netflix', 'expense', 'subscription', 649, card, (cats ->> 'Subscriptions')::uuid, m_ids[7], 'monthly', (date_trunc('month', current_date) + interval '14 days')::date),
    (p_user_id, 'Spotify', 'expense', 'subscription', 119, card, (cats ->> 'Subscriptions')::uuid, m_ids[8], 'monthly', (date_trunc('month', current_date) + interval '20 days')::date),
    (p_user_id, 'Rent', 'expense', 'bill', 25000, bank, (cats ->> 'Rent')::uuid, null, 'monthly', (date_trunc('month', current_date) + interval '1 month 4 days')::date),
    (p_user_id, 'Health Insurance', 'expense', 'bill', 18500, bank, (cats ->> 'Insurance')::uuid, null, 'yearly', (current_date + 40));

  insert into public.budgets (user_id, name, period, start_date)
  values (p_user_id, 'Monthly budget', 'monthly', date_trunc('month', current_date)::date);
  insert into public.budget_items (user_id, budget_id, category_id, amount)
  select p_user_id, b.id, (cats ->> x.name)::uuid, x.amount
  from public.budgets b,
       (values ('Food', 12000), ('Shopping', 10000), ('Transport', 5000), ('Entertainment', 4000)) as x(name, amount)
  where b.user_id = p_user_id;

  insert into public.savings_goals (user_id, name, target_amount, initial_amount, target_date, icon, color)
  values (p_user_id, 'MacBook', 120000, 72000, current_date + 150, 'laptop-outline', '#5A64C8');

  -- A car loan paid from the salary account, and a phone EMI on the credit
  -- card: the same model, two different payment methods.
  insert into public.recurring_transactions
    (user_id, name, type, kind, amount, account_id, category_id, frequency, start_date, remind_days_before)
  values (p_user_id, 'Car Loan', 'expense', 'bill', 18500, bank,
          coalesce((cats ->> 'Loans & EMI')::uuid, (cats ->> 'Other')::uuid), 'monthly',
          (date_trunc('month', current_date) + interval '14 days')::date, 3)
  returning id into emi_schedule;
  insert into public.loans (user_id, name, lender, principal_amount, emi_amount, interest_rate,
                            tenure_months, start_date, account_id, category_id, recurring_id, icon, color)
  values (p_user_id, 'Car Loan', 'HDFC Bank', 900000, 18500, 9.5, 60,
          (current_date - interval '8 months')::date, bank,
          coalesce((cats ->> 'Loans & EMI')::uuid, (cats ->> 'Other')::uuid), emi_schedule,
          'car-outline', '#6E5BB0');

  insert into public.recurring_transactions
    (user_id, name, type, kind, amount, account_id, category_id, frequency, start_date, remind_days_before)
  values (p_user_id, 'Phone EMI', 'expense', 'bill', 4200, card,
          coalesce((cats ->> 'Loans & EMI')::uuid, (cats ->> 'Other')::uuid), 'monthly',
          (date_trunc('month', current_date) + interval '7 days')::date, 3)
  returning id into emi_schedule;
  insert into public.loans (user_id, name, lender, principal_amount, emi_amount, interest_rate,
                            tenure_months, start_date, account_id, category_id, recurring_id, icon, color)
  values (p_user_id, 'Phone EMI', 'ICICI Bank', 50400, 4200, 13.0, 12,
          (current_date - interval '3 months')::date, card,
          coalesce((cats ->> 'Loans & EMI')::uuid, (cats ->> 'Other')::uuid), emi_schedule,
          'phone-portrait-outline', '#C03587');

  return 'Seeded demo data for ' || p_user_id;
end;
$$;

revoke all on function dev.seed_demo_data(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function dev.seed_demo_data(uuid) from anon, authenticated';
  end if;
end;
$$;
