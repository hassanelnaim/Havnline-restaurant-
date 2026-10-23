import { guardRoute } from "@/lib/api/routeGuard";
import { NextRequest, NextResponse } from "next/server";
import { claimPairingCode } from "@/lib/integrations/printer-app";
import { checkRateLimit, getClientIp } from "@/lib/security/rateLimit";

export const dynamic = "force-dynamic";

/**
 * POST /api/printer-app/pair
 *
 * Called once by the tablet app, right after the owner types in the
 * pairing code shown on their Integrations dashboard. Exchanges that
 * short-lived code for a permanent device_token, which the app then
 * stores and sends as a Bearer token on every other request below.
 *
 * The code is 8 digits (100,000,000 combinations) and, unrated, could
 * still be brute-forced within its 15-minute lifetime by a script
 * hitting this endpoint — a successful guess would hand a stranger a
 * permanent token that can read that business's pending orders. This
 * rate limit doesn't need to be generous: a real owner enters their
 * own code once, by hand. The limit is per network (see below).
 */
async function handlePOST(request: NextRequest) {
  // Per network only. A platform-wide cap used to sit here too, which let
  // anyone lock EVERY restaurant out of pairing a tablet by sending junk
  // codes. It isn't needed: a code is 8 digits (100,000,000 possibilities)
  // and lives 15 minutes, so even thousands of networks guessing at this
  // rate would expect to need years.
  const ip = getClientIp();
  const ipOk = await checkRateLimit(`printer_pair_ip:${ip}`, 10, 15);
  if (!ipOk) {
    return NextResponse.json({ success: false, error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code : "";
  if (!code.trim()) return NextResponse.json({ success: false, error: "Enter the pairing code first." }, { status: 400 });

  const result = await claimPairingCode(code);
  if (!result.success) return NextResponse.json(result, { status: 400 });

  return NextResponse.json(result);
}

export const POST = guardRoute("printer-app/pair POST", handlePOST);
