"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdmin } from "@/lib/supabase/platform-admin";

export interface ActionResult {
  success: boolean;
  error?: string;
}

/**
 * Suspending actually disables the AI receptionist itself (is_online
 * = false) — not just a billing label. A suspended business's phone
 * calls will no longer be handled by the AI at all. This is a real,
 * meaningful action, matching what "suspend" should actually mean for
 * a phone-answering service.
 */
export async function suspendBusinessAction(businessId: string, reason: string): Promise<ActionResult> {
  const allowed = await isPlatformAdmin();
  if (!allowed) return { success: false, error: "Not authorized." };

  const admin = createAdminClient();

  const { error: businessError } = await admin
    .from("businesses")
    .update({ is_suspended: true, suspended_at: new Date().toISOString(), suspended_reason: reason || null })
    .eq("id", businessId);
  if (businessError) return { success: false, error: businessError.message };

  // Actually turn the AI off — this is the real, meaningful part of
  // suspension, not just a status label.
  await admin.from("ai_receptionists").update({ is_online: false }).eq("business_id", businessId);

  revalidatePath("/admin");
  revalidatePath(`/admin/businesses/${businessId}`);
  return { success: true };
}

export async function reactivateBusinessAction(businessId: string): Promise<ActionResult> {
  const allowed = await isPlatformAdmin();
  if (!allowed) return { success: false, error: "Not authorized." };

  const admin = createAdminClient();

  const { error } = await admin
    .from("businesses")
    .update({ is_suspended: false, suspended_at: null, suspended_reason: null })
    .eq("id", businessId);
  if (error) return { success: false, error: error.message };

  // Note: this deliberately does NOT automatically turn the AI back
  // online — that's a separate, real decision the business owner (or
  // admin) should make explicitly, not something that silently
  // re-activates on its own.

  revalidatePath("/admin");
  revalidatePath(`/admin/businesses/${businessId}`);
  return { success: true };
}

/**
 * Real, permanent deletion. Requires the exact business name typed as
 * confirmation, checked server-side (not just a client-side dialog
 * that could be bypassed) — matching the spec's own explicit
 * requirement for especially dangerous actions.
 *
 * Explicitly deletes related records first, rather than assuming
 * cascading foreign keys are configured — safer than relying on an
 * assumption that can't be verified from here.
 */
export async function deleteBusinessAction(businessId: string, typedConfirmationName: string): Promise<ActionResult> {
  const allowed = await isPlatformAdmin();
  if (!allowed) return { success: false, error: "Not authorized." };

  const admin = createAdminClient();

  const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();
  if (!business) return { success: false, error: "Business not found." };

  if (typedConfirmationName.trim() !== business.name.trim()) {
    return { success: false, error: "The typed name doesn't match — nothing was deleted." };
  }

  // Delete related records explicitly, in a safe order, rather than
  // trusting unverified cascade behavior.
  await admin.from("call_messages").delete().in(
    "call_id",
    (await admin.from("calls").select("id").eq("business_id", businessId)).data?.map((c) => c.id) || []
  );
  await admin.from("calls").delete().eq("business_id", businessId);
  await admin.from("order_item_modifiers").delete().in(
    "order_item_id",
    (await admin.from("order_items").select("id").in(
      "order_id",
      (await admin.from("orders").select("id").eq("business_id", businessId)).data?.map((o) => o.id) || []
    )).data?.map((i) => i.id) || []
  );
  await admin.from("order_items").delete().in(
    "order_id",
    (await admin.from("orders").select("id").eq("business_id", businessId)).data?.map((o) => o.id) || []
  );
  await admin.from("orders").delete().eq("business_id", businessId);
  await admin.from("modifiers").delete().eq("business_id", businessId);
  await admin.from("modifier_groups").delete().eq("business_id", businessId);
  await admin.from("menu_items").delete().eq("business_id", businessId);
  await admin.from("menu_categories").delete().eq("business_id", businessId);
  await admin.from("customers").delete().eq("business_id", businessId);
  await admin.from("ai_receptionists").delete().eq("business_id", businessId);
  await admin.from("business_members").delete().eq("business_id", businessId);
  await admin.from("businesses").delete().eq("id", businessId);

  revalidatePath("/admin");
  return { success: true };
}
