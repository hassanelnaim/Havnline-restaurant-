"use server";

import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateInstructions } from "@/lib/ai/generateInstructions";
import type { OnboardingDraft } from "@/lib/onboarding/context";

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

  let businessId = draft.businessId;

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

    if (updateError) return { success: false, error: updateError.message };
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

    if (businessError || !business) return { success: false, error: businessError?.message || "Could not create business." };
    businessId = business.id as string;

    await admin.from("users").upsert({ id: user.id, email: user.email || "" }, { onConflict: "id" });

    const { error: memberError } = await admin.from("business_members").insert({ business_id: businessId, user_id: user.id, role: "owner" });
    if (memberError) return { success: false, error: memberError.message };
  }

  const hoursRows = draft.hours.map((h) => ({
    business_id: businessId,
    weekday: h.weekday,
    is_open: h.isOpen,
    open_time: h.isOpen ? h.openTime : null,
    close_time: h.isOpen ? h.closeTime : null,
  }));
  const { error: hoursError } = await admin.from("business_hours").upsert(hoursRows, { onConflict: "business_id,weekday" });
  if (hoursError) return { success: false, error: hoursError.message };

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
        if (categoryError) return { success: false, error: categoryError.message };
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
    if (itemError) return { success: false, error: itemError.message };

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
      if (groupError) return { success: false, error: groupError.message };

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
        if (optionsError) return { success: false, error: optionsError.message };
      }
    }
  }

  const receptionistName = draft.receptionistName || "Alex";
  const personality = draft.personality || "professional";

  const generatedInstructions = generateInstructions({
    business: { name: draft.businessName, description: draft.description },
    receptionistName,
    personality,
    responsibilities: draft.responsibilities,
    menuItemCount: draft.menuItems.filter((m) => m.name.trim()).length,
    hours: draft.hours.map((h) => ({ weekday: h.weekday, is_open: h.isOpen, open_time: h.isOpen ? h.openTime : null, close_time: h.isOpen ? h.closeTime : null })),
  });

  const { error: aiError } = await admin.from("ai_receptionists").upsert(
    { business_id: businessId, name: receptionistName, personality, responsibilities: draft.responsibilities, status: "offline", generated_instructions: generatedInstructions },
    { onConflict: "business_id" }
  );
  if (aiError) return { success: false, error: aiError.message };

  const { error: voiceError } = await admin.from("ai_voice_configs").upsert(
    draft.customVoiceRef
      ? { business_id: businessId, voice_id: "custom", provider: "elevenlabs", provider_voice_ref: draft.customVoiceRef, provider_voice_name: draft.customVoiceName }
      : { business_id: businessId, voice_id: draft.voiceId },
    { onConflict: "business_id" }
  );
  if (voiceError) return { success: false, error: voiceError.message };

  return { success: true };
}

export async function goToDashboardAction() {
  redirect("/dashboard");
}
