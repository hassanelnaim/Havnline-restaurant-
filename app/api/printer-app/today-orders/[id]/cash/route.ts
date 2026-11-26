import { guardRoute } from "@/lib/api/routeGuard";
import { NextRequest, NextResponse } from "next/server";
import { authenticateDevice } from "@/lib/integrations/printer-app";
import { closeCashOrder } from "@/lib/orders/cashOrders";

export const dynamic = "force-dynamic";

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/printer-app/today-orders/[id]/cash  { action: "paid" | "no_show" }
 *
 * The tablet's "Paid in cash" and "No-show" buttons on a cash-at-pickup
 * order. Device auth only, no PIN: taking the customer's cash is the
 * everyday end of a cash order, and a no-show moves no money.
 */
async function handlePOST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });
  if (!UUID.test(id)) return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
  const body = await request.json().catch(() => null);
  const action = body?.action === "paid" || body?.action === "no_show" ? body.action : null;
  if (!action) return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
  const result = await closeCashOrder(device.businessId, id, action);
  return NextResponse.json(result, { status: result.success ? 200 : 409 });
}

export const POST = guardRoute("printer-app/today-orders cash POST", handlePOST);
