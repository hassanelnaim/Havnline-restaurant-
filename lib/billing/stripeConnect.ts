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
 * Uses Stripe's "direct charge" pattern, on accounts with the full Stripe
 * Dashboard (see ACCOUNT_CONTROLLER below): the Checkout Session is
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
  /** True when an old Express account was just replaced with a new one. */
  replaced?: boolean;
  error?: string;
}

/**
 * How a restaurant's Stripe account is set up. Since August 2026 Stripe
 * refuses direct charges on legacy Express/Custom accounts for new
 * platforms like HavnLine, so every restaurant gets the setup Stripe
 * recommends for direct charges: the full Stripe Dashboard, the
 * restaurant pays its own Stripe fees, and Stripe (not HavnLine) covers
 * a negative balance. The restaurant handles its own refunds and
 * disputes in its dashboard; HavnLine still takes its application fee.
 */
const ACCOUNT_CONTROLLER = {
  stripe_dashboard: { type: "full" as const },
  fees: { payer: "account" as const },
  losses: { payments: "stripe" as const },
  requirement_collection: "stripe" as const,
};

/** True for an account HavnLine can't charge on: a legacy Express/Custom account, or anything without the full dashboard. */
export function isLegacyConnectAccount(account: Pick<Stripe.Account, "type" | "controller">): boolean {
  if (account.type === "express" || account.type === "custom") return true;
  return account.controller?.stripe_dashboard?.type !== "full";
}

/**
 * Gets this business's connected account, or creates one. An account set
 * up the old way (Express) can't take payments any more, so it's replaced
 * with a new one; orders already paid on the old account remember it
 * (orders.stripe_connect_account_id), so their refunds still work.
 * Stripe's hosted onboarding collects the owner's identity and bank
 * details directly; HavnLine never sees them.
 */
export async function getOrCreateConnectAccount(businessId: string, businessName: string, businessEmail: string | null): Promise<ConnectAccountResult> {
  const stripe = requireStripe();
  const admin = createAdminClient();

  const { data: business } = await admin.from("businesses").select("stripe_connect_account_id").eq("id", businessId).single();
  const existingId = business?.stripe_connect_account_id || null;
  if (existingId) {
    try {
      const existing = await stripe.accounts.retrieve(existingId);
      if (!isLegacyConnectAccount(existing)) return { accountId: existingId, replaced: false };
    } catch (err) {
      // Disconnected or deleted: HavnLine can't use it, so start a new one.
      console.warn(`[stripe-connect] account ${existingId} can't be used any more, creating a new one:`, err instanceof Error ? err.message : err);
    }
  }

  try {
    const account = await stripe.accounts.create({
      controller: ACCOUNT_CONTROLLER,
      country: "US",
      email: businessEmail || undefined,
      business_profile: { name: businessName, mcc: "5812" }, // 5812 = eating places/restaurants
      metadata: { business_id: businessId, ...(existingId ? { replaces_account: existingId } : {}) },
    });

    if (existingId) await rememberAccountOnOldPayments(businessId, existingId);
    await admin
      .from("businesses")
      .update({ stripe_connect_account_id: account.id, stripe_connect_charges_enabled: false, stripe_connect_onboarded_at: null })
      .eq("id", businessId);
    return { accountId: account.id, replaced: Boolean(existingId) };
  } catch (err) {
    console.error("Stripe Connect account creation failed:", err);
    const message = err instanceof Stripe.errors.StripeError ? err.message : "Could not create a Stripe account.";
    return { accountId: null, error: message };
  }
}

/**
 * Before a business switches Stripe accounts, stamps the old account on
 * every order and add-on charge that went through it, so refunds, voids
 * and Stripe's events for those payments still go to the right account.
 */
async function rememberAccountOnOldPayments(businessId: string, oldAccountId: string): Promise<void> {
  const admin = createAdminClient();
  for (const table of ["orders", "order_addendum_charges"] as const) {
    const { error } = await admin
      .from(table)
      .update({ stripe_connect_account_id: oldAccountId })
      .eq("business_id", businessId)
      .is("stripe_connect_account_id", null)
      .not("stripe_checkout_session_id", "is", null);
    if (error) console.error(`[stripe-connect] could not record the old account on ${table} (run migration 046):`, error.message);
  }
}

/**
 * Whether this business has to reconnect Stripe: its account is a legacy
 * Express account, or was disconnected or deleted. Turns off phone
 * payments when so (the AI then tells callers it can't take phone orders
 * rather than failing mid-call). Null when Stripe can't be reached.
 */
export async function connectAccountNeedsReconnect(businessId: string, accountId: string): Promise<boolean | null> {
  const stripe = getStripeClient();
  if (!stripe) return null;
  let needs: boolean;
  try {
    needs = isLegacyConnectAccount(await stripe.accounts.retrieve(accountId));
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeError) || (err.statusCode !== 403 && err.statusCode !== 404 && err.code !== "account_invalid")) {
      console.error(`[stripe-connect] couldn't check account ${accountId}:`, err);
      return null;
    }
    needs = true;
  }
  if (needs) {
    await createAdminClient()
      .from("businesses")
      .update({ stripe_connect_charges_enabled: false })
      .eq("id", businessId)
      .eq("stripe_connect_account_id", accountId)
      .eq("stripe_connect_charges_enabled", true);
  }
  return needs;
}

