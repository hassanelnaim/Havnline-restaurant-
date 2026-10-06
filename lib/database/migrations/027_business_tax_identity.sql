-- Legal identity a business needs for carrier (A2P 10DLC) text-message
-- registration: the exact legal name and the EIN (US federal tax ID)
-- must match IRS records, and a mismatch is the most common reason a
-- registration is rejected. Both are optional at signup (a business
-- can add them later) and are only ever used to register the business
-- for messaging -- never shown to customers or sent to the AI.
--
-- `ein` holds nine digits only (no dash); the app formats it for
-- display. Treat it as sensitive: do not log it.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS legal_business_name text,
  ADD COLUMN IF NOT EXISTS ein text;

ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_ein_format;
ALTER TABLE businesses
  ADD CONSTRAINT businesses_ein_format CHECK (ein IS NULL OR ein ~ '^[0-9]{9}$');
