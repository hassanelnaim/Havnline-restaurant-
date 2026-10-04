import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { PhoneCall, ClipboardList, AlertTriangle, ArrowUpRight, DollarSign, Receipt, TrendingUp } from "lucide-react";
import { getBusiness } from "@/lib/data/business";
import { getCalls } from "@/lib/data/calls";
import { getOrdersForBusiness, getOrderTotalsSince, getOrdersWithItemsSince } from "@/lib/data/orders";
import { getMenuForBusiness } from "@/lib/data/menu";
import { countsTowardSales } from "@/lib/orders/sales";
import { getSpecialSuggestions } from "@/lib/analytics/specialSuggestions";
import { CostProfitCalculator, type CalculatorMenuItem } from "@/components/dashboard/cost-profit-calculator";

export const dynamic = "force-dynamic";

// Real business-local date string (YYYY-MM-DD), not the server's UTC
// date — the same pattern used in lib/ai/context.ts and systemPrompt.ts.
function toBizDateString(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

// Rolling, not calendar-aligned, so it visibly moves week to week
// instead of settling into one flat number — see the "This week" cards
// below.
const TRAILING_WINDOW_DAYS = 7;
const PROJECTED_MONTH_DAYS = 30;
// Wider window for the specials-suggestion engine and the cost
// calculator's "units/week" prefill — a week is too short to tell a
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

interface StaticStatTileProps {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
}

// "Projected monthly income" is a forward-looking estimate (this week's
// pace × 30), not a record of anything that already happened — unlike
// every other tile here, there's no page it actually corresponds to, so
// it stays a plain, non-clickable card instead of linking somewhere
// that isn't really "more detail on this number."
function StaticStatTile({ label, value, icon: Icon, hint }: StaticStatTileProps) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">{label}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand-dark"><Icon className="h-4 w-4" /></div>
      </div>
      <div className="mt-2 font-display text-[28px] font-semibold text-ink">{value}</div>
      {hint && <div className="mt-1 text-[11.5px] text-text-faint">{hint}</div>}
    </div>
  );
}

export default async function OverviewPage() {
  const business = await getBusiness();
  const sinceIso = new Date(Date.now() - TRAILING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const patternSinceIso = new Date(Date.now() - PATTERN_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [calls, orders, weekOrders, patternOrders, menu] = await Promise.all([
    getCalls(),
    getOrdersForBusiness(business.id),
    getOrderTotalsSince(business.id, sinceIso),
    getOrdersWithItemsSince(business.id, patternSinceIso),
    getMenuForBusiness(business.id),
  ]);

  const timezone = business.timezone || "America/New_York";
  const todayInBizTz = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const ordersTodayList = orders.filter((o) => toBizDateString(o.created_at, timezone) === todayInBizTz && o.status !== "cancelled");
  const callsToday = calls.filter((c) => toBizDateString(c.started_at, timezone) === todayInBizTz).length;
  const ordersToday = ordersTodayList.length;
  // Sales specifically only counts money actually collected — see
  // lib/orders/sales.ts for why this needs its own check beyond just
  // "not cancelled" (an order can be today's and not cancelled while
  // still waiting on an unpaid phone-payments link).
  const salesTodayCents = ordersTodayList.filter(countsTowardSales).reduce((sum, o) => sum + o.total_cents, 0);
  const escalationsToday = calls.filter((c) => c.outcome === "escalated" && toBizDateString(c.started_at, timezone) === todayInBizTz).length;

  // Rolling trailing-week figures, not lifetime averages — a
  // lifetime average flattens out and stops moving once a business has
  // enough history; these stay responsive to how the last 7 days
  // actually went, which is what makes them useful for judging "is the
  // AI paying for itself" on an ongoing basis.
  const weekSalesOrders = weekOrders.filter(countsTowardSales);
  const weekRevenueCents = weekSalesOrders.reduce((sum, o) => sum + o.total_cents, 0);
  const avgOrderValueCents = weekSalesOrders.length > 0 ? Math.round(weekRevenueCents / weekSalesOrders.length) : 0;
  const projectedMonthlyIncomeCents = Math.round((weekRevenueCents / TRAILING_WINDOW_DAYS) * PROJECTED_MONTH_DAYS);

  const specialSuggestions = getSpecialSuggestions(patternOrders, menu.items, timezone, PATTERN_WINDOW_DAYS);

  // Real recent sales volume per item, for the calculator's "units/week"
  // prefill — computed from the same pattern window rather than left at
  // zero, so the projection means something the moment the widget loads.
  const unitsSoldByMenuItemId = new Map<string, number>();
  for (const order of patternOrders) {
    if (!countsTowardSales(order)) continue;
    for (const item of order.items) {
      if (!item.menu_item_id) continue;
      unitsSoldByMenuItemId.set(item.menu_item_id, (unitsSoldByMenuItemId.get(item.menu_item_id) || 0) + item.quantity);
    }
  }
  const calculatorItems: CalculatorMenuItem[] = menu.items
    .filter((item) => item.is_active)
    .map((item) => ({
      id: item.id,
      name: item.name,
      priceCents: item.price_cents,
      avgWeeklyUnits: ((unitsSoldByMenuItemId.get(item.id) || 0) / PATTERN_WINDOW_DAYS) * 7,
    }));

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
        <h2 className="font-display text-[15px] font-semibold text-ink">This week</h2>
        <p className="mt-0.5 text-[12px] text-text-faint">Based on the last 7 days — moves as the week does, instead of settling into one number forever.</p>
        <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile href="/dashboard/orders" label="Average order value" value={`$${(avgOrderValueCents / 100).toFixed(2)}`} icon={Receipt} />
          <StaticStatTile
            label="Projected monthly income"
            value={`$${(projectedMonthlyIncomeCents / 100).toFixed(2)}`}
            icon={TrendingUp}
            hint="At this week's pace"
          />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[15px] font-semibold text-ink">Ideas for specials</h2>
            <Link href="/dashboard/menu" className="flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline">Edit menu <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
          <div className="space-y-1">
            {specialSuggestions.map((s) => (
              <Link key={s.title} href={s.href} className="block rounded-lg px-2 py-2.5 hover:bg-paper">
                <div className="text-[13px] font-medium text-text">{s.title}</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-text-faint">{s.detail}</div>
              </Link>
            ))}
          </div>
        </div>

        <CostProfitCalculator items={calculatorItems} />
      </div>
    </div>
  );
}
