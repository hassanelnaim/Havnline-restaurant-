import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripeClient } from "@/lib/billing/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { queuePrintJob, queueAddendumPrintJob } from "@/lib/integrations/printer-app";
import { insertOrderItems, recomputeRealOrderTotals } from "@/lib/billing/orderItemAddition";
import type { PendingAddendumItem } from "@/lib/billing/orderItemAddition";
import { smsClient } from "@/lib/integrations/sms";
import { sendPaymentsLiveEmail, sendPaymentsDisconnectedEmail } from "@/lib/notifications/account-email";
import type { OrderWithItems } from "@/lib/database/types";

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
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Phase 4 of the tablet redesign: a QR item-addition charge is
        // its OWN, much smaller Checkout Session, not the original
        // order's — checked first, via addendum_id, so it's never
        // mistaken for the order-level session order_id also carries.
        const addendumId = session.metadata?.addendum_id;
        if (addendumId) {
          const { data: addendum } = await admin.from("order_addendum_charges").select("*").eq("id", addendumId).single();
          if (!addendum) {
            console.warn(`checkout.session.completed (${event.id}): addendum ${addendumId} not found.`);
            break;
          }
          // Idempotency, same reasoning as the order-level branch below
          // — Stripe can and does redeliver webhook events, and this
          // must never insert the same pending items twice.
          if (addendum.status === "paid") break;

          const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
          const pendingItems = (addendum.items as PendingAddendumItem[]) || [];

          const inserted = await insertOrderItems(addendum.order_id, pendingItems);
          if (!inserted.success) {
            console.error(`checkout.session.completed (${event.id}): could not insert addendum ${addendumId} items: ${inserted.error}`);
            break;
          }

          const { data: business } = await admin.from("businesses").select("*").eq("id", addendum.business_id).single();
          // Re-derived fresh from every item now on the order (original
          // plus this addition), the same approach confirm_and_place_order
          // uses, rather than adding a tax delta on top of the stored total.
          await recomputeRealOrderTotals(addendum.order_id, business || { address_city: null, address_state: null, address_zip: null });

          await admin
            .from("order_addendum_charges")
            .update({ status: "paid", stripe_payment_intent_id: paymentIntentId || null, paid_at: new Date().toISOString() })
            .eq("id", addendumId);

          if (business?.printer_app_paired_at) {
            await queueAddendumPrintJob(
              addendum.business_id,
              addendum.order_id,
              business,
              pendingItems.map((item) => ({ item_name: item.itemName, quantity: item.quantity, notes: item.notes, modifiers: item.modifiers.map((m) => ({ modifier_name: m.modifierName })) })),
              addendum.amount_cents,
              true
            );
          }
          break;
        }

        const orderId = session.metadata?.order_id;
        if (!orderId) {
          console.warn(`checkout.session.completed (${event.id}): no order_id in metadata — ignoring.`);
          break;
        }

        const { data: order } = await admin.from("orders").select("*").eq("id", orderId).single();
        if (!order) {
          console.warn(`checkout.session.completed (${event.id}): order ${orderId} not found.`);
          break;
        }
        // Idempotency: Stripe can and does redeliver webhook events.
        // If this order is already paid, the kitchen already has the
        // ticket and the customer already got the confirmation text —
        // redoing either would be a duplicate print / duplicate text.
        if (order.payment_status === "paid") break;

        const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;

        await admin
          .from("orders")
          .update({ payment_status: "paid", stripe_payment_intent_id: paymentIntentId || null })
          .eq("id", orderId);

        const { data: business } = await admin.from("businesses").select("*").eq("id", order.business_id).single();
        const { data: items } = await admin.from("order_items").select("*").eq("order_id", orderId);
        const itemIds = (items || []).map((i) => i.id);
        const { data: modifiers } = itemIds.length
          ? await admin.from("order_item_modifiers").select("*").in("order_item_id", itemIds)
          : { data: [] };

        const fullOrder: OrderWithItems = {
          ...order,
          payment_status: "paid",
          items: (items || []).map((i) => ({ ...i, modifiers: (modifiers || []).filter((m) => m.order_item_id === i.id) })),
        };

        if (business?.printer_app_paired_at) {
          const queued = await queuePrintJob(fullOrder, business);
          if (queued.success) {
            await admin.from("orders").update({ status: "submitted", submitted_at: new Date().toISOString() }).eq("id", orderId);
          } else {
            await admin.from("orders").update({ submit_error: queued.error }).eq("id", orderId);
          }
        }

        if (order.call_id) {
          await admin.from("calls").update({ outcome: "order_placed" }).eq("id", order.call_id);
        }

        if (order.phone && business) {
          const smsBody = `Payment received at ${business.name}! Total: $${(order.total_cents / 100).toFixed(2)}. We'll have it ready for pickup soon. Msg&data rates may apply. Reply HELP for help, STOP to cancel.`;
          await smsClient.send(order.business_id, order.phone, smsBody);
        }
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
          sendPaymentsLiveEmail(before.id).catch((err) => console.error("Payments-live email failed:", err));
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
          sendPaymentsDisconnectedEmail(before.id).catch((err) => console.error("Payments-disconnected email failed:", err));
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
