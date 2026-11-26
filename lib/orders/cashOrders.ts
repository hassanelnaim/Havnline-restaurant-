import { createAdminClient } from "@/lib/supabase/admin";

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
