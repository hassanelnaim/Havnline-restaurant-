-- 048: fixes found by the full simulation sweep.
-- Safe to run more than once.

-- 1. Saved phrase audio (tts_audio_cache) had no row security, so the public
--    key every browser receives could read, add or overwrite the clips callers
--    hear. Only the server (service role) uses this table.
alter table public.tts_audio_cache enable row level security;
revoke all on public.tts_audio_cache from anon, authenticated;

-- 2. The subscription webhook and the Billing/Admin pages use this column, but
--    no migration created it. On a database without it every subscription
--    update failed, so a new restaurant never became trialing or active.
alter table public.businesses add column if not exists cancel_at_period_end boolean not null default false;

-- 3. A phone number belongs to one restaurant. Nothing stopped two connected
--    rows from holding the same number, and calls would then go to either one.
--    Created only when no duplicates exist (otherwise it says so and skips).
do $$
begin
  if exists (
    select 1 from public.integrations
    where provider = 'twilio' and status = 'connected' and metadata->>'phone_number' is not null
    group by metadata->>'phone_number' having count(*) > 1
  ) then
    raise notice 'Two restaurants share a phone number, so the one-number-per-restaurant rule was not added. Fix the duplicate, then run this file again.';
  else
    create unique index if not exists integrations_one_restaurant_per_number
      on public.integrations ((metadata->>'phone_number'))
      where provider = 'twilio' and status = 'connected' and metadata->>'phone_number' is not null;
  end if;
end $$;

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
    'tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    ), '[]'::jsonb)
  );
$$;
