import { getTotalSpentThisMonth } from "@/app/actions/cost-summary";
import Link from "next/link";
import { Building2, PhoneCall, ClipboardList, DollarSign, TrendingUp, AlertTriangle, ChevronRight } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { mockAdminBusinesses, mockCalls, mockOrders } from "@/lib/mock/data";
import { formatDate } from "@/lib/format";
import { getAllReviewsForModeration } from "@/lib/data/reviews";
import { ReviewModeration } from "@/components/admin/review-moderation";

export const dynamic = "force-dynamic";

// Matches the current flat pricing — used only to estimate MRR from
// subscription counts. If pricing ever becomes multi-tier, this
// should be replaced with a real sum from Stripe's own data instead.
const MONTHLY_PRICE = 199;

export default async function PlatformAdminPage() {
  const demoMode = !isSupabaseConfigured();

  const [businesses, totalCalls, totalOrders, escalatedCalls, totalSpentThisMonth] = demoMode
    ? [
        mockAdminBusinesses,
        mockCalls.length,
        mockOrders.filter((o) => o.status !== "cancelled").length,
        mockCalls.filter((c) => c.outcome === "escalated").length,
        0,
      ]
    : await (async () => {
        const admin = createAdminClient();
        const [{ data: biz }, { count: calls }, { count: orders }, { count: escalated }, spent] = await Promise.all([
          admin.from("businesses").select("id, name, subscription_status, cancel_at_period_end, current_period_end, created_at, phone").order("created_at", { ascending: false }),
          admin.from("calls").select("*", { count: "exact", head: true }),
          admin.from("orders").select("*", { count: "exact", head: true }).neq("status", "building").neq("status", "cancelled"),
          admin.from("calls").select("*", { count: "exact", head: true }).eq("outcome", "escalated"),
          getTotalSpentThisMonth(),
        ]);
        return [biz || [], calls || 0, orders || 0, escalated || 0, spent];
      })();

  const rows = businesses;
  const allReviews = await getAllReviewsForModeration();
  const pendingReviews = allReviews.filter((r) => r.status === "pending");
  const active = rows.filter((b) => b.subscription_status === "active").length;
  const trialing = rows.filter((b) => b.subscription_status === "trialing").length;
  const pastDue = rows.filter((b) => b.subscription_status === "past_due").length;
  const cancelled = rows.filter((b) => b.subscription_status === "canceled").length;
  const estimatedMrr = (active + pastDue) * MONTHLY_PRICE;

  const STATUS_STYLES: Record<string, string> = {
    active: "bg-success-soft text-success",
    trialing: "bg-brand-soft text-brand-dark",
    past_due: "bg-amber-100 text-amber-700",
    canceled: "bg-danger-soft text-danger",
    none: "bg-border-soft text-text-muted",
  };

  return (
    <div>
      <h1 className="font-display text-[24px] font-semibold text-ink">Command Center</h1>
      <p className="mt-1 text-[13.5px] text-text-muted">Real-time visibility across every business on HavnLine.</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-[12.5px] text-text-muted">Total businesses</span><Building2 className="h-4 w-4 text-brand" /></div>
          <div className="mt-2 font-display text-[28px] font-semibold text-ink">{rows.length}</div>
          <div className="mt-1 text-[11.5px] text-text-faint">{active} active · {trialing} trialing</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-[12.5px] text-text-muted">Estimated MRR</span><DollarSign className="h-4 w-4 text-success" /></div>
          <div className="mt-2 font-display text-[28px] font-semibold text-ink">${estimatedMrr.toLocaleString()}</div>
          <div className="mt-1 text-[11.5px] text-text-faint">Estimated from plan count, not Stripe's real ledger</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-[12.5px] text-text-muted">Total calls handled</span><PhoneCall className="h-4 w-4 text-brand" /></div>
          <div className="mt-2 font-display text-[28px] font-semibold text-ink">{totalCalls || 0}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-[12.5px] text-text-muted">Orders placed</span><ClipboardList className="h-4 w-4 text-success" /></div>
          <div className="mt-2 font-display text-[28px] font-semibold text-ink">{totalOrders || 0}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-[12.5px] text-text-muted">Spent this month</span><DollarSign className="h-4 w-4 text-danger" /></div>
          <div className="mt-2 font-display text-[28px] font-semibold text-ink">${totalSpentThisMonth.toFixed(2)}</div>
          <div className="mt-1 text-[11.5px] text-text-faint">Real AI + Twilio usage across all businesses</div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-[12.5px] text-text-muted">Past due</span><AlertTriangle className="h-4 w-4 text-warning" /></div>
          <div className="mt-2 font-display text-[24px] font-semibold text-ink">{pastDue}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-[12.5px] text-text-muted">Cancelled</span><TrendingUp className="h-4 w-4 text-danger" /></div>
          <div className="mt-2 font-display text-[24px] font-semibold text-ink">{cancelled}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-[12.5px] text-text-muted">Escalated calls</span><AlertTriangle className="h-4 w-4 text-danger" /></div>
          <div className="mt-2 font-display text-[24px] font-semibold text-ink">{escalatedCalls || 0}</div>
        </div>
      </div>

      <ReviewModeration pendingReviews={pendingReviews} />

      <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
        <h2 className="font-display text-[15px] font-semibold text-ink">All businesses</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-text-faint">
                <th className="py-2 pr-4">Business</th>
                <th className="py-2 pr-4">Phone</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Joined</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="group relative border-b border-border-soft last:border-0">
                  <td className="py-3 pr-4 font-medium text-text">
                    <Link href={`/admin/businesses/${b.id}`} className="absolute inset-0" aria-label={`Inspect ${b.name}`} />
                    <span className="relative group-hover:text-brand-dark">{b.name}</span>
                  </td>
                  <td className="py-3 pr-4 font-mono text-text-muted"><span className="relative">{b.phone || "—"}</span></td>
                  <td className="py-3 pr-4">
                    <span className={`relative rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[b.subscription_status] || STATUS_STYLES.none}`}>{b.subscription_status}</span>
                    {b.cancel_at_period_end && (
                      <span className="relative ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700" title={b.current_period_end ? `Access ends ${formatDate(b.current_period_end)}` : undefined}>
                        Canceling{b.current_period_end ? ` — ends ${formatDate(b.current_period_end)}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-text-muted"><span className="relative">{formatDate(b.created_at)}</span></td>
                  <td className="py-3 pr-4 text-right">
                    <ChevronRight className="relative inline h-4 w-4 text-text-faint group-hover:text-text" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-8 text-center text-[13px] text-text-muted">No businesses yet.</p>}
        </div>
      </div>
    </div>
  );
}
