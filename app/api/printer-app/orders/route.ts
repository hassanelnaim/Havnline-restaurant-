import { guardRoute } from "@/lib/api/routeGuard";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateDevice } from "@/lib/integrations/printer-app";
import { dbErrorResult } from "@/lib/errors";

export const dynamic = "force-dynamic";

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

// How long a job stays "claimed" before it's eligible to be handed out
// again. Well above the tablet's own 4s poll interval and its 8s
// printer hard-timeout combined, so a job that's genuinely still
// being printed never gets duplicated — but short enough that a job
// orphaned by a crashed tablet or dropped connection recovers on its
// own within a few polls rather than needing a manual retry.
const CLAIM_TIMEOUT_MS = 20_000;

/**
 * GET /api/printer-app/orders
 *
 * The tablet app polls this on an interval (every few seconds — it's
 * a plugged-in kitchen tablet, not a phone worried about battery, so
 * push notifications aren't worth the added complexity for now — see
 * the printer-app planning discussion). Returns pending print jobs
 * for the paired business and nothing else; the app has no way to see
 * any other business's orders even if it guessed an order id.
 *
 * Claims what it returns in the same query (sets claimed_at) so a job
 * that's already been handed to this tablet on a previous poll — but
 * hasn't been acked yet — isn't handed out again and printed twice.
 * This is one atomic UPDATE ... RETURNING under the hood, not a
 * select followed by a separate update, so two overlapping requests
 * can't both claim the same job.
 */
async function handleGET(request: NextRequest) {
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });

  const admin = createAdminClient();
  const claimCutoff = new Date(Date.now() - CLAIM_TIMEOUT_MS).toISOString();

  const { data: jobs, error } = await admin
    .from("printer_print_jobs")
    .update({ claimed_at: new Date().toISOString() })
    .eq("business_id", device.businessId)
    .eq("status", "pending")
    .or(`claimed_at.is.null,claimed_at.lt.${claimCutoff}`)
    .select("id, ticket_text, created_at")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json(dbErrorResult(error, "printer-app/orders GET", "Could not fetch print jobs."), { status: 500 });

  return NextResponse.json({ success: true, jobs: jobs || [] });
}

export const GET = guardRoute("printer-app/orders GET", handleGET);
