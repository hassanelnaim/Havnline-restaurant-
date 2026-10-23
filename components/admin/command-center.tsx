import Link from "next/link";
import { Activity, ArrowRight, CheckCircle2, AlertTriangle, PhoneCall, Radio, Star, Clock } from "lucide-react";
import { BarChart, PairedBarChart, type Bar, type PairedBar } from "@/components/admin/charts";
import { SERIES } from "@/lib/admin/chartColors";
import type { CallActivity } from "@/lib/admin/overview";
import type { HealthCounts } from "@/lib/admin/health";
import type { PlatformRevenueMetrics } from "@/lib/billing/platform-metrics";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;
const hourRange = (h: number) => `${hourLabel(h)}–${hourLabel((h + 1) % 24)}`;
const dayLabel = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};
const dollars = (cents: number, digits = 0) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export function Card({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-border bg-card p-5 shadow-card ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12px] text-text-faint">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Figure({ label, value, hint, icon: Icon }: { label: string; value: string; hint?: string; icon?: typeof PhoneCall }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className="mt-1 font-display text-[24px] font-semibold leading-none text-ink">{value}</div>
      {hint && <div className="mt-1 truncate text-[11.5px] text-text-faint">{hint}</div>}
    </div>
  );
}

// ------------------------------------------------------------ health strip

export function HealthStrip({ counts, pendingReviews }: { counts: HealthCounts | null; pendingReviews: number }) {
  const parts: string[] = [];
  if (counts) {
    if (counts.stuckItems) parts.push(`${counts.stuckItems} stuck item${counts.stuckItems === 1 ? "" : "s"}`);
    if (counts.jobsFailing) parts.push(`${counts.jobsFailing} background job${counts.jobsFailing === 1 ? "" : "s"} not running right`);
    if (counts.setupFailing) parts.push(`${counts.setupFailing} setup check${counts.setupFailing === 1 ? "" : "s"} failing`);
  }
  const bad = parts.length > 0;
  return (
    <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
      <Link
        href="/admin/health"
        className={`group flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors ${bad ? "border-danger/25 bg-danger-soft hover:border-danger/50" : "border-success/25 bg-success-soft hover:border-success/50"}`}
      >
        {bad ? <AlertTriangle className="h-5 w-5 shrink-0 text-danger" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />}
        <div className="min-w-0 flex-1">
          <div className={`text-[13.5px] font-semibold ${bad ? "text-danger" : "text-success"}`}>{counts === null ? "Health couldn't be checked" : bad ? "Needs attention" : "All systems normal"}</div>
          <div className="text-[12.5px] text-text-muted">
            {counts === null
              ? "Open Health for details."
              : bad
              ? parts.join(" · ")
              : `Background jobs on schedule, nothing stuck${counts.alerts24h ? `, ${counts.alerts24h} alert${counts.alerts24h === 1 ? "" : "s"} in the last 24 hours` : ", no alerts in the last 24 hours"}.`}
          </div>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5" />
      </Link>
      {pendingReviews > 0 && (
        <Link href="/admin/reviews" className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-[13px] font-medium text-text shadow-card hover:border-brand/40">
          <Star className="h-4 w-4 text-amber-500" />
          {pendingReviews} review{pendingReviews === 1 ? "" : "s"} to moderate
        </Link>
      )}
    </div>
  );
}

// ------------------------------------------------------------ calls today

