import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { queuePrintJob, queueAddendumPrintJob } from "@/lib/integrations/printer-app";
import { insertOrderItems, recomputeRealOrderTotals } from "@/lib/billing/orderItemAddition";
import type { PendingAddendumItem } from "@/lib/billing/orderItemAddition";
import { smsClient } from "@/lib/integrations/sms";
import { sendOrderAttentionEmail, sendOrderRefundedEmail } from "@/lib/notifications/account-email";
import { sendPlatformAlert, settleWithin } from "@/lib/monitoring/platformAlert";
import { feeOwedForRefund, getApplicationFee, accountForPayment } from "@/lib/billing/stripeConnect";
import { getStripeClient } from "@/lib/billing/stripe";
import type { OrderWithItems } from "@/lib/database/types";

/**
 * What happens when a customer pays a phone order (or a tablet add-on) on
 * HavnLine's payment page (or an older Stripe Checkout link). Called from
 * the Stripe Connect webhook.
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

/**
 * A completed payment, from either path: HavnLine's own payment page (a
 * PaymentIntent) or an older Stripe Checkout link still in flight.
 */
export interface CompletedPayment {
  /** "intent" = HavnLine's payment page; "session" = Stripe Checkout. */
  kind: "intent" | "session";
  /** The PaymentIntent or Checkout Session id. */
  id: string;
  paymentIntentId: string | null;
  amountCents: number | null;
  paid: boolean;
  metadata: Record<string, string>;
}

export function paymentFromSession(session: Stripe.Checkout.Session): CompletedPayment {
  return {
    kind: "session",
    id: session.id,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
    amountCents: typeof session.amount_total === "number" ? session.amount_total : null,
    paid: session.payment_status === "paid",
    metadata: (session.metadata || {}) as Record<string, string>,
  };
}

export function paymentFromIntent(intent: Stripe.PaymentIntent): CompletedPayment {
  return {
    kind: "intent",
    id: intent.id,
    paymentIntentId: intent.id,
    amountCents: typeof intent.amount_received === "number" && intent.amount_received > 0 ? intent.amount_received : intent.amount,
    paid: intent.status === "succeeded",
    metadata: (intent.metadata || {}) as Record<string, string>,
  };
}

/**
 * Safety net for a payment whose webhook never arrived (the event isn't
 * subscribed on the Connect endpoint, the endpoint was down, Stripe is
 * slow). Asks Stripe directly and, if the customer paid, records it exactly
 * as the webhook would: paid, printed, confirmation texted. Recording twice
 * is harmless (the paid claim is atomic). Used when the pay page sees a
 * finished payment and when an expiring link finds it was paid.
 */
export async function recordPaymentIfWebhookMissed(accountId: string, paymentIntentId: string): Promise<boolean> {
  const stripe = getStripeClient();
  if (!stripe) return false;
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: accountId });
  } catch (err) {
    console.error(`[pay] could not check payment ${paymentIntentId}:`, err instanceof Error ? err.message : err);
    return false;
  }
  if (intent.status !== "succeeded" || intent.metadata?.havnline_pay_page !== "1") return false;
  const payment = paymentFromIntent(intent);
  const eventId = `pay-check:${intent.id}`;
  if (payment.metadata.addendum_id) await handleAddendumPaid(eventId, accountId, payment);
  else if (payment.metadata.order_id) await handleOrderPaid(eventId, accountId, payment);
  else return false;
  return true;
}

