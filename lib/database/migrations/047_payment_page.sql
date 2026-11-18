-- 047: HavnLine's own payment page (havnline.com/pay/<token>) in place of
-- Stripe Checkout, so customers aren't asked for an email.
--  * pay_token: the secret part of an order's (or a tablet add-on's) payment
--    link. Long and random, so one link can't be guessed from another.
--  * payment_expires_at: when the link stops working (30 minutes).
--  * businesses.stripe_pm_domain_account: the restaurant Stripe account
--    havnline.com was registered on for Apple Pay and Google Pay.
-- Safe to run more than once.
alter table public.orders add column if not exists pay_token text;
alter table public.orders add column if not exists payment_expires_at timestamptz;
alter table public.order_addendum_charges add column if not exists pay_token text;
alter table public.order_addendum_charges add column if not exists payment_expires_at timestamptz;
alter table public.businesses add column if not exists stripe_pm_domain_account text;

create unique index if not exists orders_pay_token_key on public.orders(pay_token) where pay_token is not null;
create unique index if not exists order_addendum_charges_pay_token_key on public.order_addendum_charges(pay_token) where pay_token is not null;
-- The nightly sweep looks for links that ran out without being paid.
create index if not exists orders_payment_expiry_idx on public.orders(payment_expires_at) where payment_status = 'awaiting_payment';

-- The admin Health page's migration check now includes 047.
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
    'tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    ), '[]'::jsonb)
  );
$$;
