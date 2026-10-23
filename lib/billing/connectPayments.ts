import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { queuePrintJob, queueAddendumPrintJob } from "@/lib/integrations/printer-app";
import { insertOrderItems, recomputeRealOrderTotals } from "@/lib/billing/orderItemAddition";
import type { PendingAddendumItem } from "@/lib/billing/orderItemAddition";
import { smsClient } from "@/lib/integrations/sms";
import { sendOrderAttentionEmail } from "@/lib/notifications/account-email";
import { sendPlatformAlert, settleWithin } from "@/lib/monitoring/platformAlert";
import type { OrderWithItems } from "@/lib/database/types";

/**
 * What happens when a customer pays a phone order (or a tablet add-on)
 * through its Stripe Checkout link. Called from the Stripe Connect webhook.
 *
 * Stripe delivers each event AT LEAST once: the same payment can arrive
 * twice at the same moment, or again after this code crashed halfway. And
 * every connected restaurant's events arrive at this one endpoint. So:
 *
 *  1. The event is checked against the order before anything changes: it
 *     must come from THIS restaurant's Stripe account, be for this order's
 *     own checkout session (or, if that wasn't saved, for its exact
 *     amount), and actually be paid. Anything else is logged and alerted,
 *     never acted on.
 *  2. Marking the order paid is one conditional update; only one delivery
 *     can win it.
 *  3. Every step after that is idempotent on its own (one ticket per order
 *     enforced by the database, the payment text claimed once), and runs
 *     again on a retry. A delivery that crashed after "paid" no longer
 *     leaves an order paid but never printed: Stripe's retry finishes it.
 *
 * Throwing means "try again": the webhook answers 500 and Stripe retries.
 */

function paymentIntentIdOf(session: Stripe.Checkout.Session): string | null {
  return typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
}

/** Why this event can't be for this order/charge, or null if it checks out. */
function mismatchReason(
  eventAccount: string | null | undefined,
  businessAccount: string | null | undefined,
  session: Stripe.Checkout.Session,
  expected: { sessionId: string | null | undefined; amountCents: number | null | undefined }
): string | null {
  if (!businessAccount) return "the restaurant has no Stripe account connected";
  if (!eventAccount || eventAccount !== businessAccount) return `it came from Stripe account ${eventAccount || "(none)"}, not the restaurant's own`;
  if (expected.sessionId) {
    if (expected.sessionId !== session.id) return `it is for checkout session ${session.id}, not the order's own`;
  } else if (typeof session.amount_total !== "number" || session.amount_total !== expected.amountCents) {
    // No session id was saved (that write can fail without stopping the
    // call), so the exact amount has to match instead.
    return `the amount (${session.amount_total ?? "unknown"} cents) doesn't match the order (${expected.amountCents ?? "unknown"} cents)`;
  }
  return null;
}

async function alertMismatch(kind: string, id: string, eventId: string, reason: string) {
  console.error(`[stripe-connect] ${kind} ${id}: ignored event ${eventId} because ${reason}.`);
  await settleWithin(
    sendPlatformAlert({
      key: "connect-payment-mismatch",
      subject: "HavnLine: a payment event didn't match its order",
      heading: "A payment event was ignored",
      intro: "A Stripe Connect payment event named an order or add-on it doesn't belong to. Nothing was marked paid or printed. Check the event in Stripe.",
      rows: [
        { label: "Kind", value: kind },
        { label: "Id", value: id },
        { label: "Event", value: eventId },
        { label: "Reason", value: reason },
      ],
    }),
    1500
  );
}

