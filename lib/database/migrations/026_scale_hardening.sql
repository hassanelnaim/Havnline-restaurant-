-- Two things that only matter once there are many businesses on one
-- HavnLine deployment, both found while reviewing how the app behaves
-- when every restaurant is busy at the same time (lunch / dinner rush).
--
-- 1) service_circuit_breakers
--    A tiny shared "is this provider currently unusable?" flag. When
--    ElevenLabs starts refusing requests (concurrency limit, outage,
--    exhausted quota), /api/tts records a short-lived trip here and
--    every call's next turn switches to Twilio's built-in voice for a
--    few seconds instead of playing silence. One row per service.
--    Lives in the database (not memory) because each webhook can be
--    served by a different serverless instance, so in-process state
--    would never be seen by the instances that need it.
--
-- 2) idx_integrations_twilio_phone
--    Every inbound call used to look up which business owns the dialed
--    number by downloading EVERY connected Twilio integration row and
--    filtering in JavaScript (resolveBusinessFromPhoneNumber). That got
--    slower with every business added, and PostgREST silently caps a
--    response at 1,000 rows by default — past 1,000 businesses, some
--    numbers would simply stop resolving and their calls would fail.
--    The lookup now filters in the database on this expression, which
--    this index makes a single index probe regardless of how many
--    businesses exist.
create table if not exists public.service_circuit_breakers (
  service text primary key,
  tripped_until timestamptz,
  last_reason text,
  updated_at timestamptz not null default now()
);

alter table public.service_circuit_breakers enable row level security;

create policy "No direct client access to circuit breaker state"
  on public.service_circuit_breakers for all
  using (false)
  with check (false);

create index if not exists idx_integrations_twilio_phone
  on public.integrations ((metadata->>'phone_number'))
  where provider = 'twilio';
