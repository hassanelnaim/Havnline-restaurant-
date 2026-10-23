"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { provisionNumber, releaseNumber, createSubAccount } from "@/lib/integrations/telephony/twilioProvider";
import { generateInstructions } from "@/lib/ai/generateInstructions";
import type { AiResponsibilities, Personality, VoiceId } from "@/lib/database/types";
import { dbErrorResult } from "@/lib/errors";
import { setMoneyPin } from "@/lib/security/moneyPin";
import { toDialableNumber } from "@/lib/ai/liveTransfer";

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

// Suspension (see suspendBusinessAction) enforces itself by flipping
// ai_receptionists.status to "offline" — the same column the owner's
// own dashboard toggle controls. Without this check, a suspended
// business could just click "AI Online" again and immediately resume
// taking calls and payments, bypassing the suspension entirely.
async function requireNotSuspended(businessId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("is_suspended").eq("id", businessId).single();
  return business?.is_suspended ? "This account is suspended. Contact support to resolve this before going back online." : null;
}

// Payment is mandatory on every phone order (see confirm_and_place_order
// in lib/ai/tools.ts) — there is no pay-at-pickup path. Without this
// check, an owner whose AI takes orders could flip it online before
// finishing Stripe Connect, and every caller who tries to order would
// hit a dead end. Only applies when take_orders is actually enabled —
// a business using the AI purely to answer questions doesn't need
// payments set up at all.
async function requirePaymentsReadyIfTakingOrders(businessId: string): Promise<string | null> {
  const admin = createAdminClient();
  const [{ data: business }, { data: receptionist }] = await Promise.all([
    admin.from("businesses").select("stripe_connect_charges_enabled").eq("id", businessId).single(),
    admin.from("ai_receptionists").select("responsibilities").eq("business_id", businessId).maybeSingle(),
  ]);
  const takesOrders = (receptionist?.responsibilities as AiResponsibilities | undefined)?.take_orders;
  if (!takesOrders) return null;
  return business?.stripe_connect_charges_enabled ? null : "Finish connecting Stripe in Integrations before going online — every phone order requires payment up front, so your AI can't take orders until that's set up.";
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

export async function updateBusinessProfileAction(input: {
  name: string;
  description: string;
  address: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
  phone: string;
  /** Optional. Only sent when the owner changed it. Empty string clears it. */
  escalationPhone?: string;
  businessType?: string;
}): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  // State is stored uppercase ("NY", not "ny") since it's sent
  // straight to Stripe Tax (lib/billing/stripeTax.ts) for live sales
  // tax calculation on every phone order.
  if (input.addressState !== undefined && input.addressState.trim() && !/^[A-Za-z]{2}$/.test(input.addressState.trim())) {
    return { success: false, error: "State should be a 2-letter abbreviation, like NY." };
  }

  // The optional escalation number: stored normalised so it can be dialled
  // as-is. Blank clears it (escalations go back to the main phone).
  let escalationPhone: string | null | undefined;
  if (input.escalationPhone !== undefined) {
    const raw = input.escalationPhone.trim();
    if (!raw) {
      escalationPhone = null;
    } else {
      const dialable = toDialableNumber(raw);
      if (!dialable) return { success: false, error: "Escalation phone should be a full phone number, like (313) 555-1234." };
      escalationPhone = dialable;
    }
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("businesses")
    .update({
      ...(escalationPhone !== undefined ? { escalation_phone: escalationPhone } : {}),
      name: input.name,
      description: input.description || null,
      address: input.address || null,
      ...(input.addressCity !== undefined ? { address_city: input.addressCity.trim() || null } : {}),
      ...(input.addressState !== undefined ? { address_state: input.addressState.trim().toUpperCase() || null } : {}),
      ...(input.addressZip !== undefined ? { address_zip: input.addressZip.trim() || null } : {}),
      phone: input.phone || null,
      // Feeds lib/ai/systemPrompt.ts directly — the AI's tone/assumptions
      // shift on this (a food truck's AI shouldn't casually mention "your
      // table"; fine dining might warrant a more formal tone), so it's
      // not just a display label.
      ...(input.businessType !== undefined ? { business_type: input.businessType || null } : {}),
    })
    .eq("id", businessId);

  if (error) return dbErrorResult(error, "updateBusinessProfileAction", "Could not save your business profile.");
  revalidatePath("/dashboard/settings");
  return { success: true };
}

/**
 * The legal name and EIN carriers check before they let a business text
 * customers (A2P 10DLC registration). Collected at signup as optional; this
 * lets the owner add or fix them later from the Integrations page. The EIN
 * is never logged and never sent back to the browser.
 */
export async function saveTextingIdentityAction(input: { legalBusinessName: string; ein: string }): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const legalName = input.legalBusinessName.trim();
  const einDigits = input.ein.replace(/\D/g, "");
  if (!legalName) return { success: false, error: "Enter your legal business name, exactly as it appears with the IRS." };
  if (einDigits.length !== 9) return { success: false, error: "An EIN is 9 digits, like 12-3456789." };

  const admin = createAdminClient();
  const { error } = await admin.from("businesses").update({ legal_business_name: legalName, ein: einDigits }).eq("id", businessId);
  if (error) return dbErrorResult(error, "saveTextingIdentityAction", "Could not save your business details.");
  revalidatePath("/dashboard/integrations");
  return { success: true };
}

