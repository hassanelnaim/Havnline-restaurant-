-- 049: messages from HavnLine to restaurants (Admin > Messages).
-- A message is written once and sent to many restaurants; each restaurant
-- gets its own recipient row, which records the email result and when
-- someone at the restaurant read it on their dashboard.
-- Safe to run more than once.

create table if not exists public.platform_messages (
  id uuid primary key default gen_random_uuid(),
  -- Set by the admin page for each send, so a double click can't send twice.
  send_key text not null unique,
  subject text not null check (char_length(subject) between 1 and 150),
  body text not null check (char_length(body) between 1 and 5000),
  -- Who it went to, in words, for the history list ("All restaurants", "Trialing").
  audience text not null,
  sent_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_message_recipients (
  message_id uuid not null references public.platform_messages(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  email_status text not null default 'pending' check (email_status in ('pending', 'sent', 'failed', 'no_email')),
  email_error text,
  emailed_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (message_id, business_id)
);

create index if not exists platform_message_recipients_unread
  on public.platform_message_recipients (business_id, created_at desc) where read_at is null;

-- Only the server reads and writes these (it checks who the viewer is first).
alter table public.platform_messages enable row level security;
alter table public.platform_message_recipients enable row level security;
revoke all on public.platform_messages from anon, authenticated;
revoke all on public.platform_message_recipients from anon, authenticated;

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
    'tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    ), '[]'::jsonb)
  );
$$;
