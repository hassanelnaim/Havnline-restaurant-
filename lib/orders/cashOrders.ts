import { createAdminClient } from "@/lib/supabase/admin";
import { runAfterResponse } from "@/lib/runtime/afterResponse";
import { sendOrderRefundedEmail } from "@/lib/notifications/account-email";

/**
 * Closing a cash-at-pickup order (migration 052): staff tap "Paid in cash"
 * when the customer pays, or "No-show" when nobody comes for it. A no-show
 * cancels the order (so it isn't a sale and HavnLine's fee isn't charged)
 * and that phone number can only pay by card from then on.
 */

export type CashAction = "paid" | "no_show";

export interface CashActionResult {
  success: boolean;
  error?: string;
}

export async function closeCashOrder(businessId: string, orderId: string, action: CashAction): Promise<CashActionResult> {
  const admin = createAdminClient();
  const { data: order, error } = await admin.from("orders").select("*").eq("id", orderId).eq("business_id", businessId).maybeSingle();
  if (error || !order) return { success: false, error: "Order not found." };
  if (order.payment_method !== "cash") return { success: false, error: "This isn't a cash order." };
  if (order.status === "cancelled") return { success: false, error: order.no_show_at ? "This order is already marked as a no-show." : "This order was cancelled." };
  if (order.cash_collected_at || order.payment_status === "paid") return { success: false, error: "This order is already marked paid." };

  const now = new Date().toISOString();
  if (action === "paid") {
    const { data, error: updateError } = await admin
      .from("orders")
      .update({ payment_status: "paid", cash_collected_at: now })
      .eq("id", orderId)
      .eq("payment_status", "not_required")
      .neq("status", "cancelled")
      .select("id");
    if (updateError) return { success: false, error: "Couldn't save that. Try again." };
    if (!data?.length) return { success: false, error: "This order changed a moment ago. Refresh and try again." };
    return { success: true };
  }

  const { data, error: updateError } = await admin
    .from("orders")
    .update({ status: "cancelled", no_show_at: now })
    .eq("id", orderId)
    .eq("payment_status", "not_required")
    .is("cash_collected_at", null)
    .neq("status", "cancelled")
    .select("id");
  if (updateError) return { success: false, error: "Couldn't save that. Try again." };
  if (!data?.length) return { success: false, error: "This order changed a moment ago. Refresh and try again." };

  // That number pays by card from now on (the restaurant can clear it).
  if (order.customer_id) {
    await admin.from("customers").update({ card_only_since: now }).eq("id", order.customer_id).is("card_only_since", null);
  } else if (order.phone) {
    await admin.from("customers").update({ card_only_since: now }).eq("business_id", businessId).eq("phone", order.phone).is("card_only_since", null);
  }
  return { success: true };
}

export interface CashRefundResult {
  success: boolean;
  error?: string;
  refundedCents?: number;
  fullyRefunded?: boolean;
}

/**
 * Refunding (or discounting) a cash order from the tablet, behind the
 * manager PIN like a card refund. The money goes back over the counter, so
 * nothing is sent to Stripe: this records how much was given back, and
 * HavnLine's 3% on that order is lowered to match (it's billed a day after
 * the order, so a same-day refund always lands before the bill).
 *
 * Only after "Paid in cash": before that, nothing has been paid to give back.
 */
export async function refundCashOrder(businessId: string, orderId: string, amountCents: number | undefined, reason: string): Promise<CashRefundResult> {
  if (amountCents !== undefined && (!Number.isInteger(amountCents) || amountCents < 1)) return { success: false, error: "Enter an amount greater than $0." };
  const admin = createAdminClient();
  const { data: order, error } = await admin.from("orders").select("*").eq("id", orderId).eq("business_id", businessId).maybeSingle();
  if (error || !order) return { success: false, error: "Order not found." };
  if (order.payment_method !== "cash") return { success: false, error: "This isn't a cash order." };
  if (order.status === "cancelled") return { success: false, error: "This order was cancelled, so there's nothing to refund." };
  if (!order.cash_collected_at) return { success: false, error: "Tap \"Paid in cash\" once the customer pays. Until then there's nothing to refund." };

  const already = order.amount_refunded_cents || 0;
  const remaining = order.total_cents - already;
  if (remaining <= 0) return { success: false, error: "This order has already been refunded in full." };
  const refund = amountCents ?? remaining;
  if (refund > remaining) return { success: false, error: `Can't refund more than the $${(remaining / 100).toFixed(2)} left on this order.` };

  const newRefunded = already + refund;
  const fullyRefunded = newRefunded >= order.total_cents;
  const update: Record<string, unknown> = {
    payment_status: fullyRefunded ? "refunded" : "partially_refunded",
    amount_refunded_cents: newRefunded,
    refund_reason: reason || order.refund_reason,
    refunded_by: null,
    refunded_at: new Date().toISOString(),
  };
  // HavnLine's cut follows what the restaurant actually kept.
  if (!order.cash_fee_billed_at && (order.cash_fee_cents || 0) > 0 && remaining > 0) {
    update.cash_fee_cents = Math.round((order.cash_fee_cents * (order.total_cents - newRefunded)) / remaining);
  }

  // Guarded on the amount just read, so a double tap refunds once.
  const { data: saved, error: saveError } = await admin
    .from("orders")
    .update(update)
    .eq("id", orderId)
    .eq("amount_refunded_cents", already)
    .select("id")
    .maybeSingle();
  if (saveError) return { success: false, error: "Couldn't save the refund. Try again." };
  if (!saved) return { success: false, error: "This order changed a moment ago. Refresh and check before refunding again." };
  if (order.cash_fee_billed_at && (order.cash_fee_cents || 0) > 0) {
    console.warn(`[cash refund] order ${orderId} was refunded after its fee was billed; the fee wasn't lowered`);
  }

  runAfterResponse("order-refunded email", sendOrderRefundedEmail({
    businessId,
    orderId,
    customerName: order.customer_name,
    customerPhone: order.phone,
    refundedCents: refund,
    fullyRefunded,
    reason,
    method: "cash",
  }));
  return { success: true, refundedCents: refund, fullyRefunded };
}
