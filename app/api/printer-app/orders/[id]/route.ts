import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateDevice } from "@/lib/integrations/printer-app";

export const dynamic = "force-dynamic";

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/**
 * POST /api/printer-app/orders/[id]
 *
 * The app reports back after attempting to print — "printed" once
 * the ticket actually went to the printer, "failed" (with a reason)
 * if the printer didn't respond. This is what lets the dashboard show
 * a real failure ("printer offline") instead of an order silently
 * never showing up in the kitchen with no explanation anywhere.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const status = body?.status === "printed" || body?.status === "failed" ? body.status : null;
  if (!status) return NextResponse.json({ success: false, error: "status must be 'printed' or 'failed'." }, { status: 400 });

  const admin = createAdminClient();
  const update =
    status === "printed"
      ? { status: "printed", printed_at: new Date().toISOString(), error: null }
      : { status: "failed", error: typeof body?.error === "string" ? body.error.slice(0, 500) : "The tablet couldn't reach the printer." };

  // Scoped to this device's own business — a device can never mark
  // (or even see) another business's print job as printed.
  const { error } = await admin.from("printer_print_jobs").update(update).eq("id", params.id).eq("business_id", device.businessId);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
