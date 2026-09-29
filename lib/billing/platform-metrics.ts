import Stripe from "stripe";
import { getStripeClient } from "./stripe";

/**
 * HavnLine's own real platform revenue numbers — both pulled live from
 * Stripe's API, not stored/derived locally (nothing in the businesses
 * table records the actual subscription price, only subscription_status
 * — see 016_order_payments.sql and lib/billing/stripe.ts). This used to
 * be a hardcoded `(active + past_due count) * $199` guess; that's gone.
 *
 * Two genuinely different numbers, both worth showing:
 * - MRR: the forward-looking run rate of every currently active
 *   subscription, normalized to a monthly amount. "If nothing changes,
 *   this is next month's revenue."
 * - Revenue this month: what Stripe has actually collected in the
 *   current calendar month via paid invoices — backward-looking, and
 *   can catch things MRR won't (a late past-due payment landing this
 *   month, a one-time proration).
 *
 * Both are platform-account numbers only — HavnLine's own subscription
 * billing, never a restaurant's Connect account. A restaurant's phone-
 * order payments aren't HavnLine's revenue (see lib/billing/stripeConnect.ts);
 * only the platform_fee_bps cut of those would be, and that's not
 * included here yet.
 */

const MONTHLY_MS = 30.44 * 24 * 60 * 60 * 1000; // average month, for normalizing weekly/yearly intervals

function normalizeToMonthlyCents(price: Stripe.Price, quantity: number): number {
  const amount = (price.unit_amount || 0) * quantity;
  const recurring = price.recurring;
  if (!recurring) return 0;

  switch (recurring.interval) {
    case "month":
      return amount / recurring.interval_count;
    case "year":
      return amount / (recurring.interval_count * 12);
    case "week":
      return (amount / recurring.interval_count) * (MONTHLY_MS / (7 * 24 * 60 * 60 * 1000));
    case "day":
      return (amount / recurring.interval_count) * (MONTHLY_MS / (24 * 60 * 60 * 1000));
    default:
      return amount;
  }
}

export interface PlatformRevenueMetrics {
  mrrCents: number;
  activeSubscriptionCount: number;
  revenueThisMonthCents: number;
  configured: boolean;
  error?: string;
}

export async function getPlatformRevenueMetrics(): Promise<PlatformRevenueMetrics> {
  const stripe = getStripeClient();
  if (!stripe) {
    return { mrrCents: 0, activeSubscriptionCount: 0, revenueThisMonthCents: 0, configured: false };
  }

  try {
    const [mrrResult, revenueResult] = await Promise.all([computeMrrCents(stripe), computeRevenueThisMonthCents(stripe)]);
    return {
      mrrCents: mrrResult.mrrCents,
      activeSubscriptionCount: mrrResult.count,
      revenueThisMonthCents: revenueResult,
      configured: true,
    };
  } catch (err) {
    console.error("Failed to fetch platform revenue metrics from Stripe:", err);
    const message = err instanceof Stripe.errors.StripeError ? err.message : "Could not reach Stripe.";
    return { mrrCents: 0, activeSubscriptionCount: 0, revenueThisMonthCents: 0, configured: true, error: message };
  }
}

async function computeMrrCents(stripe: Stripe): Promise<{ mrrCents: number; count: number }> {
  let mrrCents = 0;
  let count = 0;

  // Every currently active OR past_due subscription counts toward run
  // rate — past_due still expects to collect (Stripe is retrying), it
  // just hasn't succeeded yet this cycle. Canceled/incomplete/trialing
  // subscriptions are excluded: trialing hasn't actually committed to
  // pay yet, matching how the old estimate also excluded pure trials
  // from the paying-revenue number.
  for (const status of ["active", "past_due"] as const) {
    for await (const subscription of stripe.subscriptions.list({ status, limit: 100, expand: ["data.items.data.price"] })) {
      count += 1;
      for (const item of subscription.items.data) {
        mrrCents += normalizeToMonthlyCents(item.price, item.quantity || 1);
      }
    }
  }

  return { mrrCents: Math.round(mrrCents), count };
}

async function computeRevenueThisMonthCents(stripe: Stripe): Promise<number> {
  const now = new Date();
  const startOfMonth = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);

  let totalCents = 0;
  for await (const invoice of stripe.invoices.list({ status: "paid", created: { gte: startOfMonth }, limit: 100 })) {
    totalCents += invoice.amount_paid;
  }
  return totalCents;
}
