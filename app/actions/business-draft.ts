"use server";

import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBusinessId } from "@/lib/supabase/business";

export interface CreateBusinessDraftResult {
  success: boolean;
  businessId?: string;
  error?: string;
  demoMode?: boolean;
}

export async function createBusinessDraftAction(input: {
  businessName: string;
  businessType: string;
  address: string;
  phone: string;
  description: string;
  timezone: string;
}): Promise<CreateBusinessDraftResult> {
  if (!isSupabaseConfigured()) return { success: true, demoMode: true };

  const supabase = createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) return { success: false, error: "You need to be logged in." };
  if (!input.businessName.trim()) return { success: false, error: "Business name is required." };

  const admin = createAdminClient();

  await admin.from("users").upsert({ id: user.id, email: user.email || "" }, { onConflict: "id" });

  // This step can legitimately be reached more than once for the same
  // user — a refresh, a re-opened tab, or coming back later to finish
  // setup all land here again, and the client-side draft state (see
  // lib/onboarding/context) doesn't reliably remember a businessId
  // across those. Without this check, every visit silently created a
  // brand new `businesses` row + business_members row, leaving the
  // account split across duplicate, half-configured businesses (this
  // is exactly how one customer ended up with a paid subscription and
  // phone number on one business record and their finished onboarding
  // — hours, voice config, receptionist — stranded on another).
  // Reuse the existing business (update in place) instead of creating
  // a second one whenever this user already has one.
  const existingBusinessId = await getCurrentBusinessId();

  const businessFields = {
    name: input.businessName,
    business_type: input.businessType || null,
    address: input.address || null,
    phone: input.phone || null,
    description: input.description || null,
    timezone: input.timezone || "America/New_York",
  };

  if (existingBusinessId) {
    const { data: business, error: businessError } = await admin
      .from("businesses")
      .update(businessFields)
      .eq("id", existingBusinessId)
      .select()
      .single();
    if (businessError || !business) return { success: false, error: businessError?.message || "Could not update business." };
    return { success: true, businessId: business.id };
  }

  const { data: business, error: businessError } = await admin
    .from("businesses")
    .insert({ ...businessFields, onboarding_step: "hours" })
    .select()
    .single();

  if (businessError || !business) return { success: false, error: businessError?.message || "Could not create business." };

  const { error: memberError } = await admin.from("business_members").insert({ business_id: business.id, user_id: user.id, role: "owner" });
  if (memberError) return { success: false, error: memberError.message };

  return { success: true, businessId: business.id };
}