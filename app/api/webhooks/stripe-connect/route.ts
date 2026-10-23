import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripeClient } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleOrderPaid, handleAddendumPaid } from "@/lib/billing/connectPayments";
import { sendPaymentsLiveEmail, sendPaymentsDisconnectedEmail } from "@/lib/notifications/account-email";

export const maxDuration = 60;

/**
 * POST /api/webhooks/stripe-connect
 *
 * A SEPARATE endpoint from /api/webhooks/stripe on purpose. That one
 * handles HavnLine's OWN subscription billing (platform-account
 * events). This one is configured in Stripe's dashboard to listen for
 * events on CONNECTED accounts — customer phone-order payments — and
 * is verified against its own signing secret
 * (STRIPE_CONNECT_WEBHOOK_SECRET). Mixing these into one handler
 * would make it too easy to accidentally treat a customer's $14 order
 * payment like a business's $99 subscription payment, or vice versa.
 *
 * This is the ONLY place a phone order actually reaches the kitchen
 * when the business has phone payments turned on — see the comment in
 * confirm_and_place_order (lib/ai/tools.ts) for why printing is
 * deferred until payment is confirmed here, not when the order is
 * first built.
 */
export async function POST(request: NextRequest) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    return new NextResponse("Stripe Connect webhooks are not configured.", { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature || "", webhookSecret);
  } catch (err) {
    console.error("Stripe Connect webhook signature verification failed:", err);
    return new NextResponse("Invalid signature", { status: 400 });
  }

  const admin = createAdminClient();

  try {
    switch (event.type) {
      // A customer paid a phone order's (or a tablet add-on's) checkout
      // link. All the checks and the exactly-once handling live in
      // lib/billing/connectPayments.ts. async_payment_succeeded is the same
      // moment for delayed payment methods.
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.addendum_id) await handleAddendumPaid(event.id, event.account, session);
        else await handleOrderPaid(event.id, event.account, session);
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;

        const addendumId = session.metadata?.addendum_id;
        if (addendumId) {
          // Same "only touch if still genuinely pending" guard as the
          // order-level branch below — an addendum reported expired
          // after already completing (rare redelivery ordering) must
          // never be silently marked expired.
          await admin.from("order_addendum_charges").update({ status: "expired" }).eq("id", addendumId).eq("status", "awaiting_payment");
          break;
        }

        const orderId = session.metadata?.order_id;
        if (!orderId) break;

        // Only touch it if it's still genuinely unpaid — a session
        // can be reported expired after having already completed in
        // rare redelivery orderings, and an already-paid order should
        // never be silently cancelled.
        await admin
          .from("orders")
          .update({ status: "cancelled", payment_status: "failed" })
          .eq("id", orderId)
          .eq("payment_status", "awaiting_payment");
        break;
      }

      case "account.updated": {
        const account = event.data.object as Stripe.Account;

        const { data: before } = await admin
          .from("businesses")
          .select("id, stripe_connect_charges_enabled")
          .eq("stripe_connect_account_id", account.id)
          .maybeSingle();

        await admin
          .from("businesses")
          .update({
            stripe_connect_charges_enabled: Boolean(account.charges_enabled),
            stripe_connect_onboarded_at: account.charges_enabled ? new Date().toISOString() : null,
          })
          .eq("stripe_connect_account_id", account.id);

        // Only the first true flip is "you're set up now" news — every
        // later account.updated (Stripe fires these often, for all
        // kinds of minor account changes) would otherwise re-send this
        // same email over and over.
        if (before && !before.stripe_connect_charges_enabled && account.charges_enabled) {
          await sendPaymentsLiveEmail(before.id).catch((err) => console.error("Payments-live email failed:", err));
        }
        break;
      }

      // Fired when a business disconnects their Stripe account from
      // ours (or Stripe revokes it) — no account.updated follows this,
      // so without handling it separately, stripe_connect_charges_enabled
      // stays stale at whatever it last was. That's the one flag
      // confirm_and_place_order trusts to decide whether to text a
      // real payment link, so a stale "true" here means every call
      // from then on tries to charge through a connection that no
      // longer exists.
      case "account.application.deauthorized": {
        const accountId = event.account;
        if (!accountId) break;

        const { data: before } = await admin
          .from("businesses")
          .select("id, stripe_connect_charges_enabled")
          .eq("stripe_connect_account_id", accountId)
          .maybeSingle();

        await admin
          .from("businesses")
          .update({ stripe_connect_charges_enabled: false, stripe_connect_onboarded_at: null })
          .eq("stripe_connect_account_id", accountId);

        if (before?.stripe_connect_charges_enabled) {
          await sendPaymentsDisconnectedEmail(before.id).catch((err) => console.error("Payments-disconnected email failed:", err));
        }
        break;
      }
    }
  } catch (err) {
    console.error(`Stripe Connect webhook handler failed for ${event.type} (${event.id}):`, err);
    return new NextResponse("Webhook handler error", { status: 500 });
  }

  return new NextResponse("OK");
}
