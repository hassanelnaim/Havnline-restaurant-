"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/supabase/platform-admin";
import { dbErrorResult } from "@/lib/errors";

export interface ActionResult {
  success: boolean;
  error?: string;
}

const DEMO_MODE_ERROR = "This is a preview with demo data — connect Supabase to make real changes.";

export async function updateBusinessSubscriptionStatusAction(businessId: string, status: string): Promise<ActionResult> {
  const allowed = await isPlatformAdmin();
  if (!allowed) return { success: false, error: "Not authorized." };
  if (!isSupabaseConfigured()) return { success: false, error: DEMO_MODE_ERROR };

  const admin = createAdminClient();
  const { error } = await admin.from("businesses").update({ subscription_status: status }).eq("id", businessId);
  if (error) return dbErrorResult(error, "updateBusinessSubscriptionStatusAction", "Could not update the subscription status.");

  revalidatePath("/admin");
  revalidatePath(`/admin/businesses/${businessId}`);
  return { success: true };
}

/**
 * The % HavnLine keeps of a business's phone-order payments (Stripe
 * Connect application_fee_amount — see lib/billing/stripeConnect.ts).
 * Stored in the DB as basis points (500 = 5%), but this action takes a
 * plain percent (5, 2.5, etc.) since that's what an admin actually
 * types. There's no Stripe dashboard setting for this at all — Stripe's
 * direct-charge Connect pattern has no platform-wide "fee %" toggle,
 * it's entirely whatever amount this app passes on each Checkout
 * Session, so this admin field IS the only place this number lives.
 */
export async function updatePlatformFeeAction(businessId: string, feePercent: number): Promise<ActionResult> {
  const allowed = await isPlatformAdmin();
  if (!allowed) return { success: false, error: "Not authorized." };
  if (!isSupabaseConfigured()) return { success: false, error: DEMO_MODE_ERROR };

  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) {
    return { success: false, error: "Fee must be a percentage between 0 and 100." };
  }

  const feeBps = Math.round(feePercent * 100);

  const admin = createAdminClient();
  const { error } = await admin.from("businesses").update({ platform_fee_bps: feeBps }).eq("id", businessId);
  if (error) return dbErrorResult(error, "updatePlatformFeeAction", "Could not update the platform fee.");

  revalidatePath("/admin");
  revalidatePath(`/admin/businesses/${businessId}`);
  return { success: true };
}

/**
 * Carrier (A2P 10DLC) registration is done by HavnLine for each business,
 * by hand in Twilio. Once the business's campaign is approved, this marks
 * texting as active: the "sms" integration row is what the business's
 * Integrations page reads to show "Active" instead of "Registration in
 * progress". Turning it off puts the card back to in-progress.
 */
export async function setTextingApprovedAction(businessId: string, approved: boolean): Promise<ActionResult> {
  const allowed = await isPlatformAdmin();
  if (!allowed) return { success: false, error: "Not authorized." };
  if (!isSupabaseConfigured()) return { success: false, error: DEMO_MODE_ERROR };

  const admin = createAdminClient();
  const { error } = await admin.from("integrations").upsert(
    {
      business_id: businessId,
      provider: "sms",
      status: approved ? "connected" : "not_connected",
      connected_at: approved ? new Date().toISOString() : null,
      metadata: null,
    },
    { onConflict: "business_id,provider" }
  );
  if (error) return dbErrorResult(error, "setTextingApprovedAction", "Could not update texting status.");

  revalidatePath(`/admin/businesses/${businessId}`);
  revalidatePath("/dashboard/integrations");
  return { success: true };
}

export async function moderateReviewAction(reviewId: string, status: "approved" | "rejected"): Promise<ActionResult> {
  const allowed = await isPlatformAdmin();
  if (!allowed) return { success: false, error: "Not authorized." };
  if (!isSupabaseConfigured()) return { success: false, error: DEMO_MODE_ERROR };

  const admin = createAdminClient();
  const { error } = await admin.from("reviews").update({ status }).eq("id", reviewId);
  if (error) return dbErrorResult(error, "moderateReviewAction", "Could not update that review.");

  revalidatePath("/admin");
  revalidatePath("/");
  return { success: true };
}
