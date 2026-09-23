"use server";

import { revalidatePath } from "next/cache";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";

type ActionResult = { success: true } | { success: false; error: string };

/**
 * Blocks a customer's number so the business can see it was intentionally
 * silenced. IDOR-safe: the update is scoped to both the customer id AND
 * the caller's own business_id, so a business can never touch another
 * business's customer row even if it somehow got the id.
 */
export async function blockCustomerAction(customerId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await getCurrentBusinessId();
  if (!businessId) return { success: false, error: "Not signed in." };

  const supabase = createClient();
  const { error } = await supabase
    .from("customers")
    .update({ is_blocked: true, blocked_at: new Date().toISOString() })
    .eq("id", customerId)
    .eq("business_id", businessId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/customers");
  return { success: true };
}

export async function unblockCustomerAction(customerId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await getCurrentBusinessId();
  if (!businessId) return { success: false, error: "Not signed in." };

  const supabase = createClient();
  const { error } = await supabase
    .from("customers")
    .update({ is_blocked: false, blocked_at: null })
    .eq("id", customerId)
    .eq("business_id", businessId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/customers");
  return { success: true };
}

/**
 * Permanently deletes a customer record. Scoped to business_id for the
 * same IDOR-safety reason as above. This does not touch past calls or
 * orders tied to this customer_id — those keep their own
 * customer_name/phone snapshot and remain in history.
 */
export async function deleteCustomerAction(customerId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await getCurrentBusinessId();
  if (!businessId) return { success: false, error: "Not signed in." };

  const supabase = createClient();
  const { error } = await supabase
    .from("customers")
    .delete()
    .eq("id", customerId)
    .eq("business_id", businessId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/customers");
  return { success: true };
}