export async function handleOrderPaid(eventId: string, eventAccount: string | null | undefined, session: Stripe.Checkout.Session): Promise<void> {
  const admin = createAdminClient();
  const orderId = session.metadata?.order_id;
  if (!orderId) {
    console.warn(`[stripe-connect] ${eventId}: no order_id in metadata, ignoring.`);
    return;
  }

  const { data: order, error: orderError } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (orderError) throw new Error(`could not read order ${orderId}: ${orderError.message}`);
  if (!order) {
    console.warn(`[stripe-connect] ${eventId}: order ${orderId} not found.`);
    return;
  }
  const { data: business, error: businessError } = await admin.from("businesses").select("*").eq("id", order.business_id).maybeSingle();
  if (businessError || !business) throw new Error(`could not read business ${order.business_id}: ${businessError?.message || "missing"}`);

  const mismatch = mismatchReason(eventAccount, business.stripe_connect_account_id, session, {
    sessionId: order.stripe_checkout_session_id,
    amountCents: order.total_cents,
  });
  if (mismatch) return alertMismatch("order", orderId, eventId, mismatch);
  if (session.payment_status !== "paid") {
    // Delayed payment methods report "completed" before the money arrives;
    // checkout.session.async_payment_succeeded follows when it does.
    console.log(`[stripe-connect] ${eventId}: order ${orderId} checkout completed but not paid yet (${session.payment_status}).`);
    return;
  }

  // Only one delivery can flip the order to paid.
  const { data: claimed, error: claimError } = await admin
    .from("orders")
    .update({ payment_status: "paid", stripe_payment_intent_id: paymentIntentIdOf(session), stripe_checkout_session_id: order.stripe_checkout_session_id || session.id })
    .eq("id", orderId)
    .in("payment_status", ["awaiting_payment", "not_required", "failed"])
    .select("*")
    .maybeSingle();
  if (claimError) throw new Error(`could not mark order ${orderId} paid: ${claimError.message}`);

  let current = claimed;
  if (!current) {
    // Another delivery got there first, or this is Stripe retrying after a
    // crash. If it's paid, run the remaining steps again (each is safe to
    // repeat); if it has since been refunded, there is nothing to do.
    const { data: now, error } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (error) throw new Error(`could not re-read order ${orderId}: ${error.message}`);
    if (!now || now.payment_status !== "paid") return;
    current = now;
  }

  // Paid after the restaurant voided it (customer paid in the seconds
  // before the void went through): don't send it to the kitchen. The money
  // is real, so the owner is told to refund it, once.
  if (current.status === "cancelled") {
    const { data: flagged } = await admin
      .from("orders")
      .update({ submit_error: "Paid after it was voided. Refund it from Orders if you're not making it." })
      .eq("id", orderId)
      .is("submit_error", null)
      .select("id")
      .maybeSingle();
    if (flagged) {
      await sendOrderAttentionEmail({
        businessId: current.business_id,
        subject: "an order was paid after it was voided",
        heading: "A voided order was just paid",
        intro: "The customer paid this order after it was voided, so it was NOT sent to the kitchen. Make it, or refund it from your Orders page.",
        customerName: current.customer_name,
        customerPhone: current.phone,
        totalCents: current.total_cents,
      });
    }
    return;
  }

  if (business.printer_app_paired_at) {
    const { data: items, error: itemsError } = await admin.from("order_items").select("*").eq("order_id", orderId);
    if (itemsError) throw new Error(`could not read items for order ${orderId}: ${itemsError.message}`);
    const itemIds = (items || []).map((i) => i.id);
    const { data: modifiers, error: modsError } = itemIds.length
      ? await admin.from("order_item_modifiers").select("*").in("order_item_id", itemIds)
      : { data: [], error: null };
    if (modsError) throw new Error(`could not read modifiers for order ${orderId}: ${modsError.message}`);

    const fullOrder: OrderWithItems = {
      ...current,
      items: (items || []).map((i) => ({ ...i, modifiers: (modifiers || []).filter((m) => m.order_item_id === i.id) })),
    };
    const queued = await queuePrintJob(fullOrder, business);
    if (queued.success) {
      await admin.from("orders").update({ status: "submitted", submitted_at: new Date().toISOString(), submit_error: null }).eq("id", orderId).eq("status", "confirmed");
    } else {
      await admin.from("orders").update({ submit_error: queued.error }).eq("id", orderId);
    }
  }

  if (current.call_id) {
    await admin.from("calls").update({ outcome: "order_placed" }).eq("id", current.call_id);
  }

  // The "Payment received" text goes out once, whichever delivery gets here.
  if (current.phone) {
    const { data: textClaim } = await admin
      .from("orders")
      .update({ payment_text_sent_at: new Date().toISOString() })
      .eq("id", orderId)
      .is("payment_text_sent_at", null)
      .select("id")
      .maybeSingle();
    if (textClaim) {
      const smsBody = `Payment received at ${business.name}! Total: $${(current.total_cents / 100).toFixed(2)}. We'll have it ready for pickup soon. Msg&data rates may apply. Reply HELP for help, STOP to cancel.`;
      const sent = await smsClient.send(current.business_id, current.phone, smsBody);
      if (!sent.sent) console.error(`[stripe-connect] payment-received text for order ${orderId} not sent: ${sent.reason}`);
    }
  }
}

