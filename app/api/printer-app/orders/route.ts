import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateDevice } from "@/lib/integrations/printer-app";

export const dynamic = "force-dynamic";

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/**
 * GET /api/printer-app/orders
 *
 * The tablet app polls this on an interval (every few seconds — it's
 * a plugged-in kitchen tablet, not a phone worried about battery, so
 * push notifications aren't worth the added complexity for now — see
 * the printer-app planning discussion). Returns pending print jobs
 * for the paired business and nothing else; the app has no way to see
 * any other business's orders even if it guessed an order id.
 */
export async function GET(request: NextRequest) {
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });

  const admin = createAdminClient();
  const { data: jobs, error } = await admin
    .from("printer_print_jobs")
    .select("id, ticket_text, created_at")
    .eq("business_id", device.businessId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, jobs: jobs || [] });
}
