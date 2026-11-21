-- 050: HavnLine pausing the AI order-taker for updates (Admin > Pause AI).
-- A pause covers one or more restaurants from starts_at until ends_at (or
-- until someone resumes it). The call webhook checks it on every call, so
-- a scheduled pause begins and ends on the minute with no cron job.
-- While paused, calls ring the restaurant's own phone instead of the AI.
-- It never touches ai_receptionists.status, so resuming leaves each
-- restaurant exactly as it was. Safe to run more than once.

create table if not exists public.ai_pauses (
  id uuid primary key default gen_random_uuid(),
  -- Set by the admin page for each pause, so a double click can't make two.
  create_key text not null unique,
  starts_at timestamptz not null,
  -- Null: paused until someone resumes it by hand.
  ends_at timestamptz,
  reason text check (reason is null or char_length(reason) <= 300),
  -- Who it covers, in words, for the admin list ("All restaurants", "On trial").
  audience text not null,
  -- The message sent with it, if any (Admin > Messages).
  message_id uuid references public.platform_messages(id) on delete set null,
  -- Cancelled before it started, or resumed early for everyone.
  cancelled_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.ai_pause_targets (
  pause_id uuid not null references public.ai_pauses(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- One restaurant resumed early while the rest stay paused.
  resumed_at timestamptz,
  primary key (pause_id, business_id)
);

-- The call webhook's lookup: this restaurant's pauses that haven't been lifted for it.
create index if not exists ai_pause_targets_open
  on public.ai_pause_targets (business_id) where resumed_at is null;

-- Only the server reads and writes these (it checks who the viewer is first).
alter table public.ai_pauses enable row level security;
alter table public.ai_pause_targets enable row level security;
revoke all on public.ai_pauses from anon, authenticated;
revoke all on public.ai_pause_targets from anon, authenticated;

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
    'tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    ), '[]'::jsonb)
  );
$$;
