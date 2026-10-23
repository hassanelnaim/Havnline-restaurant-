-- 036: pieces for handling many calls at once (audit batch 3).
-- Safe to run more than once.

-- 1. One claim per call turn. A Twilio retry that arrives while the first
--    copy of a turn is still running finds the claim and waits for that
--    turn's reply instead of running the AI a second time.
create table if not exists public.call_turn_claims (
  call_id uuid not null references public.calls(id) on delete cascade,
  seq integer not null,
  created_at timestamptz not null default now(),
  primary key (call_id, seq)
);
alter table public.call_turn_claims enable row level security;

-- 2. Kitchen tickets: how many times each job was handed to the tablet
--    without a "printed" reply. Above 1, the tablet may have printed it
--    already, so the ticket is marked as a possible reprint.
alter table public.printer_print_jobs add column if not exists handed_out integer not null default 0;

create or replace function public.claim_print_jobs(p_business uuid, p_cutoff timestamptz)
returns table (id uuid, ticket_text text, created_at timestamptz, handed_out integer)
language sql
security definer
set search_path = public
as $$
  update public.printer_print_jobs j
  set claimed_at = now(), handed_out = j.handed_out + 1
  where j.business_id = p_business
    and j.status = 'pending'
    and (j.claimed_at is null or j.claimed_at < p_cutoff)
  returning j.id, j.ticket_text, j.created_at, j.handed_out;
$$;

-- 3. Weekly digest: which week each business last got one, so a daily run
--    can pick up where a run that ran out of time stopped.
alter table public.businesses add column if not exists last_digest_week text;

-- 4. Cost totals summed in the database instead of downloading every row.
create or replace function public.usage_cost_totals(p_business uuid default null, p_since timestamptz default null)
returns table (provider text, cost_cents numeric)
language sql
stable
security definer
set search_path = public
as $$
  select provider, coalesce(sum(estimated_cost_cents), 0)
  from public.usage_records
  where (p_business is null or business_id = p_business)
    and (p_since is null or created_at >= p_since)
  group by provider;
$$;

create or replace function public.call_seconds_total(p_business uuid default null, p_since timestamptz default null)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(duration_seconds), 0)::bigint
  from public.calls
  where (p_business is null or business_id = p_business)
    and (p_since is null or started_at >= p_since);
$$;

revoke all on function public.claim_print_jobs(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.usage_cost_totals(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.call_seconds_total(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_print_jobs(uuid, timestamptz) to service_role;
grant execute on function public.usage_cost_totals(uuid, timestamptz) to service_role;
grant execute on function public.call_seconds_total(uuid, timestamptz) to service_role;

-- 5. Faster lookups the call path makes on every new call.
create index if not exists calls_business_phone_status_idx on public.calls (business_id, phone, status);