/**
 * Holiday closures (migration 031). A closure can cover one day or a short
 * run of days ("closed Dec 24 to Dec 26"), stored as one row per date so
 * the open/closed check stays a simple lookup. Saving a date that is
 * already closed just updates its note.
 */
export async function addClosureAction(input: { startDate: string; endDate?: string; note?: string }): Promise<ActionResult & { added?: { id: string; closed_on: string; note: string | null }[] }> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T12:00:00Z`).getTime());
  const start = input.startDate;
  const end = input.endDate || input.startDate;
  if (!isDate(start) || !isDate(end)) return { success: false, error: "Pick a date." };
  if (end < start) return { success: false, error: "The last day can't be before the first day." };

  const admin = createAdminClient();
  const { data: biz } = await admin.from("businesses").select("timezone").eq("id", businessId).single();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: biz?.timezone || "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (start < today) return { success: false, error: "That date has already passed." };

  const days: string[] = [];
  for (let d = start; d <= end; ) {
    days.push(d);
    if (days.length > 31) return { success: false, error: "A closure can be at most 31 days long." };
    const next = new Date(`${d}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }

  const note = (input.note || "").trim().slice(0, 80) || null;
  const { data, error } = await admin
    .from("business_closures")
    .upsert(days.map((closed_on) => ({ business_id: businessId, closed_on, note })), { onConflict: "business_id,closed_on" })
    .select("id, closed_on, note");
  if (error) return dbErrorResult(error, "addClosureAction", "Could not save that closure.");

  revalidatePath("/dashboard/settings");
  return { success: true, added: data || [] };
}

export async function removeClosureAction(closureIds: string[]): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }
  if (closureIds.length === 0) return { success: true };

  const admin = createAdminClient();
  const { error } = await admin.from("business_closures").delete().eq("business_id", businessId).in("id", closureIds);
  if (error) return dbErrorResult(error, "removeClosureAction", "Could not remove that closure.");
  revalidatePath("/dashboard/settings");
  return { success: true };
}

// The tablet-redesign PIN (see lib/security/moneyPin.ts) that staff
// enter on the paired tablet before a refund or discount. Set or
// changed from here, same as the tax rate above — no "current PIN" is
// asked for, because being logged into this dashboard already grants
// full control over the business (same precedent as
// updatePasswordAction in app/actions/profile.ts, which doesn't ask
// for the old password either).
export async function setMoneyPinAction(input: { pin: string; confirmPin: string }): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  if (input.pin !== input.confirmPin) return { success: false, error: "PINs don't match." };

  return setMoneyPin(businessId, input.pin.trim());
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
  if (error) return dbErrorResult(error, "updateBusinessHoursAction", "Could not save your hours.");

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/ai-employee");
  return { success: true };
}

