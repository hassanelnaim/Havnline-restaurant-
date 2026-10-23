import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/cleanup — runs nightly (vercel.json).
 *
 * Tables that only ever grew: every rate-limit hit, every turn claim,
 * every printed kitchen ticket. Left alone they slow down the queries that
 * read them and cost storage every month. Also closes calls still marked
 * "in progress" hours later, because Twilio's call-ended report never
 * arrived: those used to stay open forever, and count against the
 * two-calls-per-caller limit for 30 minutes.
 *
 * Never touches orders, call transcripts, customers or usage records.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return new NextResponse("Not configured", { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) return new NextResponse("Unauthorized", { status: 401 });

  const admin = createAdminClient();
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const steps: [string, PromiseLike<{ error: { message: string } | null; count?: number | null }>][] = [
    ["rate-limit hits older than 2 days", admin.from("rate_limit_hits").delete({ count: "exact" }).lt("created_at", daysAgo(2))],
    ["turn claims older than 2 days", admin.from("call_turn_claims").delete({ count: "exact" }).lt("created_at", daysAgo(2))],
    ["caller speech hand-offs older than 1 day", admin.from("call_speech_handoffs").delete({ count: "exact" }).lt("created_at", daysAgo(1))],
    ["printed tickets older than 30 days", admin.from("printer_print_jobs").delete({ count: "exact" }).eq("status", "printed").lt("created_at", daysAgo(30))],
    ["calls stuck in progress for 2+ hours", admin.from("calls").update({ status: "completed" }, { count: "exact" }).eq("status", "in_progress").lt("started_at", hoursAgo(2))],
  ];

  const result: Record<string, number | string> = {};
  for (const [label, op] of steps) {
    const { error, count } = await op;
    result[label] = error ? `failed: ${error.message}` : count ?? 0;
    if (error) console.error(`[cron/cleanup] ${label}:`, error.message);
  }
  return NextResponse.json(result);
}
