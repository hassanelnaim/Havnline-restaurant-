import { guardRoute } from "@/lib/api/routeGuard";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateDevice, MAX_PRINT_ATTEMPTS, PRINT_CLAIM_TIMEOUT_MS, printRetryDelayMs } from "@/lib/integrations/printer-app";
import { sendOrderAttentionEmail } from "@/lib/notifications/account-email";
import { dbErrorResult } from "@/lib/errors";

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
async function handlePOST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Next 15: route params arrive as a promise.
  const params = await ctx.params;
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const status = body?.status === "printed" || body?.status === "failed" ? body.status : null;
  if (!status) return NextResponse.json({ success: false, error: "status must be 'printed' or 'failed'." }, { status: 400 });

  const admin = createAdminClient();

  if (status === "printed") {
    // Scoped to this device's own business — a device can never mark
    // (or even see) another business's print job as printed.
    const { error } = await admin
      .from("printer_print_jobs")
      .update({ status: "printed", printed_at: new Date().toISOString(), error: null })
      .eq("id", params.id)
      .eq("business_id", device.businessId);
    if (error) return NextResponse.json(dbErrorResult(error, "printer-app/orders/[id] POST", "Could not update that print job."), { status: 500 });
    return NextResponse.json({ success: true });
  }

  // The printer couldn't take it (off, out of paper, unplugged). Instead of
  // the ticket sitting failed until someone notices the dashboard, it goes
  // back in the queue a few times, waiting longer each time (the tablet
  // only gets it again once its claim has aged past the claim timeout).
  // After the last try it's marked failed and the owner is emailed.
  const reason = typeof body?.error === "string" ? body.error.slice(0, 500) : "The tablet couldn't reach the printer.";
  const { data: job, error: readError } = await admin
    .from("printer_print_jobs")
    .select("id, order_id, attempts, status")
    .eq("id", params.id)
    .eq("business_id", device.businessId)
    .maybeSingle();
  if (readError) return NextResponse.json(dbErrorResult(readError, "printer-app/orders/[id] POST", "Could not update that print job."), { status: 500 });
  if (!job || job.status === "printed") return NextResponse.json({ success: true });

  const attempts = (job.attempts || 0) + 1;
  if (attempts < MAX_PRINT_ATTEMPTS) {
    const retryAt = Date.now() + printRetryDelayMs(attempts);
    const { error } = await admin
      .from("printer_print_jobs")
      // handed_out back to 0: this ticket is known NOT to have printed, so
      // its next print isn't a possible reprint (migration 036).
      .update({ status: "pending", attempts, handed_out: 0, error: reason, claimed_at: new Date(retryAt - PRINT_CLAIM_TIMEOUT_MS).toISOString() })
      .eq("id", job.id);
    if (error) return NextResponse.json(dbErrorResult(error, "printer-app/orders/[id] POST", "Could not update that print job."), { status: 500 });
    return NextResponse.json({ success: true, willRetry: true });
  }

  const { error } = await admin.from("printer_print_jobs").update({ status: "failed", attempts, error: reason }).eq("id", job.id);
  if (error) return NextResponse.json(dbErrorResult(error, "printer-app/orders/[id] POST", "Could not update that print job."), { status: 500 });

  const { data: order } = await admin.from("orders").select("customer_name, phone, total_cents").eq("id", job.order_id).maybeSingle();
  await admin.from("orders").update({ submit_error: `The kitchen printer didn't print this ticket: ${reason}` }).eq("id", job.order_id);
  await sendOrderAttentionEmail({
    businessId: device.businessId,
    subject: "a kitchen ticket didn't print",
    heading: "A paid order didn't print",
    intro: `The kitchen printer couldn't print this ticket after ${attempts} tries (${reason}). Check the printer, then press Retry on the order, or make it from the Orders page.`,
    customerName: order?.customer_name,
    customerPhone: order?.phone,
    totalCents: order?.total_cents,
  });
  return NextResponse.json({ success: true });
}

export const POST = guardRoute("printer-app/orders/[id] POST", handlePOST);
