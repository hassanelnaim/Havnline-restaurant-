import { createAdminClient } from "@/lib/supabase/admin";
import { refundOrderPayment } from "@/lib/billing/stripeConnect";
import { smsClient } from "@/lib/integrations/sms";
import { sendOrderRefundedEmail } from "@/lib/notifications/account-email";
import { dbErrorResult } from "@/lib/errors";

export interface ProcessOrderRefundResult {
  success: boolean;
  error?: string;
  refundedCents?: number;
  fullyRefunded?: boolean;
}

export interface ProcessOrderRefundActor {
  /** auth.users id of the dashboard owner who clicked Refund, or null for a tablet-initiated action — there's no per-staff identity behind the shared money PIN, see lib/security/moneyPin.ts. */
  refundedByUserId: string | null;
}

/**
 * The actual refund mechanics, extracted so the dashboard's
 * refundOrderAction (app/actions/payments.ts) and the PIN-gated
 * tablet refund/discount route
 * (app/api/printer-app/orders/[id]/refund) can't drift apart on the
 * trickier bits — the idempotency key and the compare-and-swap
 * update. A "discount" from the tablet is just a partial refund with
 * a different reason label; both callers land here either way.
 *
 * Both callers have already decided this refund should happen before
 * calling this — a dashboard session that's already authenticated as
 * a member of this business, or a tablet that's already proven its
 * device_token AND a freshly verified money-action token. This
 * function itself does no authorization, only the business_id scoping
 * on the order lookup below.
 */
export async function processOrderRefund(
  businessId: string,
  orderId: string,
  amountCents: number | undefined,
  reason: string,
  actor: ProcessOrderRefundActor
): Promise<ProcessOrderRefundResult> {
  const admin = createAdminClient();

  const { data: order } = await admin.from("orders").select("*").eq("id", orderId).eq("business_id", businessId).single();
  if (!order) return { success: false, error: "Order not found." };
  if (order.payment_status !== "paid" && order.payment_status !== "partially_refunded") {
    return { success: false, error: "This order hasn't been paid, so there's nothing to refund." };
  }
  if (!order.stripe_payment_intent_id) return { success: false, error: "No payment on file for this order." };

  const { data: business } = await admin.from("businesses").select("name, stripe_connect_account_id").eq("id", businessId).single();
  if (!business?.stripe_connect_account_id) return { success: false, error: "Stripe isn't connected for this business." };

  // Keyed on the exact pre-refund state just read: two near-
  // simultaneous submissions of the SAME click/tap (a double-tap, a
  // dropped-response retry) will almost always both read the same
  // amount_refunded_cents before either write lands, so they produce
  // the identical key and Stripe itself collapses them into one real
  // refund. A genuinely separate, later refund or discount (the
  // amount already on file has since changed) gets its own distinct
  // key and goes through normally.
  const idempotencyKey = `refund:${orderId}:${order.amount_refunded_cents}:${amountCents ?? "full"}`;
  const result = await refundOrderPayment(business.stripe_connect_account_id, order.stripe_payment_intent_id, amountCents, idempotencyKey);
  if (!result.success) return { success: false, error: result.error };

  const newAmountRefunded = order.amount_refunded_cents + (result.refundedCents || 0);
  const fullyRefunded = newAmountRefunded >= order.total_cents;

  // Guarded by the same pre-refund amount the idempotency key used —
  // if another request already moved amount_refunded_cents in the
  // meantime, this intentionally matches no row rather than stomping
  // a newer value with a total computed from stale data.
  const { data: updatedOrder, error } = await admin
    .from("orders")
    .update({
      payment_status: fullyRefunded ? "refunded" : "partially_refunded",
      amount_refunded_cents: newAmountRefunded,
      refund_reason: reason || order.refund_reason,
      refunded_by: actor.refundedByUserId,
      refunded_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("amount_refunded_cents", order.amount_refunded_cents)
    .select("id")
    .maybeSingle();
  if (error) return dbErrorResult(error, "processOrderRefund", "Could not record the refund.");
  if (!updatedOrder) {
    // Stripe's own idempotency already prevented a double charge (see
    // above) — this just means another request recorded the result
    // first. Still a success from this caller's point of view, but
    // skip the SMS below: whichever request actually wins the update
    // below sends it, so a near-simultaneous double-tap/retry can't
    // text the customer twice for the same refund.
    return { success: true, refundedCents: result.refundedCents, fullyRefunded };
  }

  // Customers get a text when an order is placed and when payment
  // comes through (see lib/ai/tools.ts and the Stripe Connect
  // webhook) but, until now, nothing at all when money went back to
  // their card — silent from their side even though real money moved.
  if (order.phone && business?.name && result.refundedCents) {
    const smsBody = `${business.name}: $${(result.refundedCents / 100).toFixed(2)} has been refunded to your card${fullyRefunded ? "" : " for part of your order"}. It can take a few business days to show up on your statement. Msg&data rates may apply.`;
    smsClient.send(businessId, order.phone, smsBody).catch((err) => console.error("Refund-confirmation SMS failed:", err));
  }

  // The owner/staff side of the same gap: nothing told them a refund
  // actually went through either, beyond whoever happened to click
  // the button themselves. Fires only here, after Stripe and the DB
  // both confirm it really happened — never optimistically.
  if (result.refundedCents) {
    sendOrderRefundedEmail({
      businessId,
      orderId,
      customerName: order.customer_name,
      customerPhone: order.phone,
      refundedCents: result.refundedCents,
      fullyRefunded,
      reason,
    }).catch((err) => console.error("Order-refunded email failed:", err));
  }

  return { success: true, refundedCents: result.refundedCents, fullyRefunded };
}