/** Why this event can't be for this order/charge, or null if it checks out. */
function mismatchReason(
  eventAccount: string | null | undefined,
  businessAccount: string | null | undefined,
  payment: CompletedPayment,
  expected: { sessionId: string | null | undefined; paymentIntentId: string | null | undefined; amountCents: number | null | undefined }
): string | null {
  if (!businessAccount) return "the restaurant has no Stripe account connected";
  if (!eventAccount || eventAccount !== businessAccount) return `it came from Stripe account ${eventAccount || "(none)"}, not the restaurant's own`;
  const savedId = payment.kind === "session" ? expected.sessionId : expected.paymentIntentId;
  if (savedId) {
    if (savedId !== payment.id) return `it is for payment ${payment.id}, not the order's own`;
  } else if (payment.amountCents === null || payment.amountCents !== expected.amountCents) {
    // No payment id was saved (that write can fail without stopping the
    // call), so the exact amount has to match instead.
    return `the amount (${payment.amountCents ?? "unknown"} cents) doesn't match the order (${expected.amountCents ?? "unknown"} cents)`;
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

export async function handleOrderPaid(eventId: string, eventAccount: string | null | undefined, payment: CompletedPayment): Promise<void> {
  const admin = createAdminClient();
  const orderId = payment.metadata.order_id;
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

  const mismatch = mismatchReason(eventAccount, accountForPayment(order, business.stripe_connect_account_id), payment, {
    sessionId: order.stripe_checkout_session_id,
    paymentIntentId: order.stripe_payment_intent_id,
    amountCents: order.total_cents,
  });
  if (mismatch) return alertMismatch("order", orderId, eventId, mismatch);
  if (!payment.paid) {
    // Delayed payment methods report "completed" before the money arrives;
    // checkout.session.async_payment_succeeded follows when it does.
    console.log(`[stripe-connect] ${eventId}: order ${orderId} payment completed but not paid yet.`);
    return;
  }

  // Only one delivery can flip the order to paid.
  const { data: claimed, error: claimError } = await admin
    .from("orders")
    .update({
      payment_status: "paid",
      stripe_payment_intent_id: payment.paymentIntentId,
      ...(payment.kind === "session" ? { stripe_checkout_session_id: order.stripe_checkout_session_id || payment.id } : {}),
    })
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

export async function handleAddendumPaid(eventId: string, eventAccount: string | null | undefined, payment: CompletedPayment): Promise<void> {
  const admin = createAdminClient();
  const addendumId = payment.metadata.addendum_id as string;

  const { data: addendum, error: addendumError } = await admin.from("order_addendum_charges").select("*").eq("id", addendumId).maybeSingle();
  if (addendumError) throw new Error(`could not read add-on ${addendumId}: ${addendumError.message}`);
  if (!addendum) {
    console.warn(`[stripe-connect] ${eventId}: add-on ${addendumId} not found.`);
    return;
  }
  const { data: business, error: businessError } = await admin.from("businesses").select("*").eq("id", addendum.business_id).maybeSingle();
  if (businessError || !business) throw new Error(`could not read business ${addendum.business_id}: ${businessError?.message || "missing"}`);

  const mismatch = mismatchReason(eventAccount, accountForPayment(addendum, business.stripe_connect_account_id), payment, {
    sessionId: addendum.stripe_checkout_session_id,
    paymentIntentId: addendum.stripe_payment_intent_id,
    amountCents: addendum.amount_cents,
  });
  if (mismatch) return alertMismatch("add-on", addendumId, eventId, mismatch);
  if (!payment.paid) return;

  const { data: claimed, error: claimError } = await admin
    .from("order_addendum_charges")
    .update({ status: "paid", stripe_payment_intent_id: payment.paymentIntentId, paid_at: new Date().toISOString() })
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

async function findOrderForPayment(eventAccount: string | null | undefined, paymentIntent: string | Stripe.PaymentIntent | null) {
  const intentId = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id ?? null;
  if (!intentId) return null;
  const admin = createAdminClient();
  const { data: order, error } = await admin.from("orders").select("*").eq("stripe_payment_intent_id", intentId).maybeSingle();
  if (error) throw new Error(`could not find the order for payment ${intentId}: ${error.message}`);
  if (!order) return null; // a tablet add-on charge, or not a HavnLine order
  const { data: business } = await admin.from("businesses").select("stripe_connect_account_id").eq("id", order.business_id).maybeSingle();
  const expectedAccount = accountForPayment(order, business?.stripe_connect_account_id);
  if (!expectedAccount || expectedAccount !== eventAccount) {
    console.error(`[stripe-connect] ignored a charge event for order ${order.id}: it came from ${eventAccount || "(none)"}, not the restaurant's account.`);
    return null;
  }
  return order;
}

/**
 * A refund made in the Stripe dashboard (not through HavnLine) used to
 * never show up: the order still read "paid". Refunds made through
 * HavnLine are already recorded, so for them this changes nothing.
 */
export async function handleChargeRefunded(eventAccount: string | null | undefined, charge: Stripe.Charge): Promise<void> {
  const order = await findOrderForPayment(eventAccount, charge.payment_intent);
  if (!order) return;
  await recordFeeOwed(order.id, charge);
  const refunded = charge.amount_refunded || 0;
  if (refunded <= (order.amount_refunded_cents || 0)) return;

  const admin = createAdminClient();
  const fullyRefunded = refunded >= (order.total_cents || charge.amount);
  const { data: updated } = await admin
    .from("orders")
    .update({
      payment_status: fullyRefunded ? "refunded" : "partially_refunded",
      amount_refunded_cents: refunded,
      refund_reason: order.refund_reason || "Refunded in Stripe",
      refunded_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("amount_refunded_cents", order.amount_refunded_cents || 0)
    .select("id")
    .maybeSingle();
  if (updated) {
    await sendOrderRefundedEmail({
      businessId: order.business_id,
      orderId: order.id,
      customerName: order.customer_name,
      customerPhone: order.phone,
      refundedCents: refunded - (order.amount_refunded_cents || 0),
      fullyRefunded,
      reason: "Refunded in the Stripe dashboard",
    });
  }
}

/**
 * HavnLine's fee on a refunded order. Refunds made in HavnLine give the
 * matching share of the fee back automatically; a refund made in the Stripe
 * dashboard doesn't, so what's still owed is saved on the order and listed
 * on the admin Health page with a "Return fee" button. Reads the fee from
 * Stripe each time, so a repeated event can't double count.
 */
async function recordFeeOwed(orderId: string, charge: Stripe.Charge): Promise<void> {
  const feeId = typeof charge.application_fee === "string" ? charge.application_fee : charge.application_fee?.id;
  if (!feeId) return; // no fee on this payment (free trial, or a 0% business)
  const fee = await getApplicationFee(feeId);
  if (!fee) return;
  const owed = feeOwedForRefund(fee.amountCents, charge.amount, charge.amount_refunded || 0, fee.refundedCents);
  const { error } = await createAdminClient()
    .from("orders")
    .update({ platform_fee_id: feeId, platform_fee_cents: fee.amountCents, platform_fee_refunded_cents: fee.refundedCents, fee_return_owed_cents: owed })
    .eq("id", orderId);
  if (error) console.error(`[stripe-connect] could not save the fee owed on order ${orderId} (run migration 041):`, error.message);
}

/**
 * A customer disputed (charged back) a payment. Stripe emails the
 * restaurant's Stripe login, which the owner may not watch; the order now
 * records it and the owner is told where to respond.
 */
export async function handleDispute(eventAccount: string | null | undefined, dispute: Stripe.Dispute, opened: boolean): Promise<void> {
  const order = await findOrderForPayment(eventAccount, dispute.payment_intent);
  if (!order) return;
  const admin = createAdminClient();
  await admin.from("orders").update({ dispute_status: dispute.status }).eq("id", order.id);
  if (opened) {
    await sendOrderAttentionEmail({
      businessId: order.business_id,
      subject: "a customer disputed a payment",
      heading: "A payment was disputed",
      intro: `The customer's bank opened a dispute (${dispute.reason.replace(/_/g, " ")}) for this order. Respond in your Stripe dashboard under Payments, Disputes before the deadline Stripe shows, or the money goes back to the customer.`,
      customerName: order.customer_name,
      customerPhone: order.phone,
      totalCents: dispute.amount,
    });
  }
}
