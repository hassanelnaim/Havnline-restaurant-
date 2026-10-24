-- 039: call transcripts are kept for 90 days, then deleted by the nightly
-- cleanup (lib/maintenance/cleanup.ts). Less stored conversation means
-- less exposure in a breach or a lawsuit, and it's what the Privacy
-- Policy promises callers. The call itself (date, length, outcome) and
-- any order stay; only the words are removed. Safe to run more than once.

create index if not exists call_messages_created_idx on public.call_messages (created_at);

-- Deletes up to p_limit transcript lines older than p_before, oldest first,
-- and says how many went. The cleanup calls it in a loop, so a large
-- backlog is cleared in small steps instead of one long delete.
create or replace function public.purge_old_call_messages(p_before timestamptz, p_limit integer default 5000)
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.call_messages
    where id in (
      select id from public.call_messages
      where created_at < p_before
      order by created_at
      limit p_limit
    )
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.purge_old_call_messages(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.purge_old_call_messages(timestamptz, integer) to service_role;

-- The admin Health page's migration check now includes 039.
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
    'tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    ), '[]'::jsonb)
  );
$$;
