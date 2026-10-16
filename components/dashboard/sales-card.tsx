"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { compactDollars, percentChange, type SalesBucket, type SalesData, type SalesUnit } from "@/lib/analytics/shared";

const LABELS: Record<SalesUnit, string> = { hour: "Hourly", day: "Daily", week: "Weekly", month: "Monthly" };
const SPANS: Record<SalesUnit, string> = {
  hour: "24 hours",
  day: "14 days",
  week: "8 weeks",
  month: "12 months",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const REFRESH_MS = 60_000;
// On a narrow screen 24 bars can't each fit a money label, so the chart
// scrolls sideways instead of squeezing the labels into each other.
const MIN_COLUMN_PX = 46;

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Short axis label from the bucket's local start ("YYYY-MM-DDTHH:MM:SS"). */
function bucketLabel(unit: SalesUnit, local: string): string {
  const [date, time] = local.split("T");
  const [, m, d] = date.split("-").map(Number);
  const hour = parseInt(time.slice(0, 2), 10);
  if (unit === "hour") return `${hour % 12 === 0 ? 12 : hour % 12}${hour >= 12 ? "p" : "a"}`;
  if (unit === "month") return MONTHS[m - 1];
  return `${MONTHS[m - 1]} ${d}`;
}

/** Full description for screen readers. */
function bucketDescription(unit: SalesUnit, b: SalesBucket): string {
  const [date, time] = b.local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const hour = parseInt(time.slice(0, 2), 10);
  const when =
    unit === "hour" ? `${MONTHS[m - 1]} ${d}, ${hour % 12 === 0 ? 12 : hour % 12} ${hour >= 12 ? "PM" : "AM"}`
    : unit === "month" ? `${MONTHS[m - 1]} ${y}`
    : unit === "week" ? `Week of ${MONTHS[m - 1]} ${d}`
    : `${MONTHS[m - 1]} ${d}, ${y}`;
  return `${when}: ${dollars(b.totalCents)}, ${b.orders} order${b.orders === 1 ? "" : "s"}`;
}

// The period still in progress is drawn striped, so it doesn't read as a
// bad day/week when it has only just started.
const IN_PROGRESS_STYLE = {
  backgroundImage:
    "repeating-linear-gradient(135deg, rgba(255,255,255,0.45) 0 6px, rgba(255,255,255,0) 6px 12px), linear-gradient(to top, #60A5FA, #2563EB)",
};

export function SalesCard({ data, projectedMonthlyCents }: { data: SalesData | null; projectedMonthlyCents: number }) {
  const router = useRouter();
  const [unit, setUnit] = useState<SalesUnit>("day");
  const [selected, setSelected] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // On a phone the chart scrolls sideways; start at the newest periods.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [unit, data]);

  // Re-run the server query every minute (and when the tab comes back into
  // view) so the newest period fills in and the oldest one drops off
  // without anyone reloading the page.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") router.refresh(); };
    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [router]);

  if (!data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <h2 className="font-display text-[15px] font-semibold text-ink">Sales</h2>
        <p className="mt-2 text-[12.5px] text-text-faint">Sales charts aren&apos;t available right now. They&apos;ll appear once the latest database update has been applied.</p>
      </div>
    );
  }

  const buckets = data.series[unit];
  const total = buckets.reduce((s, b) => s + b.totalCents, 0);
  const orders = buckets.reduce((s, b) => s + b.orders, 0);
  const avgOrderCents = orders > 0 ? Math.round(total / orders) : 0;
  const previous = data.previous[unit];
  const change = percentChange(total, previous.totalCents);
  const max = Math.max(1, ...buckets.map((b) => b.totalCents));
  const labelEvery = unit === "hour" ? 3 : 1;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-ink">Sales</h2>
          <p className="mt-0.5 text-[12px] text-text-faint">Last {SPANS[unit]}</p>
        </div>
        <div role="tablist" aria-label="Sales timeframe" className="inline-flex rounded-lg border border-border bg-paper p-0.5">
          {(Object.keys(LABELS) as SalesUnit[]).map((u) => (
            <button
              key={u}
              role="tab"
              aria-selected={u === unit}
              onClick={() => { setUnit(u); setSelected(null); }}
              className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${u === unit ? "bg-card text-ink shadow-sm" : "text-text-muted hover:text-ink"}`}
            >
              {LABELS[u]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="font-display text-[32px] font-semibold leading-none text-ink">{dollars(total)}</div>
        <div className="text-[13px] text-text-muted">{orders} paid order{orders === 1 ? "" : "s"}</div>
      </div>

      {/* Figures strip */}
      <div className="mt-4 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
        <div className="bg-paper px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">vs previous {SPANS[unit]}</div>
          {change === null ? (
            <div className="mt-1 text-[14px] font-medium text-text-muted">{previous.totalCents === 0 ? "No sales before this" : "—"}</div>
          ) : (
            <div className={`mt-1 flex items-center gap-1 text-[15px] font-semibold ${change > 0 ? "text-success" : change < 0 ? "text-danger" : "text-text-muted"}`}>
              {change > 0 ? <ArrowUpRight className="h-4 w-4" /> : change < 0 ? <ArrowDownRight className="h-4 w-4" /> : null}
              {change > 0 ? "+" : ""}{change}%
              <span className="ml-1 text-[12px] font-normal text-text-faint">(was {dollars(previous.totalCents)})</span>
            </div>
          )}
        </div>
        <div className="bg-paper px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">Average order</div>
          <div className="mt-1 text-[15px] font-semibold text-ink">{dollars(avgOrderCents)}</div>
        </div>
        <div className="bg-paper px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">On pace for</div>
          <div className="mt-1 text-[15px] font-semibold text-ink">
            {dollars(projectedMonthlyCents)}<span className="ml-1 text-[12px] font-normal text-text-faint">a month, at the last 7 days&apos; pace</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div ref={scrollRef} className="mt-5 overflow-x-auto pb-1">
        <div style={{ minWidth: buckets.length * MIN_COLUMN_PX }}>
          <div className="flex h-52 items-end gap-1.5 border-b border-border pt-7" role="list" aria-label={`Sales per ${unit}`}>
            {buckets.map((b, i) => {
              const inProgress = i === buckets.length - 1;
              const pct = b.totalCents === 0 ? 0 : Math.max(4, Math.round((b.totalCents / max) * 100));
              const isSelected = selected === b.local;
              return (
                <button
                  type="button"
                  key={b.local}
                  role="listitem"
                  aria-label={bucketDescription(unit, b)}
                  onClick={() => setSelected(isSelected ? null : b.local)}
                  className="relative flex h-full min-w-0 flex-1 flex-col justify-end focus:outline-none"
                >
                  <div
                    className={`relative w-full rounded-t-md transition-all ${b.totalCents === 0 ? "bg-transparent" : inProgress ? "" : "bg-gradient-to-t from-brand-light to-brand"} ${isSelected ? "ring-2 ring-brand-dark ring-offset-1" : ""}`}
                    style={{ height: `${pct}%`, ...(inProgress && b.totalCents > 0 ? IN_PROGRESS_STYLE : {}) }}
                  >
                    <span
                      className={`absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold ${b.totalCents === 0 ? "text-text-faint/70" : "text-brand-dark"}`}
                    >
                      {compactDollars(b.totalCents)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex gap-1.5">
            {buckets.map((b, i) => {
              const inProgress = i === buckets.length - 1;
              const show = (buckets.length - 1 - i) % labelEvery === 0;
              return (
                <div key={b.local} className="min-w-0 flex-1 text-center">
                  <div className={`truncate text-[10.5px] ${selected === b.local ? "font-semibold text-ink" : "text-text-faint"}`}>{show ? bucketLabel(unit, b.local) : ""}</div>
                  {inProgress && <div className="text-[9.5px] font-medium uppercase tracking-wide text-brand">so far</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selected && (() => {
        const b = buckets.find((x) => x.local === selected);
        return b ? <p className="mt-3 text-[12.5px] text-text-muted">{bucketDescription(unit, b)}</p> : null;
      })()}
      <p className="mt-3 text-[11px] text-text-faint">Only paid orders count. The striped bar is the current period and is still filling in.</p>
    </div>
  );
}
