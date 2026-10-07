import { guardRoute } from "@/lib/api/routeGuard";
import { NextRequest, NextResponse } from "next/server";
import { authenticateDevice, setPrinterIp } from "@/lib/integrations/printer-app";

export const dynamic = "force-dynamic";

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/**
 * POST /api/printer-app/printer-ip
 *
 * The app reports the kitchen printer's local IP once, during setup
 * (manual entry — no network auto-discovery in this version). Stored
 * so print jobs stay fully server-formatted; the app only needs to
 * know where to send bytes on its own network, not menu or ticket
 * logic.
 */
async function handlePOST(request: NextRequest) {
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const printerIp = typeof body?.printerIp === "string" ? body.printerIp : "";
  if (!printerIp.trim()) return NextResponse.json({ success: false, error: "Enter the printer's IP address." }, { status: 400 });

  await setPrinterIp(device.businessId, printerIp);
  return NextResponse.json({ success: true });
}

export const POST = guardRoute("printer-app/printer-ip POST", handlePOST);
