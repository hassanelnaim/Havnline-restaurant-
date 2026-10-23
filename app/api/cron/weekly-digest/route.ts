import { NextRequest, NextResponse } from "next/server";
import { runWeeklyDigestJob } from "@/lib/notifications/weekly-digest-email";
import { runCronJob } from "@/lib/monitoring/cronRuns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/weekly-digest
 *
 * Fired daily by Vercel Cron (see vercel.json; each business gets one a week). Vercel automatically
 * sends `Authorization: Bearer ${CRON_SECRET}` on cron-triggered
 * requests when a CRON_SECRET env var is set on the project — checked
 * here so this endpoint can't be hit by anyone who finds the URL and
 * used to spam every business's members with a digest email on demand.
 *
 * Fails CLOSED if CRON_SECRET isn't set, unlike most optional
 * integrations in this app: those quietly no-op when unconfigured,
 * but this one would otherwise sit open to the whole internet — the
 * opposite of "safely doing nothing." Set it in production.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("CRON_SECRET is not configured — refusing to run the weekly digest.");
    return new NextResponse("Not configured", { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const outcome = await runCronJob("weekly-digest", "schedule", runWeeklyDigestJob);
  return NextResponse.json(outcome.result);
}
