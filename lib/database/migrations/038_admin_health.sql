-- 038: what the admin Health page reads. Safe to run more than once.

-- 1. A row per run of each background job (nightly cleanup, weekly
--    digest), so the Health page can show when it last ran, what it did,
--    and turn red when it stops running.
create table if not exists public.cron_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  trigger text not null default 'schedule' check (trigger in ('schedule', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  result jsonb
);
create index if not exists cron_runs_job_started_idx on public.cron_runs (job, started_at desc);
alter table public.cron_runs enable row level security;

-- 2. Every platform alert, including the ones held back by the 15-minute
--    email throttle, so the Health page can count them.
create table if not exists public.platform_alerts (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  subject text not null,
  outcome text not null,
  created_at timestamptz not null default now()
);
create index if not exists platform_alerts_created_idx on public.platform_alerts (created_at desc);
alter table public.platform_alerts enable row level security;

-- 3. Failed kitchen tickets the admin has dealt with (called the
--    restaurant, etc.) drop off the Health page.
alter table public.printer_print_jobs add column if not exists handled_at timestamptz;

-- 4. Platform-wide time lookups for the Command Center charts.
create index if not exists calls_started_idx on public.calls (started_at desc);
create index if not exists orders_created_idx on public.orders (created_at desc);

-- Calls and orders per local day, across every business. Orders count the
-- same way as sales everywhere else (lib/orders/sales.ts).
create or replace function public.admin_daily_activity(p_days integer, p_tz text)
returns table (day date, calls bigint, orders bigint, sales_cents bigint)
language sql
stable
security definer
set search_path = public
as $$
  with days as (
    select generate_series(
      (now() at time zone p_tz)::date - (p_days - 1),
      (now() at time zone p_tz)::date,
      interval '1 day'
    )::date as day
  ),
  since as (
    select (((now() at time zone p_tz)::date - (p_days - 1))::timestamp at time zone p_tz) as t
  ),
  c as (
    select (started_at at time zone p_tz)::date as day, count(*) as n
    from public.calls, since
    where started_at >= since.t
    group by 1
  ),
  o as (
    select (created_at at time zone p_tz)::date as day, count(*) as n, coalesce(sum(total_cents), 0) as cents
    from public.orders, since
    where created_at >= since.t
      and status not in ('building', 'cancelled')
      and payment_status in ('paid', 'not_required')
    group by 1
  )
  select d.day, coalesce(c.n, 0), coalesce(o.n, 0), coalesce(o.cents, 0)::bigint
  from days d
  left join c on c.day = d.day
  left join o on o.day = d.day
  order by d.day;
$$;

-- Calls started in each hour of today (local), across every business.
create or replace function public.admin_calls_by_hour_today(p_tz text)
returns table (hour integer, calls bigint)
language sql
stable
security definer
set search_path = public
as $$
  with hours as (select generate_series(0, 23) as hour),
  c as (
    select extract(hour from started_at at time zone p_tz)::integer as hour, count(*) as n
    from public.calls
    where started_at >= (((now() at time zone p_tz)::date)::timestamp at time zone p_tz)
    group by 1
  )
  select h.hour, coalesce(c.n, 0)
  from hours h left join c on c.hour = h.hour
  order by h.hour;
$$;

-- The most calls on the line at the same moment between p_from and
-- p_to, and when that first happened. A call still in progress counts
-- until now (at most 2 hours, the same point the nightly cleanup gives up
-- on it); a finished one until started_at + duration_seconds.
create or replace function public.admin_peak_concurrent_calls(p_from timestamptz, p_to timestamptz)
returns table (peak integer, peak_at timestamptz, live_now integer)
language sql
stable
security definer
set search_path = public
as $$
  with spans as (
    select started_at as s,
           case when status = 'in_progress' then least(now(), started_at + interval '2 hours')
                else started_at + make_interval(secs => coalesce(duration_seconds, 0))
           end as e
    from public.calls
    where started_at < p_to and started_at >= p_from - interval '2 hours'
  ),
  events as (
    -- A call that began before the window and was still going counts from its start.
    select greatest(s, p_from) as t, 1 as d from spans where e > p_from and e > s
    union all
    select e as t, -1 as d from spans where e > p_from and e > s
  ),
  running as (
    select t, sum(d) over (order by t, d rows between unbounded preceding and current row) as n
    from events
  ),
  best as (
    select n, t from running where t <= p_to order by n desc, t asc limit 1
  )
  select coalesce((select n from best), 0)::integer,
         (select t from best),
         (select count(*) from public.calls
          where status = 'in_progress' and started_at > now() - interval '2 hours')::integer;
$$;

-- 5. One look at whether each earlier migration has been run, for the
--    Health page's setup checks. Reads the catalog only.
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
    'tables_without_rls', coalesce((
      select jsonb_agg(c.relname order by c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.admin_daily_activity(integer, text) from public, anon, authenticated;
revoke all on function public.admin_calls_by_hour_today(text) from public, anon, authenticated;
revoke all on function public.admin_peak_concurrent_calls(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_schema_check() from public, anon, authenticated;
grant execute on function public.admin_daily_activity(integer, text) to service_role;
grant execute on function public.admin_calls_by_hour_today(text) to service_role;
grant execute on function public.admin_peak_concurrent_calls(timestamptz, timestamptz) to service_role;
grant execute on function public.admin_schema_check() to service_role;
