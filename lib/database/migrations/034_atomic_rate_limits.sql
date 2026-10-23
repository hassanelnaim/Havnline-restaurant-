-- 034: rate limits that can't be raced.
--
-- The old limiter counted recent hits and then recorded one, in two
-- separate requests. Forty requests sent at the same moment all counted
-- before any recorded, so a limit of 10 let 33 through (audit simulation
-- 15). It also recorded attempts that were already blocked, so anyone who
-- kept sending could hold a limit shut indefinitely.
--
-- rate_limit_hit counts and records in one step, holding a lock on that
-- key while it does: only attempts that are let through are recorded.
-- rate_limit_count only reads (used to count failed logins and PINs, which
-- are recorded after the attempt with rate_limit_record).
--
-- Only the server (service role) may call these. Safe to run more than once.

create or replace function public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));
  select count(*) into recent
  from public.rate_limit_hits
  where rate_key = p_key and created_at >= now() - make_interval(secs => p_window_seconds);
  if recent >= p_max then
    return false;
  end if;
  insert into public.rate_limit_hits (rate_key) values (p_key);
  return true;
end;
$$;

create or replace function public.rate_limit_count(p_key text, p_window_seconds integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.rate_limit_hits
  where rate_key = p_key and created_at >= now() - make_interval(secs => p_window_seconds);
$$;

create or replace function public.rate_limit_record(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.rate_limit_hits (rate_key) values (p_key);
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.rate_limit_count(text, integer) from public, anon, authenticated;
revoke all on function public.rate_limit_record(text) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
grant execute on function public.rate_limit_count(text, integer) to service_role;
grant execute on function public.rate_limit_record(text) to service_role;

-- Old hits are useless after a day (the longest window used is 24 hours).
delete from public.rate_limit_hits where created_at < now() - interval '2 days';
