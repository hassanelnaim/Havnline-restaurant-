-- Tablet money-PIN infrastructure — Phase 1 of the printer-app tablet
-- redesign (see the printer-app planning discussion). A single
-- 4-digit PIN per business, entered on the paired tablet before any
-- money-moving action (refund, discount — added in a later phase).
-- There's no per-staff identity system in this app, so this is
-- intentionally one shared PIN per business, not per-employee.
--
-- Kept in its own table rather than as columns on businesses, because
-- lib/data/business.ts's getBusiness() does a plain select("*") and
-- hands the whole row straight to a CLIENT component
-- (components/dashboard/settings-client.tsx) to render the Settings
-- page — a PIN hash living on businesses would ship to the browser on
-- every settings page load. This table is never touched by that
-- select, and the policy below blocks any direct client access
-- regardless (same pattern as printer_devices, printer_pairing_codes,
-- rate_limit_hits — read/written only via the service role key).
create table if not exists public.business_money_pins (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  pin_hash text not null,
  pin_salt text not null,
  set_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_money_pins enable row level security;

create policy "No direct client access to business money pins"
  on public.business_money_pins for all
  using (false)
  with check (false);
