-- 032: signed-in users can READ their own business's data, and nothing else.
--
-- The Supabase public (anon) key ships in every visitor's browser, so
-- these row-level rules are the only thing between a stranger with a free
-- account and the data. The audit (Oct 22, 2026) found:
--   * business_members_insert_self only checked user_id = auth.uid(), so
--     any signed-in user could add themselves to ANY business;
--   * businesses_update_member let owners rewrite every column of their
--     business row (subscription status, platform fee, texting approval,
--     Stripe Connect state) straight from the browser;
--   * integrations (which holds each business's Twilio sub-account auth
--     token) was readable and writable by members;
--   * most other tables allowed members to insert/update/delete directly.
--
-- The app itself never writes through the browser or the user-scoped
-- client: every write goes through server actions / API routes using the
-- service-role client, after checking who the user is. So all write
-- access for signed-in and anonymous users is removed here, read access
-- is kept exactly as it was (same conditions), and integrations is hidden
-- completely (the dashboard reads it on the server, credentials stripped).
--
-- Safe to run more than once. Read-only; deletes no data.

do $$
declare
  r record;
  read_name text;
begin
  for r in
    select tablename, policyname, cmd, roles, qual
    from pg_policies
    where schemaname = 'public' and cmd <> 'SELECT'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    -- An "ALL" policy also granted reading: keep that part, as SELECT only.
    if r.cmd = 'ALL' and r.qual is not null and r.tablename <> 'integrations' then
      read_name := left(r.policyname || ' (read)', 63);
      if not exists (
        select 1 from pg_policies where schemaname = 'public' and tablename = r.tablename and policyname = read_name
      ) then
        execute format(
          'create policy %I on public.%I for select to %s using (%s)',
          read_name, r.tablename, array_to_string(r.roles, ', '), r.qual
        );
      end if;
    end if;
  end loop;

  -- Integrations: no direct access at all (server only).
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'integrations' loop
    execute format('drop policy %I on public.integrations', r.policyname);
  end loop;
end $$;

-- Row security stays on for integrations; with no policies, signed-in and
-- anonymous users see no rows. The server's service-role client is unaffected.
alter table public.integrations enable row level security;

-- Check afterwards (should list only SELECT policies, none on integrations):
-- select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by tablename;
