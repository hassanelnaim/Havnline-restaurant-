import { getTotalSpentThisMonth } from "@/app/actions/cost-summary";
import Link from "next/link";
import { Building2, DollarSign, TrendingUp, ArrowUpRight } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { mockAdminBusinesses } from "@/lib/mock/data";
import { getAllReviewsForModeration } from "@/lib/data/reviews";
import { getPlatformRevenueMetrics } from "@/lib/billing/platform-metrics";
import { getBusinessIssues } from "@/lib/admin/issues";
import { ReviewModeration } from "@/components/admin/review-moderation";
import { IssuesPanel } from "@/components/admin/issues-panel";
import { AutoRefresh } from "@/components/admin/auto-refresh";

export const dynamic = "force-dynamic";

export default async function PlatformAdminPage() {
  const demoMode = !isSupabaseConfigured();

  const [businesses, totalSpentThisMonth, revenue, issues, allReviews] = await Promise.all([
    demoMode
      ? Promise.resolve(mockAdminBusinesses)
      : (async () => {
          const admin = createAdminClient();
          const { data } = await admin.from("businesses").select("id, subscription_status, created_at");
          return data || [];
        })(),
    getTotalSpentThisMonth(),
    getPlatformRevenueMetrics(),
    demoMode ? Promise.resolve([]) : getBusinessIssues(),
    getAllReviewsForModeration(),
  ]);

  const pendingReviews = allReviews.filter((r) => r.status === "pending");
  const active = businesses.filter((b) => b.subscription_status === "active").length;
  const trialing = businesses.filter((b) => b.subscription_status === "trialing").length;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newThisWeek = businesses.filter((b) => new Date(b.created_at).getTime() >= sevenDaysAgo).length;

  return (
    <div>
      <AutoRefresh />
      <h1 className="font-display text-[24px] font-semibold text-ink">Command Center</h1>
      <p className="mt-1 text-[13.5px] text-text-muted">Real visibility across every business on HavnLine — refreshes automatically.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/admin/businesses" className="group rounded-2xl border border-border bg-card p-5 shadow-card transition hover:border-brand/40">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] text-text-muted">Total businesses</span>
            <Building2 className="h-4 w-4 text-brand" />
          </div>
          <div className="mt-2 font-display text-[28px] font-semibold text-ink">{businesses.length}</div>
          <div className="mt-1 flex items-center gap-1 text-[11.5px] text-text-faint">
            {active} active · {trialing} trialing · {newThisWeek} new this week
            <ArrowUpRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
          </div>
        </Link>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-[12.5px] text-text-muted">MRR</span><TrendingUp className="h-4 w-4 text-success" /></div>
          {revenue.configured ? (
            <>
              <div className="mt-2 font-display text-[28px] font-semibold text-ink">${(revenue.mrrCents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
              <div className="mt-1 text-[11.5px] text-text-faint">Real, from Stripe · {revenue.activeSubscriptionCount} active subscription{revenue.activeSubscriptionCount === 1 ? "" : "s"}</div>
            </>
          ) : (
            <div className="mt-2 text-[13px] text-text-faint">Stripe not configured</div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-[12.5px] text-text-muted">Revenue this month</span><DollarSign className="h-4 w-4 text-success" /></div>
          {revenue.configured ? (
            <>
              <div className="mt-2 font-display text-[28px] font-semibold text-ink">${(revenue.revenueThisMonthCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="mt-1 text-[11.5px] text-text-faint">Actually collected by Stripe so far this month</div>
            </>
          ) : (
            <div className="mt-2 text-[13px] text-text-faint">Stripe not configured</div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-[12.5px] text-text-muted">Spent this month</span><DollarSign className="h-4 w-4 text-danger" /></div>
          <div className="mt-2 font-display text-[28px] font-semibold text-ink">${totalSpentThisMonth.toFixed(2)}</div>
          <div className="mt-1 text-[11.5px] text-text-faint">Real AI + Twilio usage across all businesses</div>
        </div>
      </div>

      {revenue.error && (
        <div className="mt-4 rounded-xl border border-danger/20 bg-danger-soft px-4 py-3 text-[13px] text-danger">
          Couldn't reach Stripe for revenue numbers: {revenue.error}
        </div>
      )}

      <IssuesPanel issues={issues} />

      <ReviewModeration pendingReviews={pendingReviews} />
    </div>
  );
}
