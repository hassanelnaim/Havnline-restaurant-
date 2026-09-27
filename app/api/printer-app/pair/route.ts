import { NextRequest, NextResponse } from "next/server";
import { claimPairingCode } from "@/lib/integrations/printer-app";

export const dynamic = "force-dynamic";

/**
 * POST /api/printer-app/pair
 *
 * Called once by the tablet app, right after the owner types in the
 * pairing code shown on their Integrations dashboard. Exchanges that
 * short-lived code for a permanent device_token, which the app then
 * stores and sends as a Bearer token on every other request below.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code : "";
  if (!code.trim()) return NextResponse.json({ success: false, error: "Enter the pairing code first." }, { status: 400 });

  const result = await claimPairingCode(code);
  if (!result.success) return NextResponse.json(result, { status: 400 });

  return NextResponse.json(result);
}
