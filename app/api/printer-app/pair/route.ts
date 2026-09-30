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
 * own code once, by hand. Both an IP-scoped and a global cap apply —
 * the IP one stops any single source from grinding through guesses,
 * the global one bounds a distributed attempt spread across many IPs.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp();
  const [ipOk, globalOk] = await Promise.all([
    checkRateLimit(`printer_pair_ip:${ip}`, 10, 15),
    checkRateLimit("printer_pair_global", 50, 15),
  ]);
  if (!ipOk || !globalOk) {
    return NextResponse.json({ success: false, error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code : "";
  if (!code.trim()) return NextResponse.json({ success: false, error: "Enter the pairing code first." }, { status: 400 });

  const result = await claimPairingCode(code);
  if (!result.success) return NextResponse.json(result, { status: 400 });

  return NextResponse.json(result);
}
