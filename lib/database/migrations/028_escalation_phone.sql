-- Optional separate phone number for live escalation transfers. When set,
-- escalated calls ring this number INSTEAD of the business's main phone
-- (businesses.phone). When null, the main phone is used, as before.
-- Stored as typed-then-normalised E.164 (+1XXXXXXXXXX) by the app.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS escalation_phone text;
