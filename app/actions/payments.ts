"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { getSiteUrl } from "@/lib/env";
import {
  getOrCreateConnectAccount,
  createOnboardingLink,
  syncConnectAccountStatus,
  voidOrderCheckout,
  refundOrderPayment,
} from "@/lib/billing/stripeConnect";
import { dbErrorResult } from "@/lib/errors";

export interface ActionResult {
  success: boolean;
  error?: string;
}

async function requireBusinessId(): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  const businessId = await getCurrentBusinessId();
  if (!businessId) throw new Error("No business found for this account.");
  return businessId;
}

/**
 * Kicks off (or resumes) Stripe's own hosted onboarding for this
 * business's connected account. Returns a URL to redirect the owner
 * to — HavnLine never sees their identity/bank details, Stripe
 * collects those directly on its own page.
 */
export async function startStripeConnectOnboardingAction(): Promise<{ url: string | null; error?: string }> {
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();
  if (!business) return { url: null, error: "Business not found." };

  const account = await getOrCreateConnectAccount(businessId, business.name, null);
  if (!account.accountId) return { url: null, error: account.error || "Could not start Stripe onboarding." };

  const siteUrl = getSiteUrl();
  const link = await createOnboardingLink(
    account.accountId,
    `${siteUrl}/dashboard/integrations?stripe_refresh=1`,
    `${siteUrl}/dashboard/integrations?stripe_return=1`
  );
  return link;
}

/** Called when the owner lands back from Stripe's onboarding flow — re-checks the account's real status rather than assuming "returned" means "fully verified." */
export async function syncStripeConnectStatusAction(): Promise<ActionResult & { chargesEnabled?: boolean }> {
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("stripe_connect_account_id").eq("id", businessId).single();
  if (!business?.stripe_connect_account_id) return { success: false, error: "Stripe isn't connected yet." };

  try {
    const status = await syncConnectAccountStatus(businessId, business.stripe_connect_account_id);
    revalidatePath("/dashboard/integrations");
    return { success: true, chargesEnabled: status.chargesEnabled };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Could not check Stripe status." };
  }
}

/** The explicit "start charging customers" switch — separate from just having connected an account (see migration 016's comment for why). Refuses to turn on if the account isn't actually ready to accept charges yet. */
export async function setPhonePaymentsEnabledAction(enabled: boolean): Promise<ActionResult> {
  const businessId = await requireBusinessId();
  const admin = createAdminClient();

  if (enabled) {
    const { data: business } = await admin.from("businesses").select("stripe_connect_charges_enabled").eq("id", businessId).single();
    if (!business?.stripe_connect_charges_enabled) {
      return { success: false, error: "Finish connecting Stripe before turning this on — your account isn't ready to accept charges yet." };
    }
  }

  const { error } = await admin.from("businesses").update({ phone_payments_enabled: enabled }).eq("id", businessId);
  if (error) return dbErrorResult(error, "setPhonePaymentsEnabledAction", "Could not update phone payments setting.");

  revalidatePath("/dashboard/integrations");
  return { success: true };
}

/** Void: cancels an order BEFORE it's been paid — expires the payment link. Nothing was ever charged. */
export async function voidOrderAction(orderId: string): Promise<ActionResult> {
  const businessId = await requireBusinessId();
  const admin = createAdminClient();

  const { data: order } = await admin.from("orders").select("*").eq("id", orderId).eq("business_id", businessId).single();
  if (!order) return { success: false, error: "Order not found." };
  if (order.payment_status === "paid") return { success: false, error: "This order has already been paid — use Refund instead." };

  if (order.stripe_checkout_session_id) {
    const { data: business } = await admin.from("businesses").select("stripe_connect_account_id").eq("id", businessId).single();
    if (business?.stripe_connect_account_id) {
      const result = await voidOrderCheckout(business.stripe_connect_account_id, order.stripe_checkout_session_id);
      if (!result.success) return { success: false, error: result.error };
    }
  }

  const {
    data: { user },
  } = await createClient().auth.getUser();

  const { error } = await admin
    .from("orders")
    .update({ status: "cancelled", payment_status: order.payment_status === "awaiting_payment" ? "failed" : order.payment_status, voided_by: user?.id || null, voided_at: new Date().toISOString() })
    .eq("id", orderId);
  if (error) return dbErrorResult(error, "voidOrderAction", "Could not void that order.");

  revalidatePath("/dashboard/orders");
  return { success: true };
}

/** Refund: reverses an ALREADY-PAID order through Stripe — actual money movement, not just a status flip. Full refund if amountCents is omitted. */
export async function refundOrderAction(orderId: string, amountCents: number | undefined, reason: string): Promise<ActionResult> {
  const businessId = await requireBusinessId();
  const admin = createAdminClient();

  const { data: order } = await admin.from("orders").select("*").eq("id", orderId).eq("business_id", businessId).single();
  if (!order) return { success: false, error: "Order not found." };
  if (order.payment_status !== "paid" && order.payment_status !== "partially_refunded") {
    return { success: false, error: "This order hasn't been paid, so there's nothing to refund — use Void instead." };
  }
  if (!order.stripe_payment_intent_id) return { success: false, error: "No payment on file for this order." };

  const { data: business } = await admin.from("businesses").select("stripe_connect_account_id").eq("id", businessId).single();
  if (!business?.stripe_connect_account_id) return { success: false, error: "Stripe isn't connected for this business." };

  // Keyed on the exact pre-refund state we just read: two near-
  // simultaneous submissions of the SAME click (a double-click, a
  // dropped-response client retry) will almost always both read the
  // same amount_refunded_cents before either write lands, so they
  // produce the identical key and Stripe itself collapses them into
  // one real refund — the second call just gets back the same refund
  // object instead of issuing a second one. A genuinely separate,
  // later refund (the amount already on file has since changed) gets
  // its own distinct key and goes through normally.
  const idempotencyKey = `refund:${orderId}:${order.amount_refunded_cents}:${amountCents ?? "full"}`;
  const result = await refundOrderPayment(business.stripe_connect_account_id, order.stripe_payment_intent_id, amountCents, idempotencyKey);
  if (!result.success) return { success: false, error: result.error };

  const {
    data: { user },
  } = await createClient().auth.getUser();

  const newAmountRefunded = order.amount_refunded_cents + (result.refundedCents || 0);
  const fullyRefunded = newAmountRefunded >= order.total_cents;

  // Guarded by the same pre-refund amount we keyed Stripe's call on —
  // if another request already moved amount_refunded_cents in the
  // meantime, this update intentionally matches no row rather than
  // stomping a newer value with a total computed from stale data.
  const { data: updatedOrder, error } = await admin
    .from("orders")
    .update({
      payment_status: fullyRefunded ? "refunded" : "partially_refunded",
      amount_refunded_cents: newAmountRefunded,
      refund_reason: reason || order.refund_reason,
      refunded_by: user?.id || null,
      refunded_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("amount_refunded_cents", order.amount_refunded_cents)
    .select("id")
    .maybeSingle();
  if (error) return dbErrorResult(error, "refundOrderAction", "Could not record the refund.");
  if (!updatedOrder) {
    // Stripe's own idempotency already prevented a double charge (see
    // above) — this just means another request recorded the result
    // first. Nothing left for this call to do.
    return { success: true };
  }

  revalidatePath("/dashboard/orders");
  return { success: true };
}
