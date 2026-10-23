import { createAdminClient } from "@/lib/supabase/admin";

export type CronJob = "cleanup" | "weekly-digest";
export type CronTrigger = "schedule" | "manual";

export interface CronJobOutcome {
  ok: boolean;
  result: Record<string, unknown>;
}

/**
 * Runs a background job and records the run in cron_runs (migration 038),
 * so the admin Health page can show when each job last ran and what it did.
 * Recording is best-effort: if the table is missing or the database is
 * unreachable for the bookkeeping, the job itself still runs.
 */
export async function runCronJob(job: CronJob, trigger: CronTrigger, work: () => Promise<CronJobOutcome>): Promise<CronJobOutcome> {
  const admin = createAdminClient();
  let runId: string | null = null;
  try {
    const { data, error } = await admin.from("cron_runs").insert({ job, trigger }).select("id").single();
    if (error) console.error(`[cron/${job}] could not record the run start (run migration 038):`, error.message);
    runId = data?.id ?? null;
  } catch (err) {
    console.error(`[cron/${job}] could not record the run start:`, err);
  }

  let outcome: CronJobOutcome;
  try {
    outcome = await work();
  } catch (err) {
    outcome = { ok: false, result: { error: err instanceof Error ? err.message : String(err) } };
  }

  if (runId) {
    try {
      await admin.from("cron_runs").update({ finished_at: new Date().toISOString(), ok: outcome.ok, result: outcome.result }).eq("id", runId);
    } catch (err) {
      console.error(`[cron/${job}] could not record the run result:`, err);
    }
  }
  return outcome;
}
