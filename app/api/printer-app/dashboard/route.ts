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

// Today and yesterday — the two days the Dashboard tab always shows as
// their own sections. Anything further back goes through
// /api/printer-app/day-summary instead (the tablet's calendar picker),
// rather than this route growing a long scrollable list of days.
const DASHBOARD_DAYS = 2;

/**
 * GET /api/printer-app/dashboard
 *
 * The tablet's money dashboard tab: today's and yesterday's sales,
 * same underlying sales math as the website's End of Day report
 * (buildDailySummary — an order only counts once it's actually paid,
 * or never needed payment up front) but bucketed from ONE query rather
 * than calling that report's per-day logic twice, since this only
 * needs the totals already sitting on each order row
 * (subtotal/tax/total/refunded), never the individual line items an
 * End of Day drill-down would.
 *
 * refundedCents is bucketed by the ORDER's created_at date, not by
 * when the refund itself happened — a refund issued today on an order
 * placed yesterday shows up under yesterday. Simpler than tracking a
 * separate refund timestamp per day, and refunds issued well after the
 * original order are rare enough on a same-day kitchen tablet that
 * this is a reasonable trade, not a silent inaccuracy worth hiding.
 */
export async function GET(request: NextRequest) {
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });

  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("timezone").eq("id", device.businessId).single();
  const timezone = safeTimezone(business?.timezone);

  const todayKey = localDateKey(new Date().toISOString(), timezone);
  // Most-recent-first: today, yesterday, ... DASHBOARD_DAYS-1 days ago.
  const dateKeys = Array.from({ length: DASHBOARD_DAYS }, (_, i) => localDateKey(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(), timezone));
  const earliestKey = dateKeys[dateKeys.length - 1];

  const { startIso } = localDayBoundsUtc(earliestKey, timezone);
  const { endIso } = localDayBoundsUtc(todayKey, timezone);

  const { data: orders, error } = await admin
    .from("orders")
    .select("status, payment_status, subtotal_cents, tax_cents, total_cents, amount_refunded_cents, created_at")
    .eq("business_id", device.businessId)
    .neq("status", "building") // still in progress on a live call, not a real order yet
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  if (error) return NextResponse.json(dbErrorResult(error, "printer-app/dashboard GET", "Could not load the dashboard."), { status: 500 });

  const byDate = new Map<string, typeof orders>();
  for (const order of orders || []) {
    const key = localDateKey(order.created_at, timezone);
    const bucket = byDate.get(key);
    if (bucket) bucket.push(order);
    else byDate.set(key, [order]);
  }

  const days = dateKeys.map((dateKey) => buildDailySummary(dateKey, byDate.get(dateKey) || []));

  return NextResponse.json({ success: true, days });
}
