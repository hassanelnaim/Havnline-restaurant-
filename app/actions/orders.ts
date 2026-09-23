"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { getOrderWithItems } from "@/lib/data/orders";
import { submitOrderToSpotOn } from "@/lib/integrations/spoton";

export interface ActionResult {
  success: boolean;
  error?: string;
}

/**
 * Retries sending an order to SpotOn after it failed the first time
 * (business wasn't connected yet, a temporary SpotOn outage, an item
 * mapping issue that's since been fixed). Scoped to the signed-in
 * business — never trusts an order_id without checking ownership.
 */
export async function retrySubmitOrderAction(orderId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await getCurrentBusinessId();
  if (!businessId) return { success: false, error: "Not signed in." };

  const order = await getOrderWithItems(orderId);
  if (!order || order.business_id !== businessId) return { success: false, error: "Order not found." };

  const result = await submitOrderToSpotOn(order);
  const admin = createAdminClient();

  if (result.success) {
    await admin
      .from("orders")
      .update({ status: "submitted", spoton_order_id: result.spotonOrderId, submitted_at: new Date().toISOString(), submit_error: null, tax_cents: result.taxCents, total_cents: order.subtotal_cents + result.taxCents })
      .eq("id", orderId);
  } else {
    await admin.from("orders").update({ submit_error: result.error }).eq("id", orderId);
  }

  revalidatePath("/dashboard/orders");
  return result.success ? { success: true } : { success: false, error: result.error };
}

export async function cancelOrderAction(orderId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await getCurrentBusinessId();
  if (!businessId) return { success: false, error: "Not signed in." };

  const admin = createAdminClient();
  const { error } = await admin.from("orders").update({ status: "cancelled" }).eq("id", orderId).eq("business_id", businessId);
  if (error) return { success: false, error: error.message };

  revalidatePath("/dashboard/orders");
  return { success: true };
}
