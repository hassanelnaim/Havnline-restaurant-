-- Backfills the 3% (300bps) platform fee onto every existing business
-- that doesn't have one set yet. Until now platform_fee_bps had no
-- default at all -- it was null (effectively 0%) for every business
-- until a platform admin manually set one on /admin/businesses/[id] --
-- and the app only just started defaulting new signups to 300bps (see
-- app/actions/business-draft.ts and app/actions/onboarding.ts).
--
-- Only touches rows that are still null, so it never overwrites a fee
-- a platform admin already customized for a specific business.
UPDATE businesses
SET platform_fee_bps = 300
WHERE platform_fee_bps IS NULL;
