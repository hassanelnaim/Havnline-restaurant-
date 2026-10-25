-- 042: possible Terms violations found by HavnLine's compliance checks
-- (lib/compliance/checks.ts), shown on the admin Health page and emailed to
-- the platform admin. One row per finding; dedupe_key stops the same
-- finding being recorded (and emailed) twice. Safe to run more than once.
create table if not exists public.compliance_flags (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  kind text not null,
  dedupe_key text not null unique,
  title text not null,
  detail text,
  evidence text,
  call_id uuid,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz
);
create index if not exists compliance_flags_open_idx on public.compliance_flags (created_at desc) where dismissed_at is null;
create index if not exists compliance_flags_business_kind_idx on public.compliance_flags (business_id, kind, created_at desc);
alter table public.compliance_flags enable row level security;

-- The admin Health page's migration check now includes 042.
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
    'tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    ), '[]'::jsonb)
  );
$$;
