-- 037: the last audit fixes (batch 4). Safe to run more than once.

-- Disputes (chargebacks) recorded on the order they belong to.
alter table public.orders add column if not exists dispute_status text;

-- Twilio's own id for each call, so the call-ended report finds exactly
-- the right call instead of guessing by the caller's number.
alter table public.calls add column if not exists twilio_call_sid text;
create unique index if not exists calls_twilio_call_sid_key on public.calls (twilio_call_sid) where twilio_call_sid is not null;

-- What the caller said, held for a moment between two webhooks so it
-- doesn't travel in URLs (and land in request logs). Deleted nightly.
create table if not exists public.call_speech_handoffs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  speech text not null,
  created_at timestamptz not null default now()
);
alter table public.call_speech_handoffs enable row level security;

-- Comped (free) items from the tablet are logged with refunds and discounts.
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.tablet_money_actions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%action%'
  loop
    execute format('alter table public.tablet_money_actions drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.tablet_money_actions
  add constraint tablet_money_actions_action_check check (action in ('refund', 'discount', 'comp'));
