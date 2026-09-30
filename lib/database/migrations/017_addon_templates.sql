-- Shared add-on library. Today every modifier_groups row belongs to
-- exactly one menu_items row (menu_item_id is required) — adding
-- "Toppings" to 10 burgers means creating 10 separate copies, and
-- fixing "Cheese +$1" means editing all 10 separately.
--
-- This adds a second, additive way to attach a group to an item,
-- without touching how the existing one-off groups work at all:
--
-- 1. menu_item_id becomes nullable. A modifier_groups row with
--    menu_item_id = null and is_template = true is a reusable,
--    business-wide add-on group (e.g. "Toppings", "Size") that isn't
--    tied to any single item — it's edited once, in one place.
--
-- 2. menu_item_modifier_groups is a new join table that attaches a
--    template group to as many menu items as the owner wants.
--
-- Every existing modifier_groups row keeps menu_item_id set exactly as
-- it is today (is_template defaults to false) — nothing already in the
-- database changes meaning or behavior. lib/ai/context.ts and
-- lib/data/menu.ts read BOTH the direct menu_item_id link (old,
-- one-off groups) and this join table (new, shared templates) and
-- merge them into one modifier_groups list per item, so the AI and
-- the menu page see one combined list either way.

alter table public.modifier_groups
  alter column menu_item_id drop not null,
  add column if not exists is_template boolean not null default false;

create table if not exists public.menu_item_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  modifier_group_id uuid not null references public.modifier_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (menu_item_id, modifier_group_id)
);

create index if not exists menu_item_modifier_groups_menu_item_idx on public.menu_item_modifier_groups (menu_item_id);
create index if not exists menu_item_modifier_groups_group_idx on public.menu_item_modifier_groups (modifier_group_id);
create index if not exists modifier_groups_business_template_idx on public.modifier_groups (business_id) where is_template = true;
