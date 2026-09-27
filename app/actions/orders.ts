"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { getOrderWithItems } from "@/lib/data/orders";
import { getBusiness } from "@/lib/data/business";
import { queuePrintJob } from "@/lib/integrations/printer-app";

export interface ActionResult {
  success: boolean;
  error?: string;
}

/**
 * Retries sending an order to the kitchen printer app after it failed
 * the first time (tablet wasn't paired yet, printer was offline).
 * Scoped to the signed-in business — never trusts an order_id without
 * checking ownership.
 */
export async function retrySubmitOrderAction(orderId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await getCurrentBusinessId();
  if (!businessId) return { success: false, error: "Not signed in." };

  const order = await getOrderWithItems(orderId);
  if (!order || order.business_id !== businessId) return { success: false, error: "Order not found." };

  const business = await getBusiness();
  const result = await queuePrintJob(order, business);
  const admin = createAdminClient();

  if (result.success) {
    await admin
      .from("orders")
      .update({ status: "submitted", submitted_at: new Date().toISOString(), submit_error: null })
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
