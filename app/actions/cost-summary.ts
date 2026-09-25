import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { mockTotalSpentThisMonth } from "@/lib/mock/data";

/**
 * Real, honest total — actual AI usage costs (Anthropic + ElevenLabs,
 * logged per real event) plus Twilio cost estimated from real call
 * minutes, summed across every business, for the current calendar
 * month only.
 */
export async function getTotalSpentThisMonth(): Promise<number> {
  if (!isSupabaseConfigured()) return mockTotalSpentThisMonth;
  const admin = createAdminClient();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [{ data: usageRecords }, { data: calls }] = await Promise.all([
    admin.from("usage_records").select("estimated_cost_cents").gte("created_at", startOfMonth.toISOString()),
    admin.from("calls").select("duration_seconds").gte("started_at", startOfMonth.toISOString()),
  ]);

  const aiCostCents = (usageRecords || []).reduce((sum, r) => sum + Number(r.estimated_cost_cents), 0);
  const totalMinutes = (calls || []).reduce((sum, c) => sum + (c.duration_seconds || 0), 0) / 60;
  const twilioCostCents = totalMinutes * 4.85; // ~$0.0485/min, same rate used elsewhere in the app

  return (aiCostCents + twilioCostCents) / 100;
}
