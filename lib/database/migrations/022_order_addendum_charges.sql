-- Pending QR-pay item additions (Phase 4 of the tablet redesign — "Add
-- Items / comp-or-charge-via-QR flow"). Mirrors the "building" order
-- deferred-until-paid pattern from confirm_and_place_order (see
-- lib/ai/tools.ts): nothing here becomes a real order_items /
-- order_item_modifiers row until Stripe actually confirms payment via
-- the Connect webhook (app/api/webhooks/stripe-connect/route.ts,
-- branching on session.metadata.addendum_id). A COMPED addition never
-- creates a row here at all — it's inserted straight into order_items
-- with unit_price_cents = 0 (see app/api/printer-app/today-orders/[id]/items),
-- since there's no payment to wait on.
--
-- items is a JSONB snapshot of the pending item + modifiers (names and
-- prices locked in at the moment the QR was generated), not a live
-- reference to menu_items/modifiers — the menu could change, or an
-- item/modifier could be deleted, in the few minutes a customer takes
-- to scan and pay. The webhook inserts exactly this snapshot once paid,
-- the same way a Checkout Session's own line item locks in a price.
--
-- device_id uses "on delete set null", not "cascade" — same reasoning
-- as tablet_money_actions (020/021): unpairing a tablet mid-charge
-- shouldn't orphan the Stripe session or lose the record of what was
-- being paid for.
create table if not exists public.order_addendum_charges (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  device_id uuid references public.printer_devices(id) on delete set null,
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment', 'paid', 'expired', 'failed')),
  items jsonb not null,
  amount_cents integer not null,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists order_addendum_charges_order_idx on public.order_addendum_charges(order_id);
create index if not exists order_addendum_charges_business_idx on public.order_addendum_charges(business_id, created_at desc);
create index if not exists order_addendum_charges_session_idx on public.order_addendum_charges(stripe_checkout_session_id);

alter table public.order_addendum_charges enable row level security;

-- Same "members can view their business's X" pattern as
-- tablet_money_actions — an owner should be able to see pending/past
-- QR item-additions from the dashboard too, even though nothing writes
-- this table except the service role (the items route and the Connect
-- webhook).
create policy "order_addendum_charges: members can view their business's addendum charges"
  on public.order_addendum_charges for select
  using (business_id in (select business_id from business_members where user_id = auth.uid()));
