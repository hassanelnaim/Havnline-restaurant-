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

// Cancelling an order now goes through voidOrderAction (see
// app/actions/payments.ts) instead of living here — voiding needs to
// also expire the order's Stripe Checkout Session when one exists, so
// a customer's payment link can't still be used after the business
// has already called the order off.
