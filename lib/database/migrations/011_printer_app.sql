-- HavnLine Printer App: the tablet-app fallback for restaurants that
-- aren't (or don't want to be) connected to SpotOn. A tablet running
-- the HavnLine Printer app pairs with a business once, then polls for
-- confirmed orders and prints them directly on the restaurant's
-- existing kitchen printer over the local network — the same job
-- SpotOn's Orders API does when a business IS connected to it.
-- See lib/integrations/printer-app.ts.

-- Fast, no-extra-query check from the AI order flow (lib/ai/tools.ts),
-- mirroring how spoton_connected_at is already used on this table.
-- A business can take AI phone orders with neither this nor SpotOn
-- connected — orders just sit at status "confirmed" either way.
alter table public.businesses add column if not exists printer_app_paired_at timestamptz;

-- Short-lived pairing codes generated from the Integrations dashboard.
-- The owner shows a code on screen and types it into the tablet app
-- once; the app exchanges it for a permanent device_token and the
-- code itself is discarded. Expiring codes quickly means a code shown
-- on screen and never used can't be claimed later by someone else.
create table if not exists public.printer_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  code text not null unique,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists printer_pairing_codes_business_id_idx on public.printer_pairing_codes(business_id);

-- One paired tablet per business for now — re-pairing (e.g. after a
-- factory reset or replacing the tablet) overwrites this row rather
-- than piling up dead device rows, since only one device per business
-- is actually supported by the app today. device_token is the app's
-- long-lived credential for the polling/print-job endpoints below; it
-- never authenticates as the business owner.
create table if not exists public.printer_devices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  device_token text not null unique,
  printer_ip text,
  paired_at timestamptz not null default now(),
  last_seen_at timestamptz
);

-- The actual print queue. A row is created the moment an order is
-- confirmed and this business has no SpotOn connection; the tablet
-- app polls for "pending" rows, prints them, and reports back
-- printed/failed. ticket_text is the fully-formatted ticket (same
-- content a kitchen printer would show via SpotOn) rather than raw
-- order data, so the app doesn't need its own copy of the formatting
-- logic or menu knowledge.
create table if not exists public.printer_print_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  ticket_text text not null,
  status text not null default 'pending' check (status in ('pending', 'printed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  printed_at timestamptz
);

create index if not exists printer_print_jobs_business_status_idx on public.printer_print_jobs(business_id, status);

-- Written and read exclusively by server-side code (the dashboard's
-- pairing-code generation) and the device-token-authenticated app API
-- routes — never directly by a business's own logged-in session or by
-- an anonymous client, both of which go through the service role key
-- or a hand-checked device_token instead of Supabase RLS.
alter table public.printer_pairing_codes enable row level security;
alter table public.printer_devices enable row level security;
alter table public.printer_print_jobs enable row level security;

create policy "No direct client access to printer pairing codes"
  on public.printer_pairing_codes for all
  using (false)
  with check (false);

create policy "No direct client access to printer devices"
  on public.printer_devices for all
  using (false)
  with check (false);

create policy "No direct client access to printer print jobs"
  on public.printer_print_jobs for all
  using (false)
  with check (false);