export interface UpdateAiEmployeeResult extends ActionResult {
  generatedInstructions?: string;
}

export async function updateAiEmployeeAction(input: {
  personality: Personality;
  responsibilities: AiResponsibilities;
  voiceId: VoiceId;
  orderingRules: string;
  escalationRules: string;
  customVoice?: { providerVoiceRef: string; providerVoiceName: string } | null;
}): Promise<UpdateAiEmployeeResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const admin = createAdminClient();

  // Regenerated on every save (not just once at onboarding) so the
  // read-only "AI briefing" shown on the AI Employee page never drifts
  // out of sync with whatever was just changed here — see
  // generateInstructions.ts and ai-employee-client.tsx.
  const [businessRes, hoursRes, menuCountRes] = await Promise.all([
    admin.from("businesses").select("name, description").eq("id", businessId).single(),
    admin.from("business_hours").select("weekday, is_open, open_time, close_time").eq("business_id", businessId),
    admin.from("menu_items").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("is_active", true),
  ]);

  const generatedInstructions = generateInstructions({
    business: { name: businessRes.data?.name || "your restaurant", description: businessRes.data?.description || "" },
    personality: input.personality,
    responsibilities: input.responsibilities,
    menuItemCount: menuCountRes.count || 0,
    hours: hoursRes.data || [],
  });

  const { error: aiError } = await admin
    .from("ai_receptionists")
    .update({
      personality: input.personality,
      responsibilities: input.responsibilities,
      ordering_rules: input.orderingRules || null,
      escalation_rules: input.escalationRules || null,
      generated_instructions: generatedInstructions,
    })
    .eq("business_id", businessId);
  if (aiError) return dbErrorResult(aiError, "updateAiEmployeeAction:ai", "Could not save your AI employee's settings.");

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
  if (voiceError) return dbErrorResult(voiceError, "updateAiEmployeeAction:voice", "Could not save the selected voice.");

  revalidatePath("/dashboard/ai-employee");
  return { success: true, generatedInstructions };
}

export async function toggleAiStatusAction(online: boolean): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  if (online) {
    const suspendedError = await requireNotSuspended(businessId);
    if (suspendedError) return { success: false, error: suspendedError };

    const subscriptionError = await requireOperationalSubscription(businessId);
    if (subscriptionError) return { success: false, error: subscriptionError };

    const paymentsError = await requirePaymentsReadyIfTakingOrders(businessId);
    if (paymentsError) return { success: false, error: paymentsError };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("ai_receptionists").update({ status: online ? "online" : "offline" }).eq("business_id", businessId);
  if (error) return dbErrorResult(error, "toggleAiStatusAction", "Could not update your AI's status.");

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

  const suspendedError = await requireNotSuspended(businessId);
  if (suspendedError) return { success: false, error: suspendedError };

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

  const suspendedError = await requireNotSuspended(businessId);
  if (suspendedError) return { success: false, error: suspendedError };

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
 * Real, persisted notification preferences. Previously these toggles
 * were only ever held in component state — they looked interactive
 * but nothing was ever saved, so they silently reset on every reload.
 */
export async function updateNotificationPreferencesAction(prefs: NotificationPreferences): Promise<{ success: boolean; error?: string }> {
  const businessId = await getCurrentBusinessId();
  if (!businessId) return { success: false, error: "Not authenticated." };

  // Written with the server's own client: signed-in users can no longer
  // write to the businesses table directly (migration 032).
  const admin = createAdminClient();
  const { error } = await admin.from("businesses").update({ notification_preferences: prefs }).eq("id", businessId);
  if (error) return dbErrorResult(error, "updateNotificationPreferencesAction", "Could not save your notification preferences.");

  revalidatePath("/dashboard/settings");
  return { success: true };
}