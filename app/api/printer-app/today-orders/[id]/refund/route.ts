import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateDevice } from "@/lib/integrations/printer-app";
import { verifyMoneyActionToken } from "@/lib/security/moneyActionToken";
import { processOrderRefund } from "@/lib/billing/orderRefund";

export const dynamic = "force-dynamic";

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/**
 * POST /api/printer-app/today-orders/[id]/refund
 *
 * The tablet's PIN-gated money action (Phase 3 of the tablet
 * redesign) — a "discount" and a "refund" are the same thing
 * underneath, a real Stripe refund via processOrderRefund
 * (lib/billing/orderRefund.ts), just labeled differently for the
 * audit trail below. amountCents omitted = full refund; required for
 * a discount (there's no such thing as an un-amounted discount).
 *
 * Lives under today-orders/[id], NOT orders/[id] — orders/[id] is
 * already taken by the print-job-ack route, where [id] means a
 * printer_print_jobs id, not an orders id. Nesting this here instead
 * keeps [id] meaning exactly one thing (a real order id) under this
 * whole path, matching GET /api/printer-app/today-orders above it.
 *
 * Requires BOTH a valid device_token (this tablet is paired to this
 * business — every printer-app route needs this) AND a valid,
 * unexpired money-action token proving the PIN was just verified
 * (app/api/printer-app/verify-pin/route.ts) — unlike every read-only
 * printer-app route, device auth alone is not enough here.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });

  const moneyActionToken = request.headers.get("x-money-action-token");
  if (!verifyMoneyActionToken(moneyActionToken, { businessId: device.businessId, deviceId: device.deviceId })) {
    return NextResponse.json({ success: false, error: "PIN verification required or expired — enter the PIN again.", needsPin: true }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const actionType: "refund" | "discount" = body?.actionType === "discount" ? "discount" : "refund";
  const reasonInput = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const amountCents =
    typeof body?.amountCents === "number" && Number.isFinite(body.amountCents) && body.amountCents > 0 ? Math.round(body.amountCents) : undefined;

  if (actionType === "discount" && amountCents === undefined) {
    return NextResponse.json({ success: false, error: "Enter a discount amount." }, { status: 400 });
  }

  const reason = reasonInput || (actionType === "discount" ? "Discount applied from tablet" : "Refund issued from tablet");

  const result = await processOrderRefund(device.businessId, params.id, amountCents, reason, { refundedByUserId: null });
  if (!result.success) return NextResponse.json(result, { status: 400 });

  // Audit trail (migration 021) — best-effort. The refund itself
  // already succeeded and is recorded on the order row; failing to
  // write this extra log entry shouldn't fail the whole request.
  const admin = createAdminClient();
  await admin.from("tablet_money_actions").insert({
    business_id: device.businessId,
    device_id: device.deviceId,
    order_id: params.id,
    action: actionType,
    amount_cents: result.refundedCents || 0,
    reason,
  });

  return NextResponse.json(result);
}
