import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { mockTotalSpentThisMonth } from "@/lib/mock/data";
import { sumUsageCostsByProvider, sumCallSeconds } from "@/lib/usage/costTotals";

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

  const since = startOfMonth.toISOString();
  const [byProvider, callSeconds] = await Promise.all([sumUsageCostsByProvider(admin, { since }), sumCallSeconds(admin, { since })]);
  const aiCostCents = Array.from(byProvider.values()).reduce((sum, v) => sum + v, 0);
  const twilioCostCents = (callSeconds / 60) * 4.85; // ~$0.0485/min, same rate used elsewhere in the app

  return (aiCostCents + twilioCostCents) / 100;
}
