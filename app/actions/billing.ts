"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { createCheckoutSession, createBillingPortalSession } from "@/lib/billing/stripe";
import { getSiteUrl } from "@/lib/env";

export interface BillingActionResult {
  url?: string;
  error?: string;
}

async function requireAuth(): Promise<{ businessId: string; email: string }> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  const businessId = await getCurrentBusinessId();
  if (!businessId) throw new Error("No business found for this account.");

  return { businessId, email: user.email || "" };
}

const SITE_URL = getSiteUrl();

export async function startCheckoutAction(): Promise<BillingActionResult> {
  let auth: { businessId: string; email: string };
  try {
    auth = await requireAuth();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("name, stripe_customer_id").eq("id", auth.businessId).single();

  const result = await createCheckoutSession({
    businessId: auth.businessId,
    businessName: business?.name || "Business",
    customerEmail: auth.email,
    existingStripeCustomerId: business?.stripe_customer_id || null,
    successUrl: `${SITE_URL}/dashboard/billing?success=1`,
    cancelUrl: `${SITE_URL}/dashboard/billing?canceled=1`,
  });

  if (!result.url) return { error: result.error || "Could not start checkout." };
  return { url: result.url };
}

export async function openBillingPortalAction(): Promise<BillingActionResult> {
  let auth: { businessId: string; email: string };
  try {
    auth = await requireAuth();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("stripe_customer_id").eq("id", auth.businessId).single();

  if (!business?.stripe_customer_id) return { error: "No billing account found yet." };

  const result = await createBillingPortalSession(business.stripe_customer_id, `${SITE_URL}/dashboard/billing`);
  if (result.url) return { url: result.url };

  // "resource_missing" means Stripe itself says this customer id
  // doesn't exist under the API key this server is currently using —
  // it was created under a different key (almost always a test-mode
  // key that got swapped for live, or vice versa) and will NEVER work
  // again as-is. Rather than leave the business stuck re-hitting the
  // same dead reference forever, clear it (and the subscription id/
  // status that go with it, since those are equally unreachable) so
  // "Start free trial" below creates a fresh customer under whichever
  // key is actually live right now.
  if (result.code === "resource_missing") {
    await admin
      .from("businesses")
      .update({ stripe_customer_id: null, stripe_subscription_id: null, subscription_status: "none", cancel_at_period_end: false })
      .eq("id", auth.businessId);
    return { error: "Your billing account reference was out of date (likely a leftover from Stripe test mode), so we've cleared it. Start a new free trial below to set up billing properly." };
  }

  return { error: result.error || "Could not open billing portal." };
}