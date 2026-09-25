"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { provisionNumber, releaseNumber, createSubAccount } from "@/lib/integrations/telephony/twilioProvider";
import type { AiResponsibilities, Personality, VoiceId } from "@/lib/database/types";

async function requireBusinessId(): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  const businessId = await getCurrentBusinessId();
  if (!businessId) throw new Error("No business found for this account.");
  return businessId;
}

async function requireOperationalSubscription(businessId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("subscription_status").eq("id", businessId).single();

  const status = business?.subscription_status;
  const operational = status === "active" || status === "trialing" || status === "past_due";

  return operational ? null : "Start your free trial in Billing before setting up a phone number.";
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

export async function updateBusinessProfileAction(input: {
  name: string;
  description: string;
  address: string;
  phone: string;
}): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("businesses")
    .update({ name: input.name, description: input.description || null, address: input.address || null, phone: input.phone || null })
    .eq("id", businessId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/settings");
  return { success: true };
}

export interface HoursInput {
  weekday: string;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
}

export async function updateBusinessHoursAction(hours: HoursInput[]): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const admin = createAdminClient();
  const rows = hours.map((h) => ({
    business_id: businessId,
    weekday: h.weekday,
    is_open: h.isOpen,
    open_time: h.isOpen ? h.openTime : null,
    close_time: h.isOpen ? h.closeTime : null,
  }));

  const { error } = await admin.from("business_hours").upsert(rows, { onConflict: "business_id,weekday" });
  if (error) return { success: false, error: error.message };

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/ai-employee");
  return { success: true };
}

export async function updateAiEmployeeAction(input: {
  name: string;
  personality: Personality;
  responsibilities: AiResponsibilities;
  voiceId: VoiceId;
  orderingRules: string;
  escalationRules: string;
  customVoice?: { providerVoiceRef: string; providerVoiceName: string } | null;
}): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const admin = createAdminClient();

  const { error: aiError } = await admin
    .from("ai_receptionists")
    .update({
      name: input.name,
      personality: input.personality,
      responsibilities: input.responsibilities,
      ordering_rules: input.orderingRules || null,
      escalation_rules: input.escalationRules || null,
    })
    .eq("business_id", businessId);
  if (aiError) return { success: false, error: aiError.message };

  const { error: voiceError } = await admin.from("ai_voice_configs").upsert(
    input.customVoice
      ? {
          business_id: businessId,
          voice_id: "custom",
          provider: "elevenlabs",
          provider_voice_ref: input.customVoice.providerVoiceRef,
          provider_voice_name: input.customVoice.providerVoiceName,
        }
      : { business_id: businessId, voice_id: input.voiceId, provider: null, provider_voice_ref: null, provider_voice_name: null },
    { onConflict: "business_id" }
  );
  if (voiceError) return { success: false, error: voiceError.message };

  revalidatePath("/dashboard/ai-employee");
  return { success: true };
}

export async function toggleAiStatusAction(online: boolean): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  if (online) {
    const subscriptionError = await requireOperationalSubscription(businessId);
    if (subscriptionError) return { success: false, error: subscriptionError };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("ai_receptionists").update({ status: online ? "online" : "offline" }).eq("business_id", businessId);
  if (error) return { success: false, error: error.message };

  revalidatePath("/dashboard");
  return { success: true };
}

export interface ProvisionResult extends ActionResult {
  phoneNumber?: string;
}

async function getOrCreateSubAccount(businessId: string, businessName: string): Promise<{ accountSid: string; authToken: string } | { error: string }> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("integrations").select("metadata").eq("business_id", businessId).eq("provider", "twilio").maybeSingle();

  const meta = existing?.metadata as Record<string, unknown> | null;
  if (meta?.subaccount_sid && meta?.subaccount_auth_token) {
    return { accountSid: meta.subaccount_sid as string, authToken: meta.subaccount_auth_token as string };
  }

  const result = await createSubAccount(businessName);
  if (!result.success || !result.accountSid || !result.authToken) {
    return { error: result.reason || "Could not create a Twilio sub-account for this business." };
  }
  return { accountSid: result.accountSid, authToken: result.authToken };
}

