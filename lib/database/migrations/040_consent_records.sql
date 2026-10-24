-- 040: proof of agreement, kept apart from the data that gets deleted.
-- Safe to run more than once.

-- 1. Which Terms and Privacy Policy each account accepted at signup, and
--    when. If there's ever a dispute, this shows exactly what a restaurant
--    agreed to (the arbitration clause included).
create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text,
  terms_version text not null,
  privacy_version text not null,
  accepted_at timestamptz not null default now(),
  ip text,
  user_agent text
);
create index if not exists terms_acceptances_user_idx on public.terms_acceptances (user_id, accepted_at desc);
alter table public.terms_acceptances enable row level security;

-- 2. Each caller's agreement to receive the payment-link text. Call
--    transcripts are deleted after 90 days, but a lawsuit over a text can
--    come years later, so this small record is kept for 4 years (the
--    federal texting law's filing window), then deleted by the nightly
--    cleanup. "evidence" is the caller's own words when they agreed.
create table if not exists public.sms_consents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  order_id uuid,
  call_id uuid,
  phone text not null,
  method text not null default 'verbal_on_call',
  evidence text,
  consented_at timestamptz not null default now()
);
create index if not exists sms_consents_business_phone_idx on public.sms_consents (business_id, phone, consented_at desc);
create index if not exists sms_consents_consented_idx on public.sms_consents (consented_at);
alter table public.sms_consents enable row level security;

-- The admin Health page's migration check now includes 040.
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
    'tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    ), '[]'::jsonb)
  );
$$;
