"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildSpotOnAuthorizeUrl, syncSpotOnMenu } from "@/lib/integrations/spoton";

function callbackRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base}/api/auth/spoton/callback`;
}

export async function connectSpotOnAction(): Promise<void> {
  const businessId = await getCurrentBusinessId();
  if (!businessId) redirect("/login");

  // buildSpotOnAuthorizeUrl throws if SPOTON_CLIENT_ID isn't set yet (no
  // SpotOn developer credentials configured in Vercel). Previously that
  // unhandled throw crashed the whole request with Next's generic
  // "Application error" page. Redirecting back with a query param instead
  // lets the integrations page show the owner a real explanation.
  let url: string;
  try {
    url = buildSpotOnAuthorizeUrl(businessId, callbackRedirectUri());
  } catch (err) {
    console.error("SpotOn connect failed:", err);
    redirect("/dashboard/integrations?spoton_error=not_configured");
  }
  redirect(url);
}

export async function disconnectSpotOnAction(): Promise<{ success: boolean; error?: string }> {
  const businessId = await getCurrentBusinessId();
  if (!businessId) return { success: false, error: "Not signed in." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("businesses")
    .update({
      spoton_location_id: null,
      spoton_access_token: null,
      spoton_refresh_token: null,
      spoton_token_expires_at: null,
      spoton_connected_at: null,
      spoton_menu_synced_at: null,
    })
    .eq("id", businessId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/integrations");
  return { success: true };
}

export async function syncSpotOnMenuAction(): Promise<{ success: boolean; itemCount?: number; error?: string }> {
  const businessId = await getCurrentBusinessId();
  if (!businessId) return { success: false, error: "Not signed in." };

  try {
    const result = await syncSpotOnMenu(businessId);
    revalidatePath("/dashboard/menu");
    return { success: true, itemCount: result.itemCount };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Sync failed." };
  }
}