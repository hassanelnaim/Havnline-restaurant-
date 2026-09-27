-- Prevents a print job from being handed to the tablet more than once
-- while it's still being worked on. Without this, a job that prints
-- successfully but fails to report back (a dropped connection right
-- after printing, the tablet app crashing mid-request) stays
-- "pending" forever and gets reprinted on every future poll until an
-- ack finally lands — see app/api/printer-app/orders/route.ts.
alter table public.printer_print_jobs
  add column if not exists claimed_at timestamptz;
