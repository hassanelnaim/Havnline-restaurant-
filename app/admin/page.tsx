import { requirePlatformAdmin } from "@/lib/supabase/platform-admin";
import { getTotalSpentThisMonth } from "@/app/actions/cost-summary";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { mockAdminBusinesses } from "@/lib/mock/data";
import { getAllReviewsForModeration } from "@/lib/data/reviews";
import { getPlatformRevenueMetrics } from "@/lib/billing/platform-metrics";
import { getBusinessIssues } from "@/lib/admin/issues";
import { getHealthReport, healthCounts, type HealthCounts } from "@/lib/admin/health";
import { ADMIN_TIMEZONE, getCallActivity, type CallActivity } from "@/lib/admin/overview";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { IssuesPanel } from "@/components/admin/issues-panel";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { BusinessesCard, CallsTodayCard, HealthStrip, MoneyCard, TwoWeeksCard } from "@/components/admin/command-center";

export const dynamic = "force-dynamic";

const EMPTY_ACTIVITY: CallActivity = { available: false, hourly: [], peak: 0, peakAt: null, liveNow: 0, daily: [] };

function localParts(timeZone: string) {
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now)) % 24;
  return { today, hour };
}

export default async function PlatformAdminPage() {
  await requirePlatformAdmin();
  const demoMode = !isSupabaseConfigured();

  const [businesses, totalSpentThisMonth, revenue, issues, allReviews, activity, counts] = await Promise.all([
    demoMode
      ? Promise.resolve(mockAdminBusinesses)
      : (async () => {
          const admin = createAdminClient();
          const { data } = await fetchAllRows<{ id: string; subscription_status: string; created_at: string }>((from, to) =>
            admin.from("businesses").select("id, subscription_status, created_at").order("id").range(from, to)
          );
          return data;
        })(),
    getTotalSpentThisMonth(),
    getPlatformRevenueMetrics(),
    demoMode ? Promise.resolve([]) : getBusinessIssues(),
    getAllReviewsForModeration(),
    demoMode ? Promise.resolve(EMPTY_ACTIVITY) : getCallActivity().catch(() => EMPTY_ACTIVITY),
    demoMode
      ? Promise.resolve<HealthCounts | null>(null)
      : getHealthReport()
          .then(healthCounts)
          .catch((err) => {
            console.error("[admin] health summary failed:", err);
            return null;
          }),
  ]);

  const pendingReviews = allReviews.filter((r) => r.status === "pending").length;
  const { today, hour } = localParts(ADMIN_TIMEZONE);
  const peakAtLabel = activity.peakAt
    ? new Intl.DateTimeFormat("en-US", { timeZone: ADMIN_TIMEZONE, hour: "numeric", minute: "2-digit" }).format(new Date(activity.peakAt))
    : null;

  return (
    <div>
      <AutoRefresh />
      <h1 className="font-display text-[24px] font-semibold text-ink">Command Center</h1>
      <p className="mt-1 text-[13.5px] text-text-muted">Everything across HavnLine at a glance. Refreshes every minute.</p>

      <HealthStrip counts={counts} pendingReviews={pendingReviews} />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <CallsTodayCard activity={activity} peakAtLabel={peakAtLabel} currentHour={hour} timezone={ADMIN_TIMEZONE} />
        <MoneyCard revenue={revenue} spentThisMonth={totalSpentThisMonth} />
        <TwoWeeksCard activity={activity} today={today} />
        <BusinessesCard businesses={businesses} now={Date.now()} />
      </div>

      <IssuesPanel issues={issues} />
    </div>
  );
}