export async function handleAddendumPaid(eventId: string, eventAccount: string | null | undefined, session: Stripe.Checkout.Session): Promise<void> {
  const admin = createAdminClient();
  const addendumId = session.metadata?.addendum_id as string;

  const { data: addendum, error: addendumError } = await admin.from("order_addendum_charges").select("*").eq("id", addendumId).maybeSingle();
  if (addendumError) throw new Error(`could not read add-on ${addendumId}: ${addendumError.message}`);
  if (!addendum) {
    console.warn(`[stripe-connect] ${eventId}: add-on ${addendumId} not found.`);
    return;
  }
  const { data: business, error: businessError } = await admin.from("businesses").select("*").eq("id", addendum.business_id).maybeSingle();
  if (businessError || !business) throw new Error(`could not read business ${addendum.business_id}: ${businessError?.message || "missing"}`);

  const mismatch = mismatchReason(eventAccount, business.stripe_connect_account_id, session, {
    sessionId: addendum.stripe_checkout_session_id,
    amountCents: addendum.amount_cents,
  });
  if (mismatch) return alertMismatch("add-on", addendumId, eventId, mismatch);
  if (session.payment_status !== "paid") return;

  const { data: claimed, error: claimError } = await admin
    .from("order_addendum_charges")
    .update({ status: "paid", stripe_payment_intent_id: paymentIntentIdOf(session), paid_at: new Date().toISOString() })
    .eq("id", addendumId)
    .in("status", ["awaiting_payment", "expired"])
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(`could not mark add-on ${addendumId} paid: ${claimError.message}`);
  if (!claimed) {
    const { data: now, error } = await admin.from("order_addendum_charges").select("status").eq("id", addendumId).maybeSingle();
    if (error) throw new Error(`could not re-read add-on ${addendumId}: ${error.message}`);
    if (!now || now.status !== "paid") return;
  }

  const pendingItems = (addendum.items as PendingAddendumItem[]) || [];

  // The items are added to the order once: claimed first, released again
  // if adding them fails so Stripe's retry can try again.
  const { data: itemsClaim, error: itemsClaimError } = await admin
    .from("order_addendum_charges")
    .update({ items_added_at: new Date().toISOString() })
    .eq("id", addendumId)
    .is("items_added_at", null)
    .select("id")
    .maybeSingle();
  if (itemsClaimError) throw new Error(`could not claim add-on ${addendumId} items: ${itemsClaimError.message}`);
  if (itemsClaim) {
    const inserted = await insertOrderItems(addendum.order_id, pendingItems).catch((err) => ({ success: false, error: String(err) }));
    if (!inserted.success) {
      await admin.from("order_addendum_charges").update({ items_added_at: null }).eq("id", addendumId);
      throw new Error(`could not add add-on ${addendumId} items: ${inserted.error}`);
    }
    await recomputeRealOrderTotals(addendum.order_id, business);
  }

  if (business.printer_app_paired_at) {
    const queued = await queueAddendumPrintJob(
      addendum.business_id,
      addendum.order_id,
      business,
      pendingItems.map((item) => ({ item_name: item.itemName, quantity: item.quantity, notes: item.notes, modifiers: item.modifiers.map((m) => ({ modifier_name: m.modifierName })) })),
      addendum.amount_cents,
      true,
      addendumId
    );
    if (!queued.success) throw new Error(`could not queue add-on ${addendumId} ticket: ${queued.error}`);
  }
}
