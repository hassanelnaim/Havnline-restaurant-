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
} from "@/lib/billing/stripeConnect";
import { processOrderRefund } from "@/lib/billing/orderRefund";
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

/**
 * Refund: reverses an ALREADY-PAID order through Stripe — actual
 * money movement, not just a status flip. Full refund if amountCents
 * is omitted. The actual mechanics live in processOrderRefund
 * (lib/billing/orderRefund.ts), shared with the tablet's PIN-gated
 * refund/discount route — this just supplies the dashboard's own
 * authorization (requireBusinessId) and actor (the logged-in owner).
 */
export async function refundOrderAction(orderId: string, amountCents: number | undefined, reason: string): Promise<ActionResult> {
  const businessId = await requireBusinessId();
  const {
    data: { user },
  } = await createClient().auth.getUser();

  const result = await processOrderRefund(businessId, orderId, amountCents, reason, { refundedByUserId: user?.id || null });
  if (!result.success) return { success: false, error: result.error };

  revalidatePath("/dashboard/orders");
  return { success: true };
}
