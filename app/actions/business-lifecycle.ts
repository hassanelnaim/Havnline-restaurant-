"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/supabase/platform-admin";
import { sendBusinessSuspendedEmail, sendBusinessReactivatedEmail } from "@/lib/notifications/account-email";
import { releaseNumber } from "@/lib/integrations/telephony/twilioProvider";
import { dbErrorResult } from "@/lib/errors";

export interface ActionResult {
  success: boolean;
  error?: string;
}

const DEMO_MODE_ERROR = "This is a preview with demo data — connect Supabase to make real changes.";

/**
 * Suspending actually disables the AI order-taker itself (status =
 * "offline") — not just a billing label. A suspended business's phone
 * calls will no longer be handled by the AI at all. This is a real,
 * meaningful action, matching what "suspend" should actually mean for
 * a restaurant's AI order-taker.
 */
export async function suspendBusinessAction(businessId: string, reason: string): Promise<ActionResult> {
  const allowed = await isPlatformAdmin();
  if (!allowed) return { success: false, error: "Not authorized." };
  if (!isSupabaseConfigured()) return { success: false, error: DEMO_MODE_ERROR };

  const admin = createAdminClient();

  const { error: businessError } = await admin
    .from("businesses")
    .update({ is_suspended: true, suspended_at: new Date().toISOString(), suspended_reason: reason || null })
    .eq("id", businessId);
  if (businessError) return dbErrorResult(businessError, "suspendBusinessAction", "Could not suspend that business.");

  // Actually turn the AI off — this is the real, meaningful part of
  // suspension, not just a status label. Column is "status"
  // ("online"/"offline"), matching ai_receptionists everywhere else
  // in the app (see toggleAiStatusAction) — not "is_online".
  const { error: aiError } = await admin.from("ai_receptionists").update({ status: "offline" }).eq("business_id", businessId);
  if (aiError) {
    console.error("[suspendBusinessAction:ai]", aiError.message);
    return { success: false, error: "Business was suspended, but turning off the AI failed. Check server logs and retry." };
  }

  sendBusinessSuspendedEmail(businessId, reason).catch((err) => console.error("Business-suspended email failed:", err));

  revalidatePath("/admin");
  revalidatePath(`/admin/businesses/${businessId}`);
  return { success: true };
}

