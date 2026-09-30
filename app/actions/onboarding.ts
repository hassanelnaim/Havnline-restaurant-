"use server";

import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { generateInstructions } from "@/lib/ai/generateInstructions";
import type { OnboardingDraft } from "@/lib/onboarding/context";
import { dbErrorResult } from "@/lib/errors";

export interface CompleteOnboardingResult {
  success: boolean;
  error?: string;
  demoMode?: boolean;
}

export async function completeOnboardingAction(draft: OnboardingDraft): Promise<CompleteOnboardingResult> {
  if (!isSupabaseConfigured()) return { success: true, demoMode: true };

  const authClient = createClient();
  const { data: { user }, error: userError } = await authClient.auth.getUser();

  if (userError || !user) return { success: false, error: "You need to be logged in to finish setup." };
  if (!draft.businessName.trim()) return { success: false, error: "Business name is required." };

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { success: false, error: "Server isn't fully configured yet (missing SUPABASE_SERVICE_ROLE_KEY)." };
  }

  // Deliberately NOT trusting draft.businessId, even though the client
  // sends one — every other write path in this app derives the
  // business id server-side from the session (business_members), and
  // this was the one exception: it took the client's id as-is with no
  // ownership check, so any signed-in user could pass another
  // business's id here and overwrite its menu, hours, and live AI
  // config. Deriving it the same way as everywhere else closes that.
  let businessId = await getCurrentBusinessId();

  if (businessId) {
    const { error: updateError } = await admin
      .from("businesses")
      .update({
        name: draft.businessName,
        business_type: draft.businessType || null,
        address: draft.address || null,
        phone: draft.phone || null,
        website: draft.website || null,
        description: draft.description || null,
        onboarding_step: "complete",
        onboarding_completed_at: new Date().toISOString(),
      })
      .eq("id", businessId);

    if (updateError) return dbErrorResult(updateError, "completeOnboardingAction:update", "Could not save your business.");
  } else {
    const { data: business, error: businessError } = await admin
      .from("businesses")
      .insert({
        name: draft.businessName,
        business_type: draft.businessType || null,
        address: draft.address || null,
        phone: draft.phone || null,
        website: draft.website || null,
        description: draft.description || null,
        onboarding_step: "complete",
        onboarding_completed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (businessError || !business) return dbErrorResult(businessError, "completeOnboardingAction:insert", "Could not create business.");
    businessId = business.id as string;

    await admin.from("users").upsert({ id: user.id, email: user.email || "" }, { onConflict: "id" });

    const { error: memberError } = await admin.from("business_members").insert({ business_id: businessId, user_id: user.id, role: "owner" });
    if (memberError) return dbErrorResult(memberError, "completeOnboardingAction:member", "Could not finish setting up your account.");
  }

  const hoursRows = draft.hours.map((h) => ({
    business_id: businessId,
    weekday: h.weekday,
    is_open: h.isOpen,
    open_time: h.isOpen ? h.openTime : null,
    close_time: h.isOpen ? h.closeTime : null,
  }));
  const { error: hoursError } = await admin.from("business_hours").upsert(hoursRows, { onConflict: "business_id,weekday" });
  if (hoursError) return dbErrorResult(hoursError, "completeOnboardingAction:hours", "Could not save your hours.");

  const categoryIdByName = new Map<string, string>();

  for (const item of draft.menuItems) {
    if (!item.name.trim()) continue;

    let categoryId: string | null = null;
    const categoryName = item.category.trim();
    if (categoryName) {
      if (categoryIdByName.has(categoryName)) {
        categoryId = categoryIdByName.get(categoryName)!;
      } else {
        const { data: category, error: categoryError } = await admin
          .from("menu_categories")
          .insert({ business_id: businessId, name: categoryName })
          .select("id")
          .single();
        if (categoryError) return dbErrorResult(categoryError, "completeOnboardingAction:category", "Could not save your menu.");
        categoryId = category.id;
        categoryIdByName.set(categoryName, categoryId!);
      }
    }

    const { data: menuItem, error: itemError } = await admin
      .from("menu_items")
      .insert({
        business_id: businessId,
        category_id: categoryId,
        name: item.name,
        description: item.description || null,
        price_cents: Math.round((parseFloat(item.price) || 0) * 100),
        source: "manual",
      })
      .select("id")
      .single();
    if (itemError) return dbErrorResult(itemError, "completeOnboardingAction:item", "Could not save your menu.");

    for (const group of item.modifierGroups) {
      if (!group.name.trim()) continue;
      const { data: modifierGroup, error: groupError } = await admin
        .from("modifier_groups")
        .insert({
          business_id: businessId,
          menu_item_id: menuItem.id,
          name: group.name,
          is_required: group.required,
          min_select: group.required ? 1 : 0,
          max_select: 1,
        })
        .select("id")
        .single();
      if (groupError) return dbErrorResult(groupError, "completeOnboardingAction:group", "Could not save your menu.");

      const optionRows = group.options
        .filter((o) => o.name.trim())
        .map((o) => ({
          business_id: businessId,
          modifier_group_id: modifierGroup.id,
          name: o.name,
          price_delta_cents: Math.round((parseFloat(o.priceDelta) || 0) * 100),
        }));
      if (optionRows.length > 0) {
        const { error: optionsError } = await admin.from("modifiers").insert(optionRows);
        if (optionsError) return dbErrorResult(optionsError, "completeOnboardingAction:options", "Could not save your menu.");
      }
    }
  }

  const receptionistName = draft.receptionistName || "Alex";
  const personality = draft.personality || "professional";

  const generatedInstructions = generateInstructions({
    business: { name: draft.businessName, description: draft.description },
    personality,
    responsibilities: draft.responsibilities,
    menuItemCount: draft.menuItems.filter((m) => m.name.trim()).length,
    hours: draft.hours.map((h) => ({ weekday: h.weekday, is_open: h.isOpen, open_time: h.isOpen ? h.openTime : null, close_time: h.isOpen ? h.closeTime : null })),
  });

  const { error: aiError } = await admin.from("ai_receptionists").upsert(
    { business_id: businessId, name: receptionistName, personality, responsibilities: draft.responsibilities, status: "offline", generated_instructions: generatedInstructions },
    { onConflict: "business_id" }
  );
  if (aiError) return dbErrorResult(aiError, "completeOnboardingAction:ai", "Could not set up your AI receptionist.");

  const { error: voiceError } = await admin.from("ai_voice_configs").upsert(
    draft.customVoiceRef
      ? { business_id: businessId, voice_id: "custom", provider: "elevenlabs", provider_voice_ref: draft.customVoiceRef, provider_voice_name: draft.customVoiceName }
      : { business_id: businessId, voice_id: draft.voiceId },
    { onConflict: "business_id" }
  );
  if (voiceError) return dbErrorResult(voiceError, "completeOnboardingAction:voice", "Could not save the selected voice.");

  return { success: true };
}

export async function goToDashboardAction() {
  redirect("/dashboard");
}
