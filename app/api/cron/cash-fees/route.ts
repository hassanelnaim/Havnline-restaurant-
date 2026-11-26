import { NextRequest, NextResponse } from "next/server";
import { billCashOrderFees } from "@/lib/billing/cashFees";
import { runCronJob } from "@/lib/monitoring/cronRuns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/cash-fees — runs nightly (vercel.json): adds HavnLine's fee
 * on cash-at-pickup orders to each restaurant's next monthly invoice
 * (lib/billing/cashFees.ts).
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return new NextResponse("Not configured", { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) return new NextResponse("Unauthorized", { status: 401 });

  const outcome = await runCronJob("cash-fees", "schedule", () => billCashOrderFees());
  return NextResponse.json(outcome.result);
}