/** The Stripe account a payment was made on: the one recorded on it, else the business's current one. */
export function accountForPayment(row: { stripe_connect_account_id?: string | null } | null | undefined, businessAccountId: string | null | undefined): string | null {
  return row?.stripe_connect_account_id || businessAccountId || null;
}

/** Records which Stripe account a checkout was created on. Its own write, so a missing column (before migration 046) can't stop the session id being saved. */
export async function recordCheckoutAccount(table: "orders" | "order_addendum_charges", id: string, accountId: string): Promise<void> {
  const { error } = await createAdminClient().from(table).update({ stripe_connect_account_id: accountId }).eq("id", id);
  if (error) console.error(`[stripe-connect] could not record the Stripe account on ${table} ${id} (run migration 046):`, error.message);
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

  // A legacy Express account reports charges_enabled, but Stripe refuses
  // HavnLine's direct charges on it, so it counts as not ready.
  const status: ConnectAccountStatus = {
    chargesEnabled: Boolean(account.charges_enabled) && !isLegacyConnectAccount(account),
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
  customerPhone?: string;
  successUrl: string;
  cancelUrl: string;
  /** Stripe idempotency key — must be unique per real charge attempt, stable across retries of the SAME attempt, so a Twilio/webhook retry can never create two Checkout Sessions (and two charges) for one order. */
  idempotencyKey: string;
  /** Overrides the default "{businessName} — phone order" line item name — used by Phase 4's addendum charges ("Additional item"), which aren't phone orders at all. */
  productName?: string;
  /**
   * Extra metadata merged onto the Checkout Session alongside the
   * usual order_id/business_id — used by Phase 4's addendum charges to
   * carry addendum_id, which the Connect webhook checks FIRST to
   * decide whether a completed session means "mark this whole order
   * paid" or "insert these specific pending items."
   */
  extraMetadata?: Record<string, string>;
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
              product_data: { name: input.productName || `${input.businessName} — phone order` },
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
        metadata: { order_id: input.orderId, business_id: input.businessId, ...input.extraMetadata },
      },
      // Created while the caller waits on the phone: one short try, never
      // Stripe's 80-second default. The idempotency key makes a later
      // retry return this same session if this one did go through.
      { stripeAccount: input.connectedAccountId, idempotencyKey: input.idempotencyKey, timeout: 5000, maxNetworkRetries: 0 }
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
  amountCents?: number,
  idempotencyKey?: string
): Promise<{ success: boolean; refundedCents?: number; error?: string }> {
  const stripe = requireStripe();
  try {
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId, amount: amountCents, refund_application_fee: true },
      { stripeAccount: connectedAccountId, ...(idempotencyKey ? { idempotencyKey } : {}) }
    );
    return { success: true, refundedCents: refund.amount };
  } catch (err) {
    console.error(`Stripe refund failed for payment intent ${paymentIntentId}:`, err);
    const message = err instanceof Stripe.errors.StripeError ? err.message : "Could not process the refund.";
    return { success: false, error: message };
  }
}

/**
 * HavnLine's fee on one payment, as Stripe holds it on the platform account:
 * how much was taken and how much has already been given back.
 */
export async function getApplicationFee(feeId: string): Promise<{ amountCents: number; refundedCents: number } | null> {
  const stripe = requireStripe();
  try {
    const fee = await stripe.applicationFees.retrieve(feeId);
    return { amountCents: fee.amount, refundedCents: fee.amount_refunded };
  } catch (err) {
    console.error(`could not read application fee ${feeId}:`, err);
    return null;
  }
}

/** Gives back part of HavnLine's fee on a payment (an order refunded outside HavnLine). */
export async function returnApplicationFee(feeId: string, amountCents: number, idempotencyKey: string): Promise<{ success: boolean; error?: string }> {
  const stripe = requireStripe();
  try {
    await stripe.applicationFees.createRefund(feeId, { amount: amountCents }, { idempotencyKey });
    return { success: true };
  } catch (err) {
    console.error(`could not return application fee ${feeId}:`, err);
    return { success: false, error: err instanceof Stripe.errors.StripeError ? err.message : "Could not return the fee." };
  }
}

/** The share of a fee that matches the refunded share of the payment. */
export function feeOwedForRefund(feeCents: number, paidCents: number, refundedCents: number, feeAlreadyReturnedCents: number): number {
  if (feeCents <= 0 || paidCents <= 0 || refundedCents <= 0) return 0;
  const share = Math.round((feeCents * Math.min(refundedCents, paidCents)) / paidCents);
  return Math.max(0, Math.min(feeCents, share) - feeAlreadyReturnedCents);
}
