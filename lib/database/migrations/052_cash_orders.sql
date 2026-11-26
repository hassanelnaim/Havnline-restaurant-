-- 052: cash at pickup, no-shows, and HavnLine's 3% on cash orders.
--
-- A phone order is paid one of two ways (orders.payment_method):
--   card  the texted payment link, as before (payment_status goes
--         awaiting_payment -> paid; the kitchen prints once it's paid)
--   cash  paid at pickup: prints straight away with "COLLECT $X" on the
--         ticket, payment_status 'not_required' (the existing pay-at-pickup
--         value, which sales reports already count) until staff tap
--         "Paid in cash" on the tablet, then 'paid'.
-- "No-show" on the tablet cancels the order, and that phone number can
-- only pay by card from then on (customers.card_only_since), until the
-- restaurant clears it.
-- HavnLine's fee on a cash order (cash_fee_cents, 3% by default) is added
-- to the restaurant's next monthly invoice by a nightly job; no-shows and
-- cancelled orders are never charged. Safe to run more than once.

alter table public.orders add column if not exists payment_method text;
alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check check (payment_method is null or payment_method in ('card', 'cash'));
alter table public.orders add column if not exists cash_collected_at timestamptz;
alter table public.orders add column if not exists no_show_at timestamptz;
alter table public.orders add column if not exists cash_fee_cents integer;
alter table public.orders add column if not exists cash_fee_billed_at timestamptz;
alter table public.orders add column if not exists cash_fee_invoice_item text;

-- The nightly fee job's lookup: cash orders not billed yet.
create index if not exists orders_cash_fee_unbilled
  on public.orders (business_id, created_at)
  where payment_method = 'cash' and cash_fee_billed_at is null;

-- Restaurant settings: cash on by default, no limit unless they set one.
alter table public.businesses add column if not exists accepts_cash boolean not null default true;
alter table public.businesses add column if not exists cash_max_cents integer
  check (cash_max_cents is null or cash_max_cents > 0);

-- A caller who didn't pick up a cash order pays by card from then on.
alter table public.customers add column if not exists card_only_since timestamptz;

-- Admin > Health: recognise this migration.
create or replace function public.admin_schema_check()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'm032', not exists (select 1 from pg_policies where schemaname = 'public' and cmd <> 'SELECT'),
    'm033', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'payment_link_sms_status'),
    'm034', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'rate_limit_hit'),
    'm035', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'printer_devices' and column_name = 'device_token_hash'),
    'm036', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'claim_print_jobs'),
    'm037', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'calls' and column_name = 'twilio_call_sid'),
    'm038', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'printer_print_jobs' and column_name = 'handled_at'),
    'm039', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'purge_old_call_messages'),
    'm040', exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'sms_consents'),
    'm041', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'fee_return_owed_cents'),
    'm042', exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'compliance_flags'),
    'm043', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'businesses' and column_name = 'texting_entity_type'),
    'm044', exists (select 1 from pg_constraint where conname = 'businesses_ein_format' and pg_get_constraintdef(oid) like '%enc:v1:%'),
    'm045', exists (select 1 from pg_constraint where conname = 'calls_outcome_check' and pg_get_constraintdef(oid) like '%order_placed%'),
    'm046', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'stripe_connect_account_id'),
    'm047', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'pay_token'),
    'm048', exists (select 1 from pg_class where relname = 'tts_audio_cache' and relrowsecurity)
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'businesses' and column_name = 'cancel_at_period_end'),
    'm049', to_regclass('public.platform_message_recipients') is not null,
    'm050', to_regclass('public.ai_pause_targets') is not null,
    'm051', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'businesses' and column_name = 'ready_minutes')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_receptionists' and column_name = 'ordering_rules'),
    'm052', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'payment_method'),
    'tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    ), '[]'::jsonb)
  );
$$;
