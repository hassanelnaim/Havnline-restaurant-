import type { OrderPaymentStatus } from "@/lib/database/types";

export type OrderStatusLike = "building" | "confirmed" | "submitted" | "failed" | "cancelled";

/**
 * Whether an order represents money that will actually be collected —
 * the single rule every sales total in the app should use (Overview's
 * "Total sales today", the Orders page's "Today" summary, End of day,
 * exported reports, the weekly digest email).
 *
 * Two things have to both be true:
 * 1. The order wasn't abandoned (not "building", not "cancelled").
 * 2. Payment is actually settled — "paid", or "not_required" (a
 *    pay-at-pickup order that was never gated on payment up front).
 *
 * A phone-payments order sits at status "confirmed" the moment the AI
 * takes it over the phone, *before* the customer has paid — it only
 * reaches payment_status "paid" once they tap the texted Stripe link.
 * Before this existed, every sales total in the app only checked
 * `status`, so an order still waiting on that payment (or one whose
 * payment link expired and was never paid) was counted as revenue the
 * moment the call ended — overstating sales for any restaurant using
 * phone payments. Orders that are still building, or were cancelled
 * (including an expired/failed payment link — see the Connect webhook
 * in app/api/webhooks/stripe-connect/route.ts), never count.
 */
export function countsTowardSales(order: { status: OrderStatusLike | string; payment_status: OrderPaymentStatus | string }): boolean {
  if (order.status === "building" || order.status === "cancelled") return false;
  return order.payment_status === "paid" || order.payment_status === "not_required";
}
