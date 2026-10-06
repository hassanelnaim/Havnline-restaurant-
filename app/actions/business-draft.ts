"use server";

import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { isValidTimezone } from "@/lib/business/timezone";
import { DEFAULT_PLATFORM_FEE_BPS } from "@/lib/billing/constants";
import { dbErrorResult } from "@/lib/errors";

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
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
  phone: string;
  description: string;
  timezone: string;
  legalBusinessName?: string;
  ein?: string;
}): Promise<CreateBusinessDraftResult> {
  if (!isSupabaseConfigured()) return { success: true, demoMode: true };

  const supabase = createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) return { success: false, error: "You need to be logged in." };
  if (!input.businessName.trim()) return { success: false, error: "Business name is required." };
  // The onboarding UI only ever offers a fixed <select> of real IANA
  // zones, but this is a server action — reachable directly with any
  // string — and an invalid one stored here would crash this
  // business's phone line the moment a call comes in (see
  // lib/business/timezone.ts).
  if (input.timezone && !isValidTimezone(input.timezone)) {
    return { success: false, error: "That timezone isn't recognized — please pick one from the list." };
  }

  // Optional. Stored as nine digits only; anything else is rejected here
  // rather than saved and later bounced by the carrier registration.
  const einDigits = (input.ein || "").replace(/\D/g, "");
  if (input.ein?.trim() && einDigits.length !== 9) {
    return { success: false, error: "An EIN has 9 digits (for example 12-3456789). Leave it blank if you don't have one yet." };
  }

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
    address_city: input.addressCity?.trim() || null,
    address_state: input.addressState?.trim().toUpperCase() || null,
    address_zip: input.addressZip?.trim() || null,
    phone: input.phone || null,
    description: input.description || null,
    timezone: input.timezone || "America/New_York",
    // Only written when filled in: the onboarding form can be revisited
    // with an empty draft, and that must not erase an EIN already saved.
    ...(input.legalBusinessName?.trim() ? { legal_business_name: input.legalBusinessName.trim() } : {}),
    ...(einDigits ? { ein: einDigits } : {}),
  };

  if (existingBusinessId) {
    const { data: business, error: businessError } = await admin
      .from("businesses")
      .update(businessFields)
      .eq("id", existingBusinessId)
      .select()
      .single();
    if (businessError || !business) return dbErrorResult(businessError, "createBusinessDraftAction:update", "Could not update business.");
    return { success: true, businessId: business.id };
  }

  // platform_fee_bps only gets a default here, on first insert — it's
  // intentionally left out of businessFields above so re-saving the
  // draft (an update) never overwrites a fee a platform admin already
  // customized for this business.
  const { data: business, error: businessError } = await admin
    .from("businesses")
    .insert({ ...businessFields, onboarding_step: "hours", platform_fee_bps: DEFAULT_PLATFORM_FEE_BPS })
    .select()
    .single();

  if (businessError || !business) return dbErrorResult(businessError, "createBusinessDraftAction:insert", "Could not create business.");

  const { error: memberError } = await admin.from("business_members").insert({ business_id: business.id, user_id: user.id, role: "owner" });
  if (memberError) return dbErrorResult(memberError, "createBusinessDraftAction:member", "Could not finish setting up your account.");

  return { success: true, businessId: business.id };
}