import { BusinessActions } from "@/components/admin/business-actions";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bot, DollarSign, PhoneCall, ClipboardList, CreditCard } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { mockAdminBusinessDetails, mockCalls, mockOrders } from "@/lib/mock/data";
import { getBusinessCostBreakdown } from "@/lib/usage/tracking";
import { getBusinessIssues } from "@/lib/admin/issues";
import { formatDate } from "@/lib/format";
import { StatusEditor } from "@/components/admin/status-editor";
import { FeeEditor } from "@/components/admin/fee-editor";
import { IssuesPanel } from "@/components/admin/issues-panel";
import { AutoRefresh } from "@/components/admin/auto-refresh";

export const dynamic = "force-dynamic";

export default async function PlatformBusinessDetailPage({ params }: { params: { id: string } }) {
  const demoMode = !isSupabaseConfigured();

  const { business, callCount, orderCount } = demoMode
    ? {
        business: mockAdminBusinessDetails.find((b) => b.id === params.id) || null,
        callCount: mockCalls.length,
        orderCount: mockOrders.filter((o) => o.status !== "cancelled").length,
      }
    : await (async () => {
        const admin = createAdminClient();
        const [{ data: biz }, { count: calls }, { count: orders }] = await Promise.all([
          admin.from("businesses").select("*").eq("id", params.id).maybeSingle(),
          admin.from("calls").select("*", { count: "exact", head: true }).eq("business_id", params.id),
          admin.from("orders").select("*", { count: "exact", head: true }).eq("business_id", params.id).neq("status", "building").neq("status", "cancelled"),
        ]);
        return { business: biz, callCount: calls || 0, orderCount: orders || 0 };
      })();

  if (!business) notFound();

  const [costs, issues] = await Promise.all([getBusinessCostBreakdown(params.id), demoMode ? Promise.resolve([]) : getBusinessIssues(params.id)]);

  return (
    <div>
      <AutoRefresh />
      <Link href="/admin/businesses" className="flex items-center gap-1.5 text-[13px] font-medium text-text-muted hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to all businesses
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[24px] font-semibold text-ink">{business.name}</h1>
          <p className="mt-1 text-[13px] text-text-muted">{business.phone || "No phone"} · Joined {formatDate(business.created_at)}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusEditor businessId={business.id} currentStatus={business.subscription_status} />
          <BusinessActions businessId={business.id} businessName={business.name} isSuspended={business.is_suspended} />
        </div>
      </div>

      {business.is_suspended && (
        <div className="mt-4 rounded-xl border border-danger/20 bg-danger-soft px-4 py-3 text-[13px] text-danger">
          <strong>Suspended</strong> {business.suspended_reason && `— ${business.suspended_reason}`}
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-[12.5px] text-text-muted">Calls taken</span><PhoneCall className="h-4 w-4 text-brand" /></div>
          <div className="mt-2 font-display text-[26px] font-semibold text-ink">{callCount}</div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between"><span className="text-[12.5px] text-text-muted">Orders placed</span><ClipboardList className="h-4 w-4 text-success" /></div>
          <div className="mt-2 font-display text-[26px] font-semibold text-ink">{orderCount}</div>
        </div>
      </div>

      <IssuesPanel issues={issues} showBusinessLink={false} />

      <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-brand" />
          <h2 className="font-display text-[15px] font-semibold text-ink">Payments</h2>
        </div>
        <p className="mt-1 text-[12px] text-text-faint">
          What HavnLine keeps from this business's phone-order payments (Stripe Connect application fee). There's no Stripe dashboard setting for this — it's entirely controlled by this field, applied to every paid phone order.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-border-soft pt-4">
          <div>
            <div className="text-[13px] font-medium text-text">Stripe Connect</div>
            <div className="mt-0.5 text-[12px] text-text-muted">
              {business.stripe_connect_charges_enabled
                ? "Connected and able to accept phone payments."
                : business.stripe_connect_account_id
                ? "Account created, onboarding not finished."
                : "Not connected yet."}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-faint">Platform fee</div>
            <FeeEditor businessId={business.id} currentFeeBps={business.platform_fee_bps} />
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-brand" />
          <h2 className="font-display text-[15px] font-semibold text-ink">AI cost breakdown</h2>
        </div>
        <p className="mt-1 text-[12px] text-text-faint">
          Anthropic and ElevenLabs bill HavnLine as one shared account — these figures are HavnLine's own internal estimates for what this specific business is costing, calculated from real usage at each provider's current published rate. Not a real provider invoice.
        </p>

        <div className="mt-4 divide-y divide-border-soft">
          <div className="flex items-center justify-between py-3">
            <span className="text-[13px] text-text">Anthropic (Claude conversations)</span>
            <span className="font-mono text-[13px] font-medium text-text">${(costs.anthropicCents / 100).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-[13px] text-text">ElevenLabs (voice generation)</span>
            <span className="font-mono text-[13px] font-medium text-text">${(costs.elevenLabsCents / 100).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-[13px] text-text">Twilio (calls, from real minutes)</span>
            <span className="font-mono text-[13px] font-medium text-text">${(costs.twilioCents / 100).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-ink"><DollarSign className="h-3.5 w-3.5" /> Total estimated cost</span>
            <span className="font-mono text-[15px] font-semibold text-ink">${(costs.totalCents / 100).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
