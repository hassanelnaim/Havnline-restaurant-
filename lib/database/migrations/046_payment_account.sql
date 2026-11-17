-- 046: which Stripe account each payment was made on. Restaurants now get
-- full-dashboard Stripe accounts (Stripe stopped direct charges on legacy
-- Express accounts for new platforms), and one that reconnects gets a new
-- account. Orders and add-on charges paid on the old one keep its id here,
-- so their refunds, voids and Stripe events still go to the right account.
-- Existing payments are stamped with their restaurant's current account.
-- Safe to run more than once.
alter table public.orders add column if not exists stripe_connect_account_id text;
alter table public.order_addendum_charges add column if not exists stripe_connect_account_id text;

update public.orders o
   set stripe_connect_account_id = b.stripe_connect_account_id
  from public.businesses b
 where o.business_id = b.id
   and o.stripe_connect_account_id is null
   and o.stripe_checkout_session_id is not null
   and b.stripe_connect_account_id is not null;

update public.order_addendum_charges a
   set stripe_connect_account_id = b.stripe_connect_account_id
  from public.businesses b
 where a.business_id = b.id
   and a.stripe_connect_account_id is null
   and a.stripe_checkout_session_id is not null
   and b.stripe_connect_account_id is not null;

-- The admin Health page's migration check now includes 046.
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
    'tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    ), '[]'::jsonb)
  );
$$;
