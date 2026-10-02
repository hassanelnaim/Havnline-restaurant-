-- Structured address fields needed to calculate real sales tax via
-- Stripe Tax (replacing the manual tax_rate_bps percentage an owner
-- used to type into Settings). Stripe's tax calculation API needs a
-- real city/state/postal_code to look up the correct combined
-- state+county+city rate -- the old free-text `address` column can't
-- be reliably parsed into those, so these are new, separate columns
-- rather than an attempt to split the existing one.
--
-- `address` itself is untouched and keeps working exactly as before
-- (it's just a display string fed into the AI's own instructions).
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS address_city text,
  ADD COLUMN IF NOT EXISTS address_state text,
  ADD COLUMN IF NOT EXISTS address_zip text;

-- tax_rate_bps (see 013_business_tax_rate.sql) is no longer written or
-- read anywhere in the app -- tax is now calculated live via Stripe
-- Tax using the address columns above. Left in place rather than
-- dropped so existing historical orders/rows aren't disturbed; safe to
-- remove in a later cleanup migration once this has been live a while.