export function CallsTodayCard({ activity, peakAtLabel, currentHour, timezone }: { activity: CallActivity; peakAtLabel: string | null; currentHour: number; timezone: string }) {
  if (!activity.available) {
    return (
      <Card title="Calls today" className="lg:col-span-2">
        <p className="text-[13px] text-text-muted">Run migration 038 to see call charts here.</p>
      </Card>
    );
  }
  const total = activity.hourly.reduce((n, h) => n + h.calls, 0);
  const busiest = activity.hourly.reduce((best, h) => (h.calls > best.calls ? h : best), { hour: -1, calls: 0 });
  const bars: Bar[] = activity.hourly.map((h) => ({
    key: String(h.hour),
    label: h.hour % 3 === 0 ? hourLabel(h.hour) : "",
    value: h.calls,
    inProgress: h.hour === currentHour,
    emphasis: h.hour === busiest.hour && busiest.calls > 0,
    tooltip: [hourRange(h.hour), `${h.calls} call${h.calls === 1 ? "" : "s"}${h.hour === currentHour ? " so far" : ""}`],
  }));
  return (
    <Card title="Calls today" subtitle={`Across every restaurant · ${timezone.replace("_", " ")} time`} className="lg:col-span-2">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label="Calls" value={total.toLocaleString()} icon={PhoneCall} />
        <Figure label="Peak at once" value={String(activity.peak)} hint={peakAtLabel ? `at ${peakAtLabel}` : "No calls yet"} icon={Activity} />
        <Figure label="On the line now" value={String(activity.liveNow)} icon={Radio} />
        <Figure label="Busiest hour" value={busiest.calls ? hourRange(busiest.hour) : "—"} hint={busiest.calls ? `${busiest.calls} calls` : undefined} icon={Clock} />
      </div>
      <div className="mt-5">
        <BarChart bars={bars} ariaLabel={`Calls per hour today, ${total} in total`} />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ money

export function MoneyCard({ revenue, spentThisMonth }: { revenue: PlatformRevenueMetrics; spentThisMonth: number }) {
  const spentCents = Math.round(spentThisMonth * 100);
  const inCents = revenue.configured ? revenue.revenueThisMonthCents : 0;
  const max = Math.max(1, inCents, spentCents);
  const net = inCents - spentCents;
  const rows = [
    { label: "Collected", cents: inCents, color: SERIES.calls, note: "Subscriptions paid through Stripe" },
    { label: "Spent", cents: spentCents, color: "#94A3B8", note: "AI, voice and phone usage" },
  ];
  return (
    <Card title="Money this month">
      {revenue.configured ? (
        <Figure label="MRR" value={dollars(revenue.mrrCents)} hint={`${revenue.activeSubscriptionCount} active subscription${revenue.activeSubscriptionCount === 1 ? "" : "s"}`} />
      ) : (
        <p className="text-[13px] text-text-faint">Stripe isn&apos;t configured, so there&apos;s no revenue to show.</p>
      )}
      <div className="mt-5 space-y-3">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex items-baseline justify-between text-[12.5px]">
              <span className="font-medium text-text">{r.label}</span>
              <span className="font-mono font-medium text-text">{dollars(r.cents, 2)}</span>
            </div>
            <div className="mt-1 h-2.5 rounded-full bg-border-soft">
              <div className="h-full rounded-full" style={{ width: `${r.cents ? Math.max(2, (r.cents / max) * 100) : 0}%`, background: r.color }} />
            </div>
            <div className="mt-0.5 text-[11px] text-text-faint">{r.note}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-baseline justify-between border-t border-border-soft pt-3">
        <span className="text-[12.5px] text-text-muted">Net so far</span>
        <span className={`font-mono text-[15px] font-semibold ${net >= 0 ? "text-success" : "text-danger"}`}>{net < 0 ? "−" : ""}{dollars(Math.abs(net), 2)}</span>
      </div>
      {revenue.error && <p className="mt-3 text-[12px] text-danger">Couldn&apos;t reach Stripe: {revenue.error}</p>}
    </Card>
  );
}

// ------------------------------------------------------------ last 14 days

export function TwoWeeksCard({ activity, today }: { activity: CallActivity; today: string }) {
  if (!activity.available) return null;
  const bars: PairedBar[] = activity.daily.map((d, i) => ({
    key: d.day,
    label: i % 2 === activity.daily.length % 2 ? "" : dayLabel(d.day),
    a: d.calls,
    b: d.orders,
    inProgress: d.day === today,
    tooltip: [dayLabel(d.day) + (d.day === today ? " (today)" : ""), `${d.calls} calls`, `${d.orders} orders · ${dollars(d.salesCents, 2)}`],
  }));
  const calls = activity.daily.reduce((n, d) => n + d.calls, 0);
  const orders = activity.daily.reduce((n, d) => n + d.orders, 0);
  const sales = activity.daily.reduce((n, d) => n + d.salesCents, 0);
  return (
    <Card title="Last 14 days" subtitle={`${calls.toLocaleString()} calls · ${orders.toLocaleString()} paid orders · ${dollars(sales)} in restaurant sales`} className="lg:col-span-2">
      <PairedBarChart bars={bars} names={["Calls", "Orders"]} ariaLabel={`Calls and orders per day for the last 14 days: ${calls} calls, ${orders} orders`} />
    </Card>
  );
}

// ------------------------------------------------------------ businesses

const STATUS_ORDER: { key: string; label: string; color: string }[] = [
  { key: "active", label: "Active", color: "#16A34A" },
  { key: "trialing", label: "Trialing", color: "#2563EB" },
  { key: "past_due", label: "Past due", color: "#D97706" },
  { key: "canceled", label: "Canceled", color: "#DC2626" },
  { key: "none", label: "No plan", color: "#CBD5E1" },
];

export function BusinessesCard({ businesses, now }: { businesses: { subscription_status: string; created_at: string }[]; now: number }) {
  const counts = STATUS_ORDER.map((s) => ({
    ...s,
    count: businesses.filter((b) => (STATUS_ORDER.some((x) => x.key === b.subscription_status) ? b.subscription_status : "none") === s.key).length,
  })).filter((s) => s.count > 0);
  const total = businesses.length;

  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const weeks: Bar[] = Array.from({ length: 8 }, (_, i) => {
    const end = now - (7 - i) * WEEK;
    const start = end - WEEK;
    const n = businesses.filter((b) => {
      const t = Date.parse(b.created_at);
      return t > start && t <= end;
    }).length;
    const startDate = new Date(start + 1);
    return {
      key: String(i),
      label: i === 7 ? "This wk" : i === 0 ? "8 wks ago" : "",
      value: n,
      inProgress: false,
      tooltip: [i === 7 ? "Last 7 days" : `Week of ${MONTHS[startDate.getMonth()]} ${startDate.getDate()}`, `${n} sign-up${n === 1 ? "" : "s"}`],
    };
  });
  const newThisWeek = weeks[7].value;

  return (
    <Card title="Businesses" action={<Link href="/admin/businesses" className="text-[12.5px] font-medium text-brand hover:underline">View all</Link>}>
      <Figure label="On HavnLine" value={total.toLocaleString()} hint={`${newThisWeek} new in the last 7 days`} />
      {total > 0 && (
        <>
          <div className="mt-4 flex h-3 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={counts.map((c) => `${c.count} ${c.label}`).join(", ")}>
            {counts.map((c) => (
              <div key={c.key} style={{ width: `${(c.count / total) * 100}%`, background: c.color }} title={`${c.label}: ${c.count}`} />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {counts.map((c) => (
              <span key={c.key} className="flex items-center gap-1.5 text-[12px] text-text-muted">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
                {c.label} <span className="font-medium text-text">{c.count}</span>
              </span>
            ))}
          </div>
        </>
      )}
      <div className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">Sign-ups per week</div>
      <div className="mt-2">
        <BarChart bars={weeks} height={56} ariaLabel="Sign-ups per week for the last 8 weeks" />
      </div>
    </Card>
  );
}
