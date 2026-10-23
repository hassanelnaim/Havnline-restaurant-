import { guardRoute } from "@/lib/api/routeGuard";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateDevice, PRINT_CLAIM_TIMEOUT_MS } from "@/lib/integrations/printer-app";
import { dbErrorResult } from "@/lib/errors";

export const dynamic = "force-dynamic";

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

// See PRINT_CLAIM_TIMEOUT_MS in lib/integrations/printer-app.ts.
const CLAIM_TIMEOUT_MS = PRINT_CLAIM_TIMEOUT_MS;

const POSSIBLE_REPRINT_BANNER = "** POSSIBLE REPRINT **\nCheck this order isn't already made";

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

  // One atomic claim in the database (migration 036) that also counts how
  // many times each job has been handed out without a "printed" reply.
  let jobs: { id: string; ticket_text: string; created_at: string; handed_out?: number }[] = [];
  const { data: claimed, error: rpcError } = await admin.rpc("claim_print_jobs", { p_business: device.businessId, p_cutoff: claimCutoff });
  if (!rpcError) {
    jobs = (claimed || []) as typeof jobs;
  } else {
    if (!/could not find the function|PGRST202|42883/i.test(`${rpcError.code} ${rpcError.message}`)) {
      return NextResponse.json(dbErrorResult(rpcError, "printer-app/orders GET", "Could not fetch print jobs."), { status: 500 });
    }
    // Before migration 036: the original single-update claim.
    const { data, error } = await admin
      .from("printer_print_jobs")
      .update({ claimed_at: new Date().toISOString() })
      .eq("business_id", device.businessId)
      .eq("status", "pending")
      .or(`claimed_at.is.null,claimed_at.lt.${claimCutoff}`)
      .select("id, ticket_text, created_at");
    if (error) return NextResponse.json(dbErrorResult(error, "printer-app/orders GET", "Could not fetch print jobs."), { status: 500 });
    jobs = data || [];
  }

  // A job handed out before with no "printed" reply may already be on paper
  // (the reply was lost on the way back). It's printed again, since it may
  // not have been, but marked so the kitchen checks before making it twice.
  jobs = jobs
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .map((j) => ({
      id: j.id,
      created_at: j.created_at,
      ticket_text: (j.handed_out ?? 1) > 1 ? `${POSSIBLE_REPRINT_BANNER}\n${j.ticket_text}` : j.ticket_text,
    }));

  return NextResponse.json({ success: true, jobs });
}

export const GET = guardRoute("printer-app/orders GET", handleGET);