export async function reactivateBusinessAction(businessId: string): Promise<ActionResult> {
  const allowed = await isPlatformAdmin();
  if (!allowed) return { success: false, error: "Not authorized." };
  if (!isSupabaseConfigured()) return { success: false, error: DEMO_MODE_ERROR };

  const admin = createAdminClient();

  const { error } = await admin
    .from("businesses")
    .update({ is_suspended: false, suspended_at: null, suspended_reason: null })
    .eq("id", businessId);
  if (error) return dbErrorResult(error, "reactivateBusinessAction", "Could not reactivate that business.");

  // Note: this deliberately does NOT automatically turn the AI back
  // online — that's a separate, real decision the business owner (or
  // admin) should make explicitly, not something that silently
  // re-activates on its own.

  sendBusinessReactivatedEmail(businessId).catch((err) => console.error("Business-reactivated email failed:", err));

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
  if (!isSupabaseConfigured()) return { success: false, error: DEMO_MODE_ERROR };

  const admin = createAdminClient();

  const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();
  if (!business) return { success: false, error: "Business not found." };

  if (typedConfirmationName.trim() !== business.name.trim()) {
    return { success: false, error: "The typed name doesn't match — nothing was deleted." };
  }

  // Release the actual Twilio phone number BEFORE deleting anything.
  // The `integrations` row is just our own record of it — deleting
  // that (or letting it cascade away with the business below) does
  // NOT release the number on Twilio's side. Without this, a deleted
  // business's number keeps costing real money on Twilio indefinitely,
  // orphaned with no dashboard left to manage or release it from.
  const { data: twilioIntegration } = await admin
    .from("integrations")
    .select("metadata")
    .eq("business_id", businessId)
    .eq("provider", "twilio")
    .maybeSingle();
  const twilioMeta = twilioIntegration?.metadata as Record<string, unknown> | null;
  const phoneNumber = twilioMeta?.phone_number as string | undefined;
  if (phoneNumber) {
    const subAccountSid = twilioMeta?.subaccount_sid as string | undefined;
    const subAccountAuthToken = twilioMeta?.subaccount_auth_token as string | undefined;
    const creds = subAccountSid && subAccountAuthToken ? { accountSid: subAccountSid, authToken: subAccountAuthToken } : null;
    const released = await releaseNumber(creds, phoneNumber);
    if (!released.success) {
      // Don't let a Twilio hiccup block a deletion the admin already
      // explicitly confirmed — but don't pretend it succeeded either.
      console.error(`deleteBusinessAction: could not release Twilio number ${phoneNumber} for business ${businessId}: ${released.reason}`);
    }
  }

  // Delete related records explicitly, in a safe order, rather than
  // trusting unverified cascade behavior — and actually check each
  // one, rather than reporting success regardless of what happened.
  const steps: { label: string; run: () => Promise<{ error: { message: string } | null }> }[] = [
    {
      label: "call messages",
      run: async () =>
        admin.from("call_messages").delete().in(
          "call_id",
          (await admin.from("calls").select("id").eq("business_id", businessId)).data?.map((c) => c.id) || []
        ),
    },
    { label: "calls", run: async () => admin.from("calls").delete().eq("business_id", businessId) },
    {
      label: "order item modifiers",
      run: async () =>
        admin.from("order_item_modifiers").delete().in(
          "order_item_id",
          (await admin.from("order_items").select("id").in(
            "order_id",
            (await admin.from("orders").select("id").eq("business_id", businessId)).data?.map((o) => o.id) || []
          )).data?.map((i) => i.id) || []
        ),
    },
    {
      label: "order items",
      run: async () =>
        admin.from("order_items").delete().in(
          "order_id",
          (await admin.from("orders").select("id").eq("business_id", businessId)).data?.map((o) => o.id) || []
        ),
    },
    { label: "orders", run: async () => admin.from("orders").delete().eq("business_id", businessId) },
    { label: "modifiers", run: async () => admin.from("modifiers").delete().eq("business_id", businessId) },
    { label: "modifier groups", run: async () => admin.from("modifier_groups").delete().eq("business_id", businessId) },
    { label: "menu item add-on attachments", run: async () => admin.from("menu_item_modifier_groups").delete().eq("business_id", businessId) },
    { label: "menu items", run: async () => admin.from("menu_items").delete().eq("business_id", businessId) },
    { label: "menu categories", run: async () => admin.from("menu_categories").delete().eq("business_id", businessId) },
    { label: "customers", run: async () => admin.from("customers").delete().eq("business_id", businessId) },
    { label: "knowledge items", run: async () => admin.from("knowledge_items").delete().eq("business_id", businessId) },
    { label: "promotions", run: async () => admin.from("promotions").delete().eq("business_id", businessId) },
    { label: "printer devices", run: async () => admin.from("printer_devices").delete().eq("business_id", businessId) },
    { label: "printer pairing codes", run: async () => admin.from("printer_pairing_codes").delete().eq("business_id", businessId) },
    { label: "business hours", run: async () => admin.from("business_hours").delete().eq("business_id", businessId) },
    { label: "AI voice config", run: async () => admin.from("ai_voice_configs").delete().eq("business_id", businessId) },
    { label: "AI receptionist", run: async () => admin.from("ai_receptionists").delete().eq("business_id", businessId) },
    { label: "integrations", run: async () => admin.from("integrations").delete().eq("business_id", businessId) },
    { label: "business members", run: async () => admin.from("business_members").delete().eq("business_id", businessId) },
    { label: "business", run: async () => admin.from("businesses").delete().eq("id", businessId) },
  ];

  for (const step of steps) {
    const { error } = await step.run();
    if (error) {
      return { success: false, error: `Deletion stopped while removing ${step.label}: ${error.message}. Some data may have already been removed — check with engineering before retrying.` };
    }
  }

  revalidatePath("/admin");
  return { success: true };
}
