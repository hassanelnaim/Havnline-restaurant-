import Link from "next/link";
import { PhoneCall, ClipboardList, AlertTriangle, ArrowUpRight } from "lucide-react";
import { getBusiness } from "@/lib/data/business";
import { getAiReceptionist } from "@/lib/data/ai-receptionist";
import { getCalls } from "@/lib/data/calls";
import { getOrdersForBusiness } from "@/lib/data/orders";
import { getCustomers } from "@/lib/data/customers";
import { CallOutcomeBadge, OrderStatusBadge } from "@/components/dashboard/status-badges";
import { EmptyState } from "@/components/dashboard/empty-state";
import { NewCustomersCard } from "@/components/dashboard/new-customers-card";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// Real business-local date string (YYYY-MM-DD), not the server's UTC
// date — the same pattern used in lib/ai/context.ts and systemPrompt.ts.
function toBizDateString(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export default async function OverviewPage() {
  const business = await getBusiness();
  const [ai, calls, orders, customers] = await Promise.all([
    getAiReceptionist(), getCalls(), getOrdersForBusiness(business.id), getCustomers(),
  ]);

  const timezone = business.timezone || "America/New_York";
  const todayInBizTz = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const callsToday = calls.filter((c) => toBizDateString(c.started_at, timezone) === todayInBizTz).length;
  const ordersToday = orders.filter((o) => toBizDateString(o.created_at, timezone) === todayInBizTz && o.status !== "cancelled").length;
  const escalationsToday = calls.filter((c) => c.outcome === "escalated" && toBizDateString(c.started_at, timezone) === todayInBizTz).length;

  const recentCalls = calls.slice(0, 5);
  const recentOrders = orders.filter((o) => o.status !== "cancelled").slice(0, 5);

  return (
    <div>
      <h1 className="font-display text-[24px] font-semibold text-ink">Overview</h1>
      <p className="mt-1 text-[13.5px] text-text-muted">Here&apos;s what&apos;s happened with {ai.name} recently.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">Calls today</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand-dark"><PhoneCall className="h-4 w-4" /></div>
          </div>
          <div className="mt-2 font-display text-[28px] font-semibold text-ink">{callsToday}</div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">Orders today</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand-dark"><ClipboardList className="h-4 w-4" /></div>
          </div>
          <div className="mt-2 font-display text-[28px] font-semibold text-ink">{ordersToday}</div>
        </div>

        <Link href="/dashboard/escalations" className="group rounded-2xl border border-border bg-card p-5 shadow-card transition-colors hover:border-danger/40 hover:bg-danger-soft/40">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">Human escalations</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-danger-soft text-danger"><AlertTriangle className="h-4 w-4" /></div>
          </div>
          <div className="mt-2 flex items-center gap-1.5 font-display text-[28px] font-semibold text-ink">
            {escalationsToday}
            <ArrowUpRight className="h-4 w-4 text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <div className="mt-1 text-[11.5px] text-text-faint">Today — click to view</div>
        </Link>

        <NewCustomersCard customers={customers} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[15px] font-semibold text-ink">Recent calls</h2>
            <Link href="/dashboard/calls" className="flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline">View all <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
          {recentCalls.length === 0 ? (
            <EmptyState icon={PhoneCall} title="No calls yet" description="Calls your AI answers will show up here." />
          ) : (
            <div className="space-y-1">
              {recentCalls.map((call) => (
                <Link key={call.id} href={`/dashboard/calls/${call.id}`} className="flex items-center justify-between rounded-lg px-2 py-2.5 hover:bg-paper">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">PC</div>
                    <div>
                      <div className="text-[13px] font-medium text-text">{call.customer_name}</div>
                      <div className="text-[11.5px] text-text-faint">{formatDateTime(call.started_at, timezone)}</div>
                    </div>
                  </div>
                  <CallOutcomeBadge outcome={call.outcome} />
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[15px] font-semibold text-ink">Recent orders</h2>
            <Link href="/dashboard/orders" className="flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline">View all <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
          {recentOrders.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No orders yet" description="Orders your AI takes will appear here." />
          ) : (
            <div className="space-y-1">
              {recentOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between rounded-lg px-2 py-2.5 hover:bg-paper">
                  <div>
                    <div className="text-[13px] font-medium text-text">{order.customer_name || "Phone order"} — ${(order.total_cents / 100).toFixed(2)}</div>
                    <div className="text-[11.5px] text-text-faint">{formatDateTime(order.created_at, timezone)}</div>
                  </div>
                  <OrderStatusBadge status={order.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
