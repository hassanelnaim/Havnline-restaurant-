import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateDevice } from "@/lib/integrations/printer-app";
import { dbErrorResult } from "@/lib/errors";
import { localDateKey, localDayBoundsUtc } from "@/lib/format";
import { safeTimezone } from "@/lib/business/timezone";
import { buildDailySummary } from "@/lib/orders/dailySummary";

export const dynamic = "force-dynamic";

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/**
 * GET /api/printer-app/today-orders
 *
 * Phase 2 of the tablet redesign: a read-only "Today's Orders" list +
 * detail view on the tablet itself, not just the dashboard. Returns
 * every one of today's REAL orders (never "building" — that's still
 * in progress mid-call) for the paired business, full items and
 * modifiers included, so the tablet can render both the list and the
 * detail screen from one response without a second round-trip.
 *
 * "Today" is the business's own calendar day (localDayBoundsUtc —
 * same logic the dashboard's End of Day report uses), not the
 * tablet's or server's day, so a business near a timezone boundary
 * sees the same "today" here as it does on the dashboard.
 *
 * Deliberately returns a trimmed set of order columns, not select("*")
 * — this is a response that leaves the server and goes straight to a
 * device, so internal fields like stripe_checkout_session_id,
 * stripe_payment_intent_id, and refunded_by/voided_by (admin user
 * ids) are left out as having no reason to ever reach the tablet.
 *
 * See ./[id]/refund/route.ts for the PIN-gated refund/discount action
 * on one of these orders (Phase 3).
 */
export async function GET(request: NextRequest) {
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });

  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("timezone").eq("id", device.businessId).single();
  const timezone = safeTimezone(business?.timezone);

  const todayKey = localDateKey(new Date().toISOString(), timezone);
  const { startIso, endIso } = localDayBoundsUtc(todayKey, timezone);

  const { data: orders, error } = await admin
    .from("orders")
    .select("id, status, payment_status, customer_name, phone, subtotal_cents, tax_cents, total_cents, amount_refunded_cents, special_instructions, submit_error, created_at")
    .eq("business_id", device.businessId)
    .neq("status", "building") // still in progress on a live call, not a real order yet
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: false }); // newest first — kitchen staff care about what just came in

  if (error) return NextResponse.json(dbErrorResult(error, "printer-app/today-orders GET", "Could not fetch today's orders."), { status: 500 });
  if (!orders || orders.length === 0) return NextResponse.json({ success: true, orders: [], summary: buildDailySummary(todayKey, []) });

  const orderIds = orders.map((o) => o.id);
  const { data: items } = await admin
    .from("order_items")
    .select("id, order_id, item_name, unit_price_cents, quantity, notes")
    .in("order_id", orderIds);

  const itemIds = (items || []).map((i) => i.id);
  const { data: modifiers } = itemIds.length
    ? await admin.from("order_item_modifiers").select("order_item_id, modifier_name, price_delta_cents").in("order_item_id", itemIds)
    : { data: [] as { order_item_id: string; modifier_name: string; price_delta_cents: number }[] };

  const result = orders.map((order) => ({
    ...order,
    items: (items || [])
      .filter((i) => i.order_id === order.id)
      .map((i) => ({
        id: i.id,
        item_name: i.item_name,
        unit_price_cents: i.unit_price_cents,
        quantity: i.quantity,
        notes: i.notes,
        modifiers: (modifiers || []).filter((m) => m.order_item_id === i.id).map((m) => ({ modifier_name: m.modifier_name, price_delta_cents: m.price_delta_cents })),
      })),
  }));

  return NextResponse.json({ success: true, orders: result, summary: buildDailySummary(todayKey, orders) });
}
