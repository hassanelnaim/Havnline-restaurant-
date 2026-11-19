-- Tracks whether a reminder text has already gone out for a given
-- appointment, so the daily reminder job never sends the same
-- reminder twice.
alter table if exists public.appointments add column if not exists reminder_sent_at timestamptz;

-- The customer's real consent decision, made at booking time, needs
-- to persist — otherwise a customer who declined the confirmation
-- text could still get texted later for a reminder or cancellation,
-- directly contradicting what they actually said.
alter table if exists public.appointments add column if not exists sms_consent boolean not null default false;
