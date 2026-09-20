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

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const businessId = session.client_reference_id || (session.metadata?.business_id as string | undefined);
      if (businessId && session.customer) {
        await admin
          .from("businesses")
          .update({ stripe_customer_id: session.customer as string, stripe_subscription_id: session.subscription as string })
          .eq("id", businessId);
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const businessId = subscription.metadata?.business_id;
      if (businessId) {
        await admin
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
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          })
          .eq("id", businessId);
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

  return new NextResponse("OK");
}
