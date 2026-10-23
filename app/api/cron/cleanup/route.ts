import { NextRequest, NextResponse } from "next/server";
import { runNightlyCleanup } from "@/lib/maintenance/cleanup";
import { runCronJob } from "@/lib/monitoring/cronRuns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/cleanup — runs nightly (vercel.json). The work itself is
 * in lib/maintenance/cleanup.ts; each run is recorded for the admin
 * Health page.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return new NextResponse("Not configured", { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) return new NextResponse("Unauthorized", { status: 401 });

  const outcome = await runCronJob("cleanup", "schedule", runNightlyCleanup);
  return NextResponse.json(outcome.result);
}
