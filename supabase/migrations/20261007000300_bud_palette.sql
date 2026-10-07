-- =============================================================================
-- BUD palette for categories
-- =============================================================================
-- The app's identity now comes from the BUD logo (see src/theme/tokens.ts):
-- greens and brushed silver, ink, and a few earthy companions. Categories
-- still on a factory colour — from either earlier palette — move to it; a
-- colour the user picked is left alone. New users start with it too.
-- Additive and idempotent.
-- =============================================================================

create or replace function public.apply_bud_category_colours(p_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.transaction_categories c
  set color = v.bud
  from (values
    ('Food',           '#D97757', '#C07F0A', '#A65F38'),
    ('Groceries',      '#4F9A6A', '#2F8A57', '#2F7A64'),
    ('Restaurants',    '#D4746B', '#C2502E', '#A65F38'),
    ('Shopping',       '#A97BB5', '#C03587', '#6E4C67'),
    ('Transport',      '#5B87C4', '#1F86C7', '#2B6F78'),
    ('Fuel',           '#4A8DA8', '#127F9E', '#2B6F78'),
    ('Travel',         '#4F9AA0', '#0A8F80', '#4F7A73'),
    ('Entertainment',  '#B07AC0', '#7A5CCB', '#6E4C67'),
    ('Bills',          '#C09A5B', '#A2541F', '#806640'),
    ('Utilities',      '#B8923F', '#B07A0E', '#806640'),
    ('Rent',           '#7C8FC0', '#5A67C2', '#3E4F5A'),
    ('Healthcare',     '#C97A86', '#C23F5E', '#A65F38'),
    ('Fitness',        '#52977F', '#3E8E3A', '#5E7A3A'),
    ('Education',      '#7C83C6', '#5A64C8', '#3E4F5A'),
    ('Subscriptions',  '#A97BC9', '#8B55C4', '#6E4C67'),
    ('Insurance',      '#4F9690', '#0F7F73', '#2F5E52'),
    ('Personal Care',  '#CC8192', '#B8478E', '#6E4C67'),
    ('Gifts',          '#C08A4F', '#C2703A', '#A65F38'),
    ('Investments',    '#4F9A6A', '#2F8A57', '#2F5E52'),
    ('Other',          '#8C8782', '#7B828C', '#4F7A73'),
    ('Salary',         '#4F9A6A', '#2F8A57', '#2F7A64'),
    ('Bonus',          '#4F9A6A', '#2F8A57', '#2F7A64'),
    ('Freelance',      '#4A8DA8', '#127F9E', '#2B6F78'),
    ('Interest',       '#4F9690', '#0F7F73', '#2F5E52'),
    ('Dividends',      '#7C83C6', '#5A64C8', '#3E4F5A'),
    ('Refunds',        '#C08A4F', '#C2703A', '#806640'),
    ('Gifts Received', '#A97BB5', '#C03587', '#6E4C67'),
    ('Other Income',   '#8C8782', '#7B828C', '#4F7A73'),
    ('Loans & EMI',    '#7C77C6', '#6E5BB0', '#3E4F5A')
  ) as v(name, old1, old2, bud)
  where c.name = v.name
    and upper(c.color) in (upper(v.old1), upper(v.old2))
    and (p_user_id is null or c.user_id = p_user_id);

  -- Subcategories still on a factory colour follow their parent.
  update public.transaction_categories sc
  set color = p.color
  from public.transaction_categories p
  where sc.parent_id = p.id
    and sc.user_id = p.user_id
    and (p_user_id is null or sc.user_id = p_user_id)
    and sc.color is distinct from p.color
    and upper(sc.color) in (
      '#D97757', '#D4746B', '#4F9A6A', '#A97BB5', '#5B87C4', '#4A8DA8', '#4F9AA0', '#B07AC0', '#C09A5B',
      '#B8923F', '#7C8FC0', '#C97A86', '#52977F', '#7C83C6', '#A97BC9', '#4F9690', '#7C77C6', '#CC8192',
      '#C08A4F', '#8C8782', '#8B7FC0',
      '#C07F0A', '#2F8A57', '#C2502E', '#C03587', '#1F86C7', '#127F9E', '#0A8F80', '#7A5CCB', '#A2541F',
      '#B07A0E', '#5A67C2', '#C23F5E', '#3E8E3A', '#5A64C8', '#8B55C4', '#0F7F73', '#B8478E', '#C2703A',
      '#7B828C', '#6E5BB0');
end;
$$;
revoke all on function public.apply_bud_category_colours(uuid) from public, anon, authenticated;

-- Everyone who already has categories.
select public.apply_bud_category_colours(null);

-- New users: their default categories get the BUD colours straight away.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80), ''))
  on conflict (id) do nothing;

  insert into public.app_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;

  perform public.create_default_categories(new.id);
  perform public.apply_bud_category_colours(new.id);
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public;
