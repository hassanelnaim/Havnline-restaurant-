/**
 * The plan's advertised price and HavnLine's per-order fee, in one place
 * so marketing/onboarding copy can't drift from each other the way the
 * old $199/month text did once the real price changed. These are display
 * values only:
 *
 * - The subscription amount actually charged comes from whatever Stripe
 *   Price object STRIPE_PRICE_ID points to (see lib/billing/stripe.ts) —
 *   changing MONTHLY_PRICE_DISPLAY here does NOT change what Stripe
 *   charges. That Price object has to be created/updated in the Stripe
 *   dashboard (or via the Stripe API) and STRIPE_PRICE_ID set to match.
 * - The per-order fee actually applied comes from each business's own
 *   `platform_fee_bps` column (set by a platform admin on
 *   /admin/businesses/[id], or defaulted for new signups below) — see
 *   lib/billing/stripeConnect.ts. Changing DEFAULT_PLATFORM_FEE_BPS only
 *   changes the default new businesses get; it does not retroactively
 *   change any existing business's stored fee.
 */
export const MONTHLY_PRICE_DISPLAY = "$100";
export const MONTHLY_PRICE_CENTS = 10000;

export const DEFAULT_PLATFORM_FEE_BPS = 300; // 3%
export const DEFAULT_PLATFORM_FEE_PERCENT_DISPLAY = "3%";
