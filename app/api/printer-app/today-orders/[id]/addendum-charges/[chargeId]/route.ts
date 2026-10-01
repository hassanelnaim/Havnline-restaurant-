import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateDevice } from "@/lib/integrations/printer-app";

export const dynamic = "force-dynamic";

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/**
 * GET /api/printer-app/today-orders/[id]/addendum-charges/[chargeId]
 *
 * Short-interval poll target (Phase 4 of the tablet redesign) for the
 * tablet to find out when a customer has actually scanned and paid a
 * QR charge — the background 15s Today's Orders refresh
 * (ORDERS_REFRESH_INTERVAL_MS) isn't fast enough for a customer
 * standing right there watching a QR code. Deliberately its own tiny
 * endpoint rather than folded into GET /api/printer-app/today-orders,
 * so the tablet can poll just this one charge every ~3s without
 * re-fetching the whole day's orders that often.
 *
 * Trimmed response on purpose, matching GET today-orders — no Stripe
 * session/payment-intent ids reach the device.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string; chargeId: string } }) {
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });

  const admin = createAdminClient();
  const { data: charge } = await admin
    .from("order_addendum_charges")
    .select("id, order_id, status, amount_cents")
    .eq("id", params.chargeId)
    .eq("business_id", device.businessId)
    .maybeSingle();

  if (!charge || charge.order_id !== params.id) {
    return NextResponse.json({ success: false, error: "Charge not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, status: charge.status, amountCents: charge.amount_cents });
}
