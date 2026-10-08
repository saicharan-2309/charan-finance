-- =============================================================================
-- BUD logo palette for stored colours
-- =============================================================================
-- The app's colours now come from the official BUD logo (navy, blues, cyan,
-- coral, peach — see src/theme/tokens.ts) instead of the earlier greens.
--
-- * Default categories still on the colour the app gave them move to a logo
--   colour chosen for that category.
-- * Anything else — payment methods, goals, loans, other categories — that is
--   still exactly one of the old swatches moves to the matching new swatch
--   (Green → Blue, Mint → Cyan, Plum → Rose, …, keeping standard vs deeper).
-- * Any other colour is the user's own and is left alone.
--
-- Additive and idempotent: only exact old values are rewritten, so running it
-- again changes nothing. New users get the logo colours straight away.
-- =============================================================================

create or replace function public.apply_logo_colours(p_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 1. Default categories, by name, from the colour the app gave them.
  update public.transaction_categories c
  set color = v.new
  from (values
    ('Food',           '#A65F38', '#BE5228'),
    ('Groceries',      '#2F7A64', '#0E76A8'),
    ('Restaurants',    '#A65F38', '#D2304E'),
    ('Shopping',       '#6E4C67', '#B4436C'),
    ('Transport',      '#2B6F78', '#1260E8'),
    ('Fuel',           '#2B6F78', '#1A3FAC'),
    ('Travel',         '#4F7A73', '#0E76A8'),
    ('Entertainment',  '#6E4C67', '#4B47C2'),
    ('Bills',          '#806640', '#93650F'),
    ('Utilities',      '#806640', '#93650F'),
    ('Rent',           '#3E4F5A', '#0B1A45'),
    ('Healthcare',     '#A65F38', '#D2304E'),
    ('Fitness',        '#5E7A3A', '#1260E8'),
    ('Education',      '#3E4F5A', '#4B47C2'),
    ('Subscriptions',  '#6E4C67', '#B4436C'),
    ('Insurance',      '#2F5E52', '#4A5272'),
    ('Personal Care',  '#6E4C67', '#B4436C'),
    ('Gifts',          '#A65F38', '#BE5228'),
    ('Investments',    '#2F5E52', '#1A3FAC'),
    ('Other',          '#4F7A73', '#4A5272'),
    ('Salary',         '#2F7A64', '#1260E8'),
    ('Bonus',          '#2F7A64', '#1260E8'),
    ('Freelance',      '#2B6F78', '#0E76A8'),
    ('Interest',       '#2F5E52', '#1A3FAC'),
    ('Dividends',      '#3E4F5A', '#4B47C2'),
    ('Refunds',        '#806640', '#93650F'),
    ('Gifts Received', '#6E4C67', '#B4436C'),
    ('Other Income',   '#4F7A73', '#4A5272'),
    ('Loans & EMI',    '#3E4F5A', '#0B1A45')
  ) as v(name, old, new)
  where c.name = v.name
    and c.parent_id is null
    and upper(c.color) = v.old
    and (p_user_id is null or c.user_id = p_user_id);

  -- 2. Subcategories still on an old swatch follow their parent.
  update public.transaction_categories sc
  set color = p.color
  from public.transaction_categories p
  where sc.parent_id = p.id
    and sc.user_id = p.user_id
    and (p_user_id is null or sc.user_id = p_user_id)
    and upper(sc.color) in (
      '#2F5E52', '#163631', '#4E7363', '#2F4D41', '#2F7A64', '#1D5646', '#4F7A73', '#30524D',
      '#2B6F78', '#1A4E55', '#3E4F5A', '#26333B', '#17292F', '#0C181C', '#5E7A3A', '#3D5222',
      '#A65F38', '#7A4224', '#806640', '#5A4528', '#6E4C67', '#4D3348');

  -- 3. Everything else still on an old swatch → the matching new swatch.
  create temporary table if not exists _swatch_map (old text primary key, new text not null) on commit drop;
  truncate _swatch_map;
  insert into _swatch_map values
    ('#2F5E52', '#1260E8'), ('#163631', '#0B3FA6'),  -- Green  → Blue
    ('#4E7363', '#1A3FAC'), ('#2F4D41', '#0F2672'),  -- Sage   → Royal
    ('#2F7A64', '#0E76A8'), ('#1D5646', '#0A5278'),  -- Mint   → Cyan
    ('#4F7A73', '#4A5272'), ('#30524D', '#2C3250'),  -- Silver → Slate
    ('#2B6F78', '#4B47C2'), ('#1A4E55', '#2E2A8A'),  -- Teal   → Indigo
    ('#3E4F5A', '#0B1A45'), ('#26333B', '#040B24'),  -- Slate  → Navy
    ('#17292F', '#2B2F3A'), ('#0C181C', '#15171D'),  -- Ink    → Graphite
    ('#5E7A3A', '#D2304E'), ('#3D5222', '#9E2138'),  -- Moss   → Coral
    ('#A65F38', '#BE5228'), ('#7A4224', '#8E3A1A'),  -- Copper → Peach
    ('#806640', '#93650F'), ('#5A4528', '#6B480A'),  -- Sand   → Gold
    ('#6E4C67', '#B4436C'), ('#4D3348', '#83284B');  -- Plum   → Rose

  update public.transaction_categories t set color = m.new
  from _swatch_map m where upper(t.color) = m.old and (p_user_id is null or t.user_id = p_user_id);
  update public.accounts t set color = m.new
  from _swatch_map m where upper(t.color) = m.old and (p_user_id is null or t.user_id = p_user_id);
  update public.savings_goals t set color = m.new
  from _swatch_map m where upper(t.color) = m.old and (p_user_id is null or t.user_id = p_user_id);
  update public.loans t set color = m.new
  from _swatch_map m where upper(t.color) = m.old and (p_user_id is null or t.user_id = p_user_id);
end;
$$;
revoke all on function public.apply_logo_colours(uuid) from public, anon, authenticated;

-- Everyone who already has data.
select public.apply_logo_colours(null);

-- New users: default categories get the logo colours straight away.
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
  perform public.apply_logo_colours(new.id);
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public;
