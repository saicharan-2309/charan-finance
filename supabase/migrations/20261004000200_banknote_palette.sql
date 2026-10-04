-- =============================================================================
-- Banknote palette for categories
-- =============================================================================
-- The app's colours now come from the inks of Indian banknotes (see
-- src/theme/tokens.ts). Category colours still at the previous factory
-- default move to the new palette; any colour the user picked is left alone.
-- New users get the new palette from the start. Additive and idempotent.
-- =============================================================================

update public.transaction_categories c
set color = v.new_color
from (values
  ('Food', '#D97757', '#C07F0A'),
  ('Groceries', '#4F9A6A', '#2F8A57'),
  ('Restaurants', '#D4746B', '#C2502E'),
  ('Shopping', '#A97BB5', '#C03587'),
  ('Transport', '#5B87C4', '#1F86C7'),
  ('Fuel', '#4A8DA8', '#127F9E'),
  ('Travel', '#4F9AA0', '#0A8F80'),
  ('Entertainment', '#B07AC0', '#7A5CCB'),
  ('Bills', '#C09A5B', '#A2541F'),
  ('Utilities', '#B8923F', '#B07A0E'),
  ('Rent', '#7C8FC0', '#5A67C2'),
  ('Healthcare', '#C97A86', '#C23F5E'),
  ('Fitness', '#52977F', '#3E8E3A'),
  ('Education', '#7C83C6', '#5A64C8'),
  ('Subscriptions', '#A97BC9', '#8B55C4'),
  ('Insurance', '#4F9690', '#0F7F73'),
  ('Personal Care', '#CC8192', '#B8478E'),
  ('Gifts', '#C08A4F', '#C2703A'),
  ('Investments', '#4F9A6A', '#2F8A57'),
  ('Other', '#8C8782', '#7B828C'),
  ('Salary', '#4F9A6A', '#2F8A57'),
  ('Bonus', '#4F9A6A', '#2F8A57'),
  ('Freelance', '#4A8DA8', '#127F9E'),
  ('Interest', '#4F9690', '#0F7F73'),
  ('Dividends', '#7C83C6', '#5A64C8'),
  ('Refunds', '#C08A4F', '#C2703A'),
  ('Gifts Received', '#A97BB5', '#C03587'),
  ('Other Income', '#8C8782', '#7B828C'),
  ('Loans & EMI', '#7C77C6', '#6E5BB0')
) as v(name, old_color, new_color)
where c.name = v.name
  and upper(c.color) = upper(v.old_color);

-- Subcategories follow their parent when they still carry a factory colour.
update public.transaction_categories sc
set color = p.color
from public.transaction_categories p
where sc.parent_id = p.id
  and sc.user_id = p.user_id
  and sc.color is distinct from p.color
  and upper(sc.color) in ('#D97757', '#D4746B', '#4F9A6A', '#A97BB5', '#5B87C4', '#4A8DA8', '#4F9AA0', '#B07AC0', '#C09A5B', '#B8923F', '#7C8FC0', '#C97A86', '#52977F', '#7C83C6', '#A97BC9', '#4F9690', '#7C77C6', '#CC8192', '#C08A4F', '#8C8782', '#8B7FC0');

create or replace function public.create_default_categories(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  parent_id uuid;
  sub text;
  i integer := 0;
begin
  if exists (select 1 from public.transaction_categories where user_id = p_user_id) then
    return;
  end if;

  for rec in
    select * from (values
      ('Food',           'expense', 'discretionary', 'fast-food-outline',     '#C07F0A', array['Snacks & Coffee', 'Food Delivery']),
      ('Groceries',      'expense', 'essential',     'basket-outline',        '#2F8A57', array[]::text[]),
      ('Restaurants',    'expense', 'discretionary', 'restaurant-outline',    '#C2502E', array[]::text[]),
      ('Shopping',       'expense', 'discretionary', 'bag-handle-outline',    '#C03587', array['Clothing', 'Electronics', 'Home']),
      ('Transport',      'expense', 'essential',     'car-outline',           '#1F86C7', array['Cab & Auto', 'Public Transport', 'Parking & Tolls']),
      ('Fuel',           'expense', 'essential',     'speedometer-outline',   '#127F9E', array[]::text[]),
      ('Travel',         'expense', 'discretionary', 'airplane-outline',      '#0A8F80', array['Flights', 'Hotels']),
      ('Entertainment',  'expense', 'discretionary', 'film-outline',          '#7A5CCB', array[]::text[]),
      ('Bills',          'expense', 'essential',     'receipt-outline',       '#A2541F', array[]::text[]),
      ('Utilities',      'expense', 'essential',     'flash-outline',         '#B07A0E', array['Electricity', 'Water', 'Gas', 'Mobile & Internet']),
      ('Rent',           'expense', 'essential',     'home-outline',          '#5A67C2', array[]::text[]),
      ('Healthcare',     'expense', 'essential',     'medkit-outline',        '#C23F5E', array['Medicines', 'Doctor']),
      ('Fitness',        'expense', 'discretionary', 'barbell-outline',       '#3E8E3A', array[]::text[]),
      ('Education',      'expense', 'essential',     'school-outline',        '#5A64C8', array[]::text[]),
      ('Subscriptions',  'expense', 'discretionary', 'repeat-outline',        '#8B55C4', array[]::text[]),
      ('Insurance',      'expense', 'essential',     'shield-checkmark-outline', '#0F7F73', array[]::text[]),
      ('Loans & EMI',    'expense', 'essential',     'calendar-number-outline',  '#6E5BB0', array[]::text[]),
      ('Personal Care',  'expense', 'discretionary', 'sparkles-outline',      '#B8478E', array[]::text[]),
      ('Gifts',          'expense', 'discretionary', 'gift-outline',          '#C2703A', array[]::text[]),
      ('Investments',    'expense', null,            'trending-up-outline',   '#2F8A57', array[]::text[]),
      ('Other',          'expense', null,            'ellipsis-horizontal-circle-outline', '#7B828C', array[]::text[]),
      ('Salary',         'income',  null,            'briefcase-outline',     '#2F8A57', array[]::text[]),
      ('Bonus',          'income',  null,            'trophy-outline',        '#2F8A57', array[]::text[]),
      ('Freelance',      'income',  null,            'laptop-outline',        '#127F9E', array[]::text[]),
      ('Interest',       'income',  null,            'cash-outline',          '#0F7F73', array[]::text[]),
      ('Dividends',      'income',  null,            'pie-chart-outline',     '#5A64C8', array[]::text[]),
      ('Refunds',        'income',  null,            'return-down-back-outline', '#C2703A', array[]::text[]),
      ('Gifts Received', 'income',  null,            'gift-outline',          '#C03587', array[]::text[]),
      ('Other Income',   'income',  null,            'add-circle-outline',    '#7B828C', array[]::text[])
    ) as v(name, kind, classification, icon, color, subs)
  loop
    i := i + 1;
    insert into public.transaction_categories (user_id, name, kind, classification, icon, color, sort_order)
    values (p_user_id, rec.name, rec.kind::public.category_kind, rec.classification::public.spend_class,
            rec.icon, rec.color, i)
    returning id into parent_id;

    foreach sub in array rec.subs loop
      insert into public.transaction_categories (user_id, parent_id, name, kind, classification, icon, color)
      values (p_user_id, parent_id, sub, rec.kind::public.category_kind,
              rec.classification::public.spend_class, rec.icon, rec.color);
    end loop;
  end loop;
end;
$$;
revoke all on function public.create_default_categories(uuid) from public;
