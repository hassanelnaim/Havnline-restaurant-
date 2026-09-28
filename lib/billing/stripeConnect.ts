import Stripe from "stripe";
import { getStripeClient } from "./stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Stripe Connect for CUSTOMER phone-order payments. Deliberately its
 * own file, separate from lib/billing/stripe.ts, which is HavnLine's
 * OWN subscription billing — different Stripe objects, different
 * money, different account. Mixing the two in one file is exactly how
 * you end up accidentally charging a customer's order into HavnLine's
 * own balance instead of the restaurant's.
 *
 * Uses Stripe's "direct charge" pattern: the Checkout Session is
 * created ON the connected account (via the `stripeAccount` request
 * option), so the restaurant is the actual merchant of record for the
 * charge — correct, since they're the one actually selling the food
 * and legally responsible for it, not HavnLine. HavnLine's own cut (if
 * any — see businesses.platform_fee_bps) rides along as an
 * application_fee_amount on the same PaymentIntent, which Stripe
 * splits automatically: the fee moves to HavnLine's platform balance,
 * everything else pays out to the restaurant's own bank.
 */

function requireStripe(): Stripe {
  const stripe = getStripeClient();
  if (!stripe) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing).");
  return stripe;
}

export interface ConnectAccountResult {
  accountId: string | null;
  error?: string;
}

/**
 * Gets this business's existing connected account, or creates a new
 * Express account for it. Express (not Standard or Custom) because it
 * gives Stripe's own hosted onboarding UI — Stripe collects and
 * verifies the restaurant's identity and bank details directly, so
 * HavnLine never touches that data or takes on that compliance
 * burden.
 */
export async function getOrCreateConnectAccount(businessId: string, businessName: string, businessEmail: string | null): Promise<ConnectAccountResult> {
  const stripe = requireStripe();
  const admin = createAdminClient();

  const { data: business } = await admin.from("businesses").select("stripe_connect_account_id").eq("id", businessId).single();
  if (business?.stripe_connect_account_id) {
    return { accountId: business.stripe_connect_account_id };
  }

  try {
    const account = await stripe.accounts.create({
      type: "express",
      email: businessEmail || undefined,
      business_type: "company",
      business_profile: { name: businessName, mcc: "5812" }, // 5812 = eating places/restaurants
      metadata: { business_id: businessId },
    });

    await admin.from("businesses").update({ stripe_connect_account_id: account.id }).eq("id", businessId);
    return { accountId: account.id };
  } catch (err) {
    console.error("Stripe Connect account creation failed:", err);
    const message = err instanceof Stripe.errors.StripeError ? err.message : "Could not create a Stripe account.";
    return { accountId: null, error: message };
  }
}

/**
 * A one-time-use link to Stripe's own hosted onboarding flow for this
 * account. refreshUrl is where Stripe sends the owner back if the
 * link expires mid-flow (just re-request a new one); returnUrl is
 * where they land after finishing — that page should re-check the
 * account's status with getConnectAccountStatus below, since
 * "finished onboarding" doesn't always mean "fully verified and ready
 * to accept charges" (Stripe may still be reviewing).
 */
export async function createOnboardingLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<{ url: string | null; error?: string }> {
  const stripe = requireStripe();
  try {
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: refreshUrl,
      return_url: returnUrl,
    });
    return { url: link.url };
  } catch (err) {
    console.error("Stripe Connect onboarding link failed:", err);
    const message = err instanceof Stripe.errors.StripeError ? err.message : "Could not start Stripe onboarding.";
    return { url: null, error: message };
  }
}

export interface ConnectAccountStatus {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

/** Refreshes and persists this business's real charges_enabled state from Stripe. Call after onboarding return, and from the account.updated webhook. */
export async function syncConnectAccountStatus(businessId: string, accountId: string): Promise<ConnectAccountStatus> {
  const stripe = requireStripe();
  const account = await stripe.accounts.retrieve(accountId);
  const admin = createAdminClient();

  const status: ConnectAccountStatus = {
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
  };

  await admin
    .from("businesses")
    .update({
      stripe_connect_charges_enabled: status.chargesEnabled,
      stripe_connect_onboarded_at: status.chargesEnabled ? new Date().toISOString() : null,
    })
    .eq("id", businessId);

  return status;
}

export interface OrderCheckoutInput {
  connectedAccountId: string;
  orderId: string;
  businessId: string;
  businessName: string;
  totalCents: number;
  platformFeeBps: number | null;
  customerPhone: string;
  successUrl: string;
  cancelUrl: string;
  /** Stripe idempotency key — must be unique per real charge attempt, stable across retries of the SAME attempt, so a Twilio/webhook retry can never create two Checkout Sessions (and two charges) for one order. */
  idempotencyKey: string;
}

export async function createOrderCheckoutSession(input: OrderCheckoutInput): Promise<{ sessionId: string | null; url: string | null; error?: string }> {
  const stripe = requireStripe();

  const applicationFeeAmount = input.platformFeeBps
    ? Math.round((input.totalCents * input.platformFeeBps) / 10000)
    : undefined;

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: `${input.businessName} — phone order` },
              unit_amount: input.totalCents,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: applicationFeeAmount ? { application_fee_amount: applicationFeeAmount } : undefined,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        // Checkout Sessions expire on their own (default 24h); we also
        // set a tighter window since a pickup order abandoned for a
        // day is worthless to the kitchen either way.
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        metadata: { order_id: input.orderId, business_id: input.businessId },
      },
      { stripeAccount: input.connectedAccountId, idempotencyKey: input.idempotencyKey }
    );
    return { sessionId: session.id, url: session.url };
  } catch (err) {
    console.error(`Stripe order Checkout Session failed for order ${input.orderId}:`, err);
    const message = err instanceof Stripe.errors.StripeError ? err.message : "Could not start checkout for this order.";
    return { sessionId: null, url: null, error: message };
  }
}

/** Voids an order BEFORE payment — expires the Checkout Session so the link stops working. Nothing was ever charged, so there's nothing to refund. */
export async function voidOrderCheckout(connectedAccountId: string, checkoutSessionId: string): Promise<{ success: boolean; error?: string }> {
  const stripe = requireStripe();
  try {
    await stripe.checkout.sessions.expire(checkoutSessionId, { stripeAccount: connectedAccountId });
    return { success: true };
  } catch (err) {
    // Already expired/completed sessions throw — either way, the link
    // is no longer usable, which is the actual goal here.
    if (err instanceof Stripe.errors.StripeError && err.code === "checkout_session_expired") {
      return { success: true };
    }
    console.error(`Stripe Checkout Session void failed for ${checkoutSessionId}:`, err);
    const message = err instanceof Stripe.errors.StripeError ? err.message : "Could not void this order.";
    return { success: false, error: message };
  }
}

/** Refunds an order AFTER payment — full amount if amountCents is omitted, partial otherwise. Refunds the application fee proportionally so HavnLine doesn't keep its cut on a refunded order. */
export async function refundOrderPayment(
  connectedAccountId: string,
  paymentIntentId: string,
  amountCents?: number
): Promise<{ success: boolean; refundedCents?: number; error?: string }> {
  const stripe = requireStripe();
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId, amount: amountCents, refund_application_fee: true },
      { stripeAccount: connectedAccountId }
    );
    return { success: true, refundedCents: refund.amount };
  } catch (err) {
    console.error(`Stripe refund failed for payment intent ${paymentIntentId}:`, err);
    const message = err instanceof Stripe.errors.StripeError ? err.message : "Could not process the refund.";
    return { success: false, error: message };
  }
}
