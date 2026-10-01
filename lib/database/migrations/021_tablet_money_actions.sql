-- Audit trail for tablet-initiated money actions (refund/discount —
-- Phase 3 of the tablet redesign). Written only by
-- app/api/printer-app/orders/[id]/refund via the service role key,
-- right after a successful processOrderRefund call (see
-- lib/billing/orderRefund.ts) — never by a direct client write.
--
-- Unlike printer_devices/printer_pairing_codes/rate_limit_hits
-- (locked down entirely), this one allows business members read
-- access — same "members can view their business's X" pattern as
-- orders itself (001_restaurant_pivot.sql) — because the whole point
-- is a dashboard owner being able to see what staff did on the
-- tablet, including after the fact.
--
-- device_id intentionally has NO cascading delete tie to the order's
-- normal lifecycle, and uses "on delete set null" rather than
-- "cascade" on printer_devices — unpairing or replacing a tablet
-- (which hard-deletes its printer_devices row, see unpairDevice)
-- should never wipe out the audit history of what that tablet did
-- while it was paired.
create table if not exists public.tablet_money_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  device_id uuid references public.printer_devices(id) on delete set null,
  order_id uuid not null references public.orders(id) on delete cascade,
  action text not null check (action in ('refund', 'discount')),
  amount_cents integer not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists tablet_money_actions_business_idx on public.tablet_money_actions(business_id, created_at desc);
create index if not exists tablet_money_actions_order_idx on public.tablet_money_actions(order_id);

alter table public.tablet_money_actions enable row level security;

create policy "tablet_money_actions: members can view their business's tablet money actions"
  on public.tablet_money_actions for select
  using (business_id in (select business_id from business_members where user_id = auth.uid()));
