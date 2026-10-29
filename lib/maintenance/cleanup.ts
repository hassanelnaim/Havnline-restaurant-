import { createAdminClient } from "@/lib/supabase/admin";
import { runComplianceSweep } from "@/lib/compliance/checks";
import type { CronJobOutcome } from "@/lib/monitoring/cronRuns";
import { deleteUnverifiedAccounts, findUnverifiedAccounts, SIGNUPS_PER_DAY_ALERT, UNVERIFIED_ACCOUNT_DAYS } from "@/lib/admin/accounts";
import { sendPlatformAlert } from "@/lib/monitoring/platformAlert";

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
 * Call transcripts are deleted after TRANSCRIPT_RETENTION_DAYS (the call's
 * date, length and outcome, and its order, stay). Never touches orders,
 * customers or usage records. Old cron_runs and platform_alerts rows are
 * trimmed after 90 days. Accounts never verified and with no restaurant
 * are deleted after a week (bot sign-ups), with an email when sign-ups spike.
 */
export const TRANSCRIPT_RETENTION_DAYS = 90;
// Deleted in small batches so a big backlog can't run past the job's time limit.
const TRANSCRIPT_BATCH = 5000;
const TRANSCRIPT_TIME_BUDGET_MS = 30_000;

async function purgeOldTranscripts(admin: ReturnType<typeof createAdminClient>, before: string): Promise<{ count: number; error: { message: string } | null }> {
  const started = Date.now();
  let total = 0;
  while (Date.now() - started < TRANSCRIPT_TIME_BUDGET_MS) {
    const { data, error } = await admin.rpc("purge_old_call_messages", { p_before: before, p_limit: TRANSCRIPT_BATCH });
    if (error) return { count: total, error };
    const n = Number(data || 0);
    total += n;
    if (n < TRANSCRIPT_BATCH) break;
  }
  return { count: total, error: null };
}
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
    [`call transcript lines older than ${TRANSCRIPT_RETENTION_DAYS} days`, () => purgeOldTranscripts(admin, daysAgo(TRANSCRIPT_RETENTION_DAYS))],
    // Proof of texting consent is kept 4 years (migration 040), the federal
    // texting law's window for filing a claim.
    ["possible Terms violations found", async () => {
      try {
        const r = await runComplianceSweep();
        return { error: null, count: r.instructions + r.signals };
      } catch (err) {
        return { error: { message: err instanceof Error ? err.message : String(err) }, count: null };
      }
    }],
    // Bot sign-ups and abandoned sign-ups: never verified, no restaurant.
    [`unverified accounts older than ${UNVERIFIED_ACCOUNT_DAYS} days`, async () => {
      const r = await deleteUnverifiedAccounts(UNVERIFIED_ACCOUNT_DAYS * 24);
      return { error: r.error ? { message: r.error } : r.failed ? { message: `${r.failed} couldn't be deleted` } : null, count: r.deleted };
    }],
    ["new accounts in the last 24 hours", async () => {
      const r = await findUnverifiedAccounts(UNVERIFIED_ACCOUNT_DAYS * 24);
      if (r.error) return { error: { message: r.error }, count: null };
      if (r.recent24h >= SIGNUPS_PER_DAY_ALERT) {
        await sendPlatformAlert({
          key: "signup_spike_daily",
          subject: `HavnLine: ${r.recent24h} new accounts in the last 24 hours`,
          heading: "Unusual number of sign-ups",
          intro: "This many new accounts in a day is usually bots. The Health page lists unverified accounts with a button to delete them.",
          rows: [{ label: "New accounts (24 hours)", value: String(r.recent24h) }],
          throttleMinutes: 12 * 60,
        });
      }
      return { error: null, count: r.recent24h };
    }],
    ["texting consent records older than 4 years", () => admin.from("sms_consents").delete({ count: "exact" }).lt("consented_at", daysAgo(4 * 365 + 1))],
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
