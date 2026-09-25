import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripeClient } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/webhooks/stripe
 *
 * The single source of truth for subscription status. Never trust
 * client-side state for billing — this webhook is what actually
 * updates a business's subscription_status in the database, driven
 * entirely by what Stripe itself reports.
 */
export async function POST(request: NextRequest) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return new NextResponse("Stripe is not configured.", { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature || "", webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return new NextResponse("Invalid signature", { status: 400 });
  }

  const admin = createAdminClient();

  try {
    switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const businessId = session.client_reference_id || (session.metadata?.business_id as string | undefined);
      if (!businessId) {
        console.warn(`checkout.session.completed (${event.id}): no business_id on client_reference_id or metadata — nothing updated.`);
        break;
      }
      if (session.customer) {
        const { data: updated, error } = await admin
          .from("businesses")
          .update({ stripe_customer_id: session.customer as string, stripe_subscription_id: session.subscription as string })
          .eq("id", businessId)
          .select("id");
        if (error) {
          console.error(`checkout.session.completed (${event.id}): update failed for business ${businessId}:`, error);
        } else if (!updated || updated.length === 0) {
          // Matched zero rows — this is silent success from Supabase's
          // point of view, but it means businessId doesn't correspond
          // to any row in `businesses`, so nothing actually happened.
          console.warn(`checkout.session.completed (${event.id}): business_id ${businessId} matched no row in businesses.`);
        }
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const businessId = subscription.metadata?.business_id;
      if (!businessId) {
        // This is the other classic cause of "payment succeeded but
        // the app never sees it": subscription_data.metadata.business_id
        // wasn't set on the Checkout Session that created this
        // subscription (e.g. an old/expired Checkout Session, or one
        // created before that metadata was added to the code).
        console.warn(`${event.type} (${event.id}): subscription ${subscription.id} has no metadata.business_id — nothing updated.`);
        break;
      }

      // Stripe API versions 2025-03-31 ("basil") and later removed
      // current_period_end from the top-level Subscription object —
      // it now lives per subscription item. Read it from there, with
      // a fallback to the (deprecated but still-present on older API
      // versions) top-level field, so this works regardless of which
      // API version actually serialized the incoming event.
      // Cast needed: the installed `stripe` SDK's TypeScript types
      // (pinned to the older 2024-06-20 API shape) don't yet declare
      // current_period_end on SubscriptionItem, even though newer
      // API versions (like the one this webhook endpoint is actually
      // serializing events with) do return it there at runtime.
      const firstItem = subscription.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
      const rawPeriodEnd = firstItem?.current_period_end ?? subscription.current_period_end;
      const currentPeriodEnd = typeof rawPeriodEnd === "number" ? new Date(rawPeriodEnd * 1000).toISOString() : null;

      const { data: updated, error } = await admin
        .from("businesses")
        .update({
          subscription_status: subscription.status,
          // Real, not decorative: this is what lets the UI say
          // "Canceling — access ends [date]" instead of looking
          // identical to a business that never canceled. Stripe sets
          // cancel_at_period_end to true the moment someone cancels
          // through the portal, while status stays "active" until
          // the period actually ends — so without this field, a
          // canceled-but-still-active business is indistinguishable
          // from one that's never canceled at all.
          cancel_at_period_end: subscription.cancel_at_period_end,
          ...(currentPeriodEnd ? { current_period_end: currentPeriodEnd } : {}),
        })
        .eq("id", businessId)
        .select("id");
      if (error) {
        console.error(`${event.type} (${event.id}): update failed for business ${businessId}:`, error);
      } else if (!updated || updated.length === 0) {
        console.warn(`${event.type} (${event.id}): business_id ${businessId} (from subscription metadata) matched no row in businesses.`);
      } else {
        console.log(`${event.type} (${event.id}): business ${businessId} subscription_status -> ${subscription.status}`);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const businessId = subscription.metadata?.business_id;
      if (businessId) {
        await admin.from("businesses").update({ subscription_status: "canceled", cancel_at_period_end: false }).eq("id", businessId);
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = invoice.subscription as string | null;
      if (subscriptionId) {
        await admin.from("businesses").update({ subscription_status: "past_due" }).eq("stripe_subscription_id", subscriptionId);
      }
      break;
    }
    }
  } catch (err) {
    // Any unexpected payload shape or DB error lands here instead of
    // crashing unhandled — logged with the event type/id so it's
    // traceable from Vercel logs, and Stripe still gets a clean 500 so
    // it retries automatically rather than silently dropping the event.
    console.error(`Stripe webhook handler failed for ${event.type} (${event.id}):`, err);
    return new NextResponse("Webhook handler error", { status: 500 });
  }

  return new NextResponse("OK");
}