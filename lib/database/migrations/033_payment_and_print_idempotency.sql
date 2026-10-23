-- 033: make "paid -> printed -> texted" safe to run twice.
--
-- Stripe delivers webhook events at least once: the same payment can
-- arrive twice at the same moment, or again after a crash halfway through.
-- These columns let every step after a payment be claimed exactly once:
--
--   printer_print_jobs.kind / addendum_id  one kitchen ticket per order, and
--                                          one per tablet add-on charge
--                                          (unique indexes below)
--   printer_print_jobs.attempts            failed prints are retried a few
--                                          times before the owner is alerted
--   orders.payment_text_sent_at            the "Payment received" text is
--                                          sent once
--   orders.payment_link_sms_status         delivery status of the payment-
--                                          link text (Twilio status callback)
--   orders.payment_link_sms_error
--   orders.payment_link_url                the link, to re-text it
--   order_addendum_charges.items_added_at  add-on items are added once
--
-- Safe to run more than once. Existing duplicate tickets are kept (marked
-- as duplicates), never deleted.

alter table public.printer_print_jobs add column if not exists kind text not null default 'order';
alter table public.printer_print_jobs add column if not exists addendum_id uuid;
alter table public.printer_print_jobs add column if not exists attempts integer not null default 0;

-- Older add-on tickets were stored like order tickets; tell them apart by
-- their first line (see buildAddendumTicketText).
update public.printer_print_jobs
set kind = 'addendum'
where kind = 'order' and ticket_text like '%ADDITION TO ORDER #%';

-- Earlier duplicate order tickets (the bug this migration fixes): keep the
-- first, mark the rest so the unique index below can be created.
update public.printer_print_jobs j
set kind = 'order_duplicate'
where j.kind = 'order'
  and exists (
    select 1 from public.printer_print_jobs e
    where e.kind = 'order' and e.order_id = j.order_id
      and (e.created_at < j.created_at or (e.created_at = j.created_at and e.id < j.id))
  );

create unique index if not exists printer_print_jobs_one_ticket_per_order
  on public.printer_print_jobs (order_id) where kind = 'order';
create unique index if not exists printer_print_jobs_one_ticket_per_addendum
  on public.printer_print_jobs (addendum_id) where addendum_id is not null;

alter table public.orders add column if not exists payment_text_sent_at timestamptz;
alter table public.orders add column if not exists payment_link_sms_status text;
alter table public.orders add column if not exists payment_link_sms_error text;
-- The checkout link itself, so it can be re-texted to a different number
-- when the first text doesn't go through.
alter table public.orders add column if not exists payment_link_url text;

alter table public.order_addendum_charges add column if not exists items_added_at timestamptz;
-- Add-ons already paid before this migration already had their items added.
update public.order_addendum_charges set items_added_at = coalesce(paid_at, now())
where status = 'paid' and items_added_at is null;

-- Small indexes from the audit (X4).
create index if not exists calls_business_started_idx on public.calls (business_id, started_at desc);
create index if not exists customers_business_phone_idx on public.customers (business_id, phone);
create index if not exists usage_records_created_idx on public.usage_records (created_at);
