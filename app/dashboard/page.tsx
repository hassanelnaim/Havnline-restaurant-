import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { PhoneCall, ClipboardList, AlertTriangle, ArrowUpRight, DollarSign } from "lucide-react";
import { getBusiness } from "@/lib/data/business";
import { getCalls } from "@/lib/data/calls";
import { getOrdersForBusiness, getOrderTotalsSince, getOrdersWithItemsSince } from "@/lib/data/orders";
import { getMenuForBusiness } from "@/lib/data/menu";
import { countsTowardSales } from "@/lib/orders/sales";
import { getSpecialSuggestions } from "@/lib/analytics/specialSuggestions";
import { SalesCard } from "@/components/dashboard/sales-card";
import { TopSellers } from "@/components/dashboard/top-sellers";
import { SpecialIdeas } from "@/components/dashboard/special-ideas";
import { getSalesSeries, getSellerData } from "@/lib/data/analytics";

export const dynamic = "force-dynamic";

// Real business-local date string (YYYY-MM-DD), not the server's UTC
// date — the same pattern used in lib/ai/context.ts and systemPrompt.ts.
function toBizDateString(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

// Rolling, not calendar-aligned, so it visibly moves week to week
// instead of settling into one flat number — see the "On pace for" figure
// below.
const TRAILING_WINDOW_DAYS = 7;
const PROJECTED_MONTH_DAYS = 30;
// Wider window for the specials-suggestion engine — a week is too short to tell a
// real slow-day pattern from one quiet Tuesday.
const PATTERN_WINDOW_DAYS = 28;

interface StatTileProps {
  href: string;
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  accentClass?: string;
}

// Every stat on this page is a door to somewhere, not a dead end — the
// old version only made "Human escalations" clickable, so the other
// five numbers were just numbers to look at, never to act on.
function StatTile({ href, label, value, icon: Icon, hint, accentClass }: StatTileProps) {
  return (
    <Link
      href={href}
      className={`group rounded-2xl border border-border bg-card p-5 shadow-card transition-colors hover:border-brand/40 hover:bg-brand-soft/20 ${accentClass || ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">{label}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand-dark"><Icon className="h-4 w-4" /></div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 font-display text-[28px] font-semibold text-ink">
        {value}
        <ArrowUpRight className="h-4 w-4 text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      {hint && <div className="mt-1 text-[11.5px] text-text-faint">{hint}</div>}
    </Link>
  );
}

export default async function OverviewPage() {
  const business = await getBusiness();
  const sinceIso = new Date(Date.now() - TRAILING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const patternSinceIso = new Date(Date.now() - PATTERN_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const timezone = business.timezone || "America/New_York";

  const [calls, orders, weekOrders, patternOrders, menu, salesData, sellerData] = await Promise.all([
    getCalls(),
    getOrdersForBusiness(business.id),
    getOrderTotalsSince(business.id, sinceIso),
    getOrdersWithItemsSince(business.id, patternSinceIso),
    getMenuForBusiness(business.id),
    getSalesSeries(business.id, timezone),
    getSellerData(business.id),
  ]);
  const todayInBizTz = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const ordersTodayList = orders.filter((o) => toBizDateString(o.created_at, timezone) === todayInBizTz && o.status !== "cancelled");
  const callsToday = calls.filter((c) => toBizDateString(c.started_at, timezone) === todayInBizTz).length;
  const ordersToday = ordersTodayList.length;
  // Sales specifically only counts money actually collected — see
  // lib/orders/sales.ts for why this needs its own check beyond just
  // "not cancelled" (an order can be today's and not cancelled while
  // still waiting on an unpaid phone-payments link).
  // Prefer the database's own daily total (the Orders list above is capped
  // at the 100 most recent orders, which a busy day can exceed).
  const todayBucket = salesData?.series.day[salesData.series.day.length - 1];
  const salesTodayCents = todayBucket && todayBucket.local.startsWith(todayInBizTz)
    ? todayBucket.totalCents
    : ordersTodayList.filter(countsTowardSales).reduce((sum, o) => sum + o.total_cents, 0);
  const escalationsToday = calls.filter((c) => c.outcome === "escalated" && toBizDateString(c.started_at, timezone) === todayInBizTz).length;

  // Rolling trailing-week figures, not lifetime averages — a
  // lifetime average flattens out and stops moving once a business has
  // enough history; these stay responsive to how the last 7 days
  // actually went, which is what makes them useful for judging "is the
  // AI paying for itself" on an ongoing basis.
  const weekSalesOrders = weekOrders.filter(countsTowardSales);
  const weekRevenueCents = weekSalesOrders.reduce((sum, o) => sum + o.total_cents, 0);
  const projectedMonthlyIncomeCents = Math.round((weekRevenueCents / TRAILING_WINDOW_DAYS) * PROJECTED_MONTH_DAYS);

  const specialSuggestions = getSpecialSuggestions(patternOrders, menu.items, timezone, PATTERN_WINDOW_DAYS);

  return (
    <div>
      <h1 className="font-display text-[24px] font-semibold text-ink">Overview</h1>
      <p className="mt-1 text-[13.5px] text-text-muted">Here&apos;s what&apos;s happened on your phone line recently.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile href="/dashboard/customers" label="Calls today" value={String(callsToday)} icon={PhoneCall} />
        <StatTile href="/dashboard/orders" label="Orders today" value={String(ordersToday)} icon={ClipboardList} />
        <StatTile href="/dashboard/orders" label="Total sales today" value={`$${(salesTodayCents / 100).toFixed(2)}`} icon={DollarSign} />
        <StatTile
          href="/dashboard/escalations"
          label="Human escalations"
          value={String(escalationsToday)}
          icon={AlertTriangle}
          hint="Today — click to view"
          accentClass="hover:!border-danger/40 hover:!bg-danger-soft/40"
        />
      </div>

      <div className="mt-6">
        <SalesCard data={salesData} projectedMonthlyCents={projectedMonthlyIncomeCents} />
      </div>

      <div className="mt-6">
        <SpecialIdeas ideas={specialSuggestions} />
      </div>

      <div className="mt-6">
        <TopSellers data={sellerData} />
      </div>
    </div>
  );
}
