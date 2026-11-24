-- 051: how long orders usually take, by order size (Settings > Ready
-- times). The AI tells callers the range once their order is placed.
-- Null means the defaults in lib/ai/readyTime.ts (1-3 items 10-15 min,
-- 4-7 items 15-25, 8 or more 25-35). Safe to run more than once.

alter table public.businesses add column if not exists ready_minutes jsonb;

-- The AI page's "ordering rules" box saves here, but no earlier migration
-- or schema.sql created the column, so on a database built from them
-- saving the AI page failed ("Could not save your AI employee's
-- settings"). Adds it if it's missing; does nothing if it's there.
alter table public.ai_receptionists add column if not exists ordering_rules text;

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
    'tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    ), '[]'::jsonb)
  );
$$;
