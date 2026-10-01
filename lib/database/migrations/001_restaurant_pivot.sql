-- ============================================================================
-- HavnLine restaurant pivot — schema migration
--
-- Removes the generic service-business scheduling model (services,
-- appointments, business_hours-as-scheduler) and replaces it with a
-- restaurant order-taking model: menu items with modifiers/add-ons,
-- orders built by the AI during a call, and a SpotOn POS connection
-- so a confirmed order can actually be sent to the kitchen printer.
--
-- Run this against the MAIN HavnLine database (not the Sales Portfolio one).
-- Back up first if you have any real customer data in `services` or
-- `appointments` you want to keep for records — this migration drops
-- both tables outright, per your call to remove the old model entirely
-- rather than leave dead code/tables around.
--
-- Reconstructed into the repo's migration history after the fact —
-- this is the actual SQL that was run (saved from chat), captured
-- here so lib/database/migrations/ has a complete record starting
-- from the real schema baseline instead of jumping straight to 006.
-- The SpotOn columns/tables this introduces were later removed by
-- 012_remove_spoton.sql once the HavnLine Printer App replaced SpotOn
-- as the only path to the kitchen printer.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Drop the old service-business scheduling model
-- ----------------------------------------------------------------------------
drop table if exists appointments cascade;
drop table if exists services cascade;

-- business_hours stays — a restaurant still has open/close hours, they're
-- just no longer used to schedule appointments. We keep the table as-is.

-- ----------------------------------------------------------------------------
-- 2. SpotOn POS connection, on the business itself
-- ----------------------------------------------------------------------------
alter table businesses
  add column if not exists spoton_location_id text,
  add column if not exists spoton_access_token text,
  add column if not exists spoton_refresh_token text,
  add column if not exists spoton_token_expires_at timestamptz,
  add column if not exists spoton_connected_at timestamptz,
  add column if not exists spoton_menu_synced_at timestamptz;

comment on column businesses.spoton_access_token is
  'OAuth access token for the SpotOn Central API. Store encrypted at the app layer — this column holds ciphertext, never a raw token.';

-- ----------------------------------------------------------------------------
-- 3. Menu: categories, items, modifier groups, modifiers
-- ----------------------------------------------------------------------------
create table if not exists menu_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  category_id uuid references menu_categories(id) on delete set null,
  name text not null,
  description text,
  price_cents int not null,
  image_url text,
  is_active boolean not null default true,
  sort_order int not null default 0,

  -- Where this item's real data came from. "manual" and "import" items
  -- are NOT orderable by the AI until spoton_item_id is set — an order
  -- can't be submitted to SpotOn without a real SpotOn item to reference,
  -- so an unmapped item is a menu-page-only listing, not something the
  -- AI can actually put in an order.
  source text not null default 'manual' check (source in ('manual', 'import', 'spoton_sync')),
  spoton_item_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists menu_items_business_id_idx on menu_items(business_id);
create index if not exists menu_items_spoton_item_id_idx on menu_items(spoton_item_id);

-- A modifier GROUP is something like "Size" or "Toppings" — it has rules
-- about how many of its modifiers can/must be picked.
create table if not exists modifier_groups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  name text not null,
  is_required boolean not null default false,
  min_select int not null default 0,
  max_select int not null default 1,
  sort_order int not null default 0,
  spoton_modifier_group_id text,
  created_at timestamptz not null default now()
);

create index if not exists modifier_groups_menu_item_id_idx on modifier_groups(menu_item_id);

-- A single choice inside a group — e.g. "Large" (+$2.00) or "Extra cheese" (+$1.50).
create table if not exists modifiers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  modifier_group_id uuid not null references modifier_groups(id) on delete cascade,
  name text not null,
  price_delta_cents int not null default 0,
  is_active boolean not null default true,
  sort_order int not null default 0,
  spoton_modifier_id text,
  created_at timestamptz not null default now()
);

create index if not exists modifiers_modifier_group_id_idx on modifiers(modifier_group_id);

-- ----------------------------------------------------------------------------
-- 4. Orders: what the AI builds during a call, and submits to SpotOn
-- ----------------------------------------------------------------------------
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  call_id uuid references calls(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  customer_name text,
  phone text,

  status text not null default 'building' check (
    status in ('building', 'confirmed', 'submitted', 'failed', 'cancelled')
  ),

  fulfillment_type text not null default 'pickup' check (fulfillment_type in ('pickup')),
  subtotal_cents int not null default 0,
  tax_cents int not null default 0,
  total_cents int not null default 0,
  special_instructions text,

  -- Set once we've actually POSTed this to SpotOn's Orders API.
  spoton_order_id text,
  submitted_at timestamptz,
  submit_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_business_id_idx on orders(business_id);
create index if not exists orders_call_id_idx on orders(call_id);
create index if not exists orders_status_idx on orders(status);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  menu_item_id uuid references menu_items(id) on delete set null,
  -- Snapshot the name/price at order time so a later menu price change
  -- never rewrites the price of an order that's already been placed.
  item_name text not null,
  unit_price_cents int not null,
  quantity int not null default 1,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id) on delete cascade,
  modifier_id uuid references modifiers(id) on delete set null,
  modifier_name text not null,
  price_delta_cents int not null default 0
);

create index if not exists order_items_order_id_idx on order_items(order_id);
create index if not exists order_item_modifiers_order_item_id_idx on order_item_modifiers(order_item_id);

-- ----------------------------------------------------------------------------
-- 5. RLS — same ownership pattern as every other business-scoped table
-- ----------------------------------------------------------------------------
alter table menu_categories enable row level security;
alter table menu_items enable row level security;
alter table modifier_groups enable row level security;
alter table modifiers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_item_modifiers enable row level security;

create policy "menu_categories: members can manage their business's menu"
  on menu_categories for all
  using (business_id in (select business_id from business_members where user_id = auth.uid()))
  with check (business_id in (select business_id from business_members where user_id = auth.uid()));

create policy "menu_items: members can manage their business's menu"
  on menu_items for all
  using (business_id in (select business_id from business_members where user_id = auth.uid()))
  with check (business_id in (select business_id from business_members where user_id = auth.uid()));

create policy "modifier_groups: members can manage their business's menu"
  on modifier_groups for all
  using (business_id in (select business_id from business_members where user_id = auth.uid()))
  with check (business_id in (select business_id from business_members where user_id = auth.uid()));

create policy "modifiers: members can manage their business's menu"
  on modifiers for all
  using (business_id in (select business_id from business_members where user_id = auth.uid()))
  with check (business_id in (select business_id from business_members where user_id = auth.uid()));

create policy "orders: members can view/manage their business's orders"
  on orders for all
  using (business_id in (select business_id from business_members where user_id = auth.uid()))
  with check (business_id in (select business_id from business_members where user_id = auth.uid()));

create policy "order_items: members can view their business's order items"
  on order_items for all
  using (order_id in (
    select id from orders where business_id in (
      select business_id from business_members where user_id = auth.uid()
    )
  ))
  with check (order_id in (
    select id from orders where business_id in (
      select business_id from business_members where user_id = auth.uid()
    )
  ));

create policy "order_item_modifiers: members can view their business's order item modifiers"
  on order_item_modifiers for all
  using (order_item_id in (
    select oi.id from order_items oi
    join orders o on o.id = oi.order_id
    where o.business_id in (select business_id from business_members where user_id = auth.uid())
  ))
  with check (order_item_id in (
    select oi.id from order_items oi
    join orders o on o.id = oi.order_id
    where o.business_id in (select business_id from business_members where user_id = auth.uid())
  ));
