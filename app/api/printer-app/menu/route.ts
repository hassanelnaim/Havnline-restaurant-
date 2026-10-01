import { NextRequest, NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/integrations/printer-app";
import { loadPricedMenu } from "@/lib/menu/pricedMenu";

export const dynamic = "force-dynamic";

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/**
 * GET /api/printer-app/menu
 *
 * Read-only menu + modifier data for the tablet's item-picker UI
 * (Phase 4 of the tablet redesign — adding items to an in-progress
 * order, comped or charged via QR; see
 * POST /api/printer-app/today-orders/[id]/items). Device-token only,
 * no PIN: this is menu data, not money movement, and every other read
 * endpoint here (GET /api/printer-app/orders) already trusts the
 * device token alone.
 *
 * loadPricedMenu (lib/menu/pricedMenu.ts) is the same query this route
 * always ran, pulled out once Phase 4's item-add route needed the
 * identical "live menu, current effective prices" data to validate and
 * price a request server-side rather than trusting whatever price the
 * tablet last synced.
 */
export async function GET(request: NextRequest) {
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });

  const { menu } = await loadPricedMenu(device.businessId);
  return NextResponse.json({ success: true, menu });
}
