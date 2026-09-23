import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeSpotOnCode } from "@/lib/integrations/spoton";

/**
 * GET /api/auth/spoton/callback
 *
 * SpotOn redirects here after the owner authorizes the connection in
 * the onboarding/integrations flow. `state` carries the business_id
 * through the round-trip (set in buildSpotOnAuthorizeUrl).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const businessId = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;

  if (error) {
    return NextResponse.redirect(`${appUrl}/dashboard/integrations?spoton_error=${encodeURIComponent(error)}`);
  }
  if (!code || !businessId) {
    return NextResponse.redirect(`${appUrl}/dashboard/integrations?spoton_error=missing_code`);
  }

  try {
    const redirectUri = `${appUrl}/api/auth/spoton/callback`;
    const tokens = await exchangeSpotOnCode(code, redirectUri);

    const admin = createAdminClient();
    await admin
      .from("businesses")
      .update({
        spoton_location_id: tokens.location_id || null,
        spoton_access_token: tokens.access_token,
        spoton_refresh_token: tokens.refresh_token,
        spoton_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        spoton_connected_at: new Date().toISOString(),
      })
      .eq("id", businessId);

    await admin
      .from("integrations")
      .upsert(
        { business_id: businessId, provider: "spoton", status: "connected", external_account_id: tokens.location_id || null, connected_at: new Date().toISOString() },
        { onConflict: "business_id,provider" }
      );

    return NextResponse.redirect(`${appUrl}/dashboard/integrations?spoton_connected=1`);
  } catch (err) {
    console.error("SpotOn OAuth callback failed:", err);
    return NextResponse.redirect(`${appUrl}/dashboard/integrations?spoton_error=connection_failed`);
  }
}
