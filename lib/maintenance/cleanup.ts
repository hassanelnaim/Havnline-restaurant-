import { createAdminClient } from "@/lib/supabase/admin";
import type { CronJobOutcome } from "@/lib/monitoring/cronRuns";

/**
 * The nightly cleanup (app/api/cron/cleanup, and "Run now" on the admin
 * Health page).
 *
 * Tables that only ever grew: every rate-limit hit, every turn claim,
 * every printed kitchen ticket. Left alone they slow down the queries that
 * read them and cost storage every month. Also closes calls still marked
 * "in progress" hours later, because Twilio's call-ended report never
 * arrived: those used to stay open forever, and count against the
 * two-calls-per-caller limit for 30 minutes.
 *
 * Never touches orders, call transcripts, customers or usage records.
 * Old cron_runs and platform_alerts rows are trimmed after 90 days.
 */
export async function runNightlyCleanup(): Promise<CronJobOutcome> {
  const admin = createAdminClient();
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  // Built lazily, so each step only starts once the one before it is done.
  const steps: [string, () => PromiseLike<{ error: { message: string } | null; count?: number | null }>][] = [
    ["rate-limit hits older than 2 days", () => admin.from("rate_limit_hits").delete({ count: "exact" }).lt("created_at", daysAgo(2))],
    ["turn claims older than 2 days", () => admin.from("call_turn_claims").delete({ count: "exact" }).lt("created_at", daysAgo(2))],
    ["caller speech hand-offs older than 1 day", () => admin.from("call_speech_handoffs").delete({ count: "exact" }).lt("created_at", daysAgo(1))],
    ["printed tickets older than 30 days", () => admin.from("printer_print_jobs").delete({ count: "exact" }).eq("status", "printed").lt("created_at", daysAgo(30))],
    ["calls stuck in progress for 2+ hours", () => admin.from("calls").update({ status: "completed" }, { count: "exact" }).eq("status", "in_progress").lt("started_at", hoursAgo(2))],
    ["job history older than 90 days", () => admin.from("cron_runs").delete({ count: "exact" }).lt("started_at", daysAgo(90))],
    ["alert log older than 90 days", () => admin.from("platform_alerts").delete({ count: "exact" }).lt("created_at", daysAgo(90))],
  ];

  const result: Record<string, number | string> = {};
  let ok = true;
  for (const [label, run] of steps) {
    try {
      const { error, count } = await run();
      result[label] = error ? `failed: ${error.message}` : count ?? 0;
      if (error) {
        ok = false;
        console.error(`[cron/cleanup] ${label}:`, error.message);
      }
    } catch (err) {
      ok = false;
      result[label] = `failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return { ok, result };
}
