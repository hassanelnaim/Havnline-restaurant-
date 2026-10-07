import { guardRoute } from "@/lib/api/routeGuard";
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
 * GET /api/printer-app/day-summary?date=YYYY-MM-DD
 *
 * The tablet Dashboard tab's calendar picker — one arbitrary day's
 * numbers, fetched on demand instead of padding out
 * /api/printer-app/dashboard into a long scrollable history. Same
 * sales math (buildDailySummary) as that route and the website's End
 * of Day report.
 */
async function handleGET(request: NextRequest) {
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });

  const dateParam = request.nextUrl.searchParams.get("date") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ success: false, error: "Invalid date." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("timezone").eq("id", device.businessId).single();
  const timezone = safeTimezone(business?.timezone);

  // A future date has no orders and would just be a confusing empty
  // report — clamp to today in the business's own timezone, same as
  // the website's getEndOfDaySummaryAction.
  const today = localDateKey(new Date().toISOString(), timezone);
  const dateKey = dateParam > today ? today : dateParam;

  const { startIso, endIso } = localDayBoundsUtc(dateKey, timezone);
  const { data: orders, error } = await admin
    .from("orders")
    .select("status, payment_status, subtotal_cents, tax_cents, total_cents, amount_refunded_cents")
    .eq("business_id", device.businessId)
    .neq("status", "building")
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  if (error) return NextResponse.json(dbErrorResult(error, "printer-app/day-summary GET", "Could not load that day."), { status: 500 });

  return NextResponse.json({ success: true, summary: buildDailySummary(dateKey, orders || []) });
}

export const GET = guardRoute("printer-app/day-summary GET", handleGET);