// Enforced here, not just in the UI, so a request that skips the
// client (or a bug in it) can't slip through and get the business a
// number in a random, possibly unusable area code.
function validateAreaCode(areaCode: string | undefined): string | null {
  if (!areaCode || !/^\d{3}$/.test(areaCode)) return "Enter a 3-digit area code before requesting a number.";
  return null;
}

export async function provisionPhoneNumberAction(areaCode?: string): Promise<ProvisionResult> {
  const areaCodeError = validateAreaCode(areaCode);
  if (areaCodeError) return { success: false, error: areaCodeError };

  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const subscriptionError = await requireOperationalSubscription(businessId);
  if (subscriptionError) return { success: false, error: subscriptionError };

  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();

  const subAccount = await getOrCreateSubAccount(businessId, business?.name || "Business");
  if ("error" in subAccount) return { success: false, error: subAccount.error };

  const result = await provisionNumber({ accountSid: subAccount.accountSid, authToken: subAccount.authToken }, areaCode);
  if (!result.success || !result.phoneNumber) return { success: false, error: result.reason || "Could not provision a number." };

  await admin.from("integrations").upsert(
    {
      business_id: businessId,
      provider: "twilio",
      status: "connected",
      connected_at: new Date().toISOString(),
      metadata: { phone_number: result.phoneNumber, subaccount_sid: subAccount.accountSid, subaccount_auth_token: subAccount.authToken },
    },
    { onConflict: "business_id,provider" }
  );

  revalidatePath("/dashboard/integrations");
  revalidatePath("/dashboard/settings");
  return { success: true, phoneNumber: result.phoneNumber };
}

export async function changePhoneNumberAction(areaCode?: string): Promise<ProvisionResult> {
  const areaCodeError = validateAreaCode(areaCode);
  if (areaCodeError) return { success: false, error: areaCodeError };

  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const subscriptionError = await requireOperationalSubscription(businessId);
  if (subscriptionError) return { success: false, error: subscriptionError };

  const admin = createAdminClient();
  // Validated above, before any of this function's side effects
  // (releasing the current number) — an invalid area code must not
  // reach the point where we've already given up a working number.
  const { data: existing } = await admin.from("integrations").select("metadata").eq("business_id", businessId).eq("provider", "twilio").maybeSingle();

  const meta = existing?.metadata as Record<string, unknown> | null;
  const currentNumber = meta?.phone_number as string | undefined;
  const subAccountSid = meta?.subaccount_sid as string | undefined;
  const subAccountAuthToken = meta?.subaccount_auth_token as string | undefined;

  if (currentNumber) {
    const releaseCreds = subAccountSid && subAccountAuthToken ? { accountSid: subAccountSid, authToken: subAccountAuthToken } : null;
    await releaseNumber(releaseCreds, currentNumber);
  }

  const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();
  const subAccount = await getOrCreateSubAccount(businessId, business?.name || "Business");
  if ("error" in subAccount) return { success: false, error: subAccount.error };

  const result = await provisionNumber({ accountSid: subAccount.accountSid, authToken: subAccount.authToken }, areaCode);
  if (!result.success || !result.phoneNumber) {
    await admin.from("integrations").update({ status: "not_connected", metadata: null }).eq("business_id", businessId).eq("provider", "twilio");
    revalidatePath("/dashboard/integrations");
    return { success: false, error: result.reason || "Could not provision a new number." };
  }

  await admin.from("integrations").upsert(
    {
      business_id: businessId,
      provider: "twilio",
      status: "connected",
      connected_at: new Date().toISOString(),
      metadata: { phone_number: result.phoneNumber, subaccount_sid: subAccount.accountSid, subaccount_auth_token: subAccount.authToken },
    },
    { onConflict: "business_id,provider" }
  );

  revalidatePath("/dashboard/integrations");
  return { success: true, phoneNumber: result.phoneNumber };
}

export interface NotificationPreferences {
  calls: boolean;
  escalations: boolean;
  digest: boolean;
}

/**
 * Real, persisted notification