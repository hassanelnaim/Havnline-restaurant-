"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SalesBucket, SalesSeries, SalesUnit } from "@/lib/data/analytics";

const LABELS: Record<SalesUnit, string> = { hour: "Hourly", day: "Daily", week: "Weekly", month: "Monthly" };
const SUBTITLES: Record<SalesUnit, string> = {
  hour: "Last 24 hours",
  day: "Last 14 days",
  week: "Last 8 weeks",
  month: "Last 12 months",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const REFRESH_MS = 60_000;

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Short axis/tooltip label from the bucket's local start ("YYYY-MM-DDTHH:MM:SS"). */
function bucketLabel(unit: SalesUnit, local: string): string {
  const [date, time] = local.split("T");
  const [, m, d] = date.split("-").map(Number);
  const hour = parseInt(time.slice(0, 2), 10);
  if (unit === "hour") return `${hour % 12 === 0 ? 12 : hour % 12}${hour >= 12 ? "p" : "a"}`;
  if (unit === "month") return MONTHS[m - 1];
  return `${MONTHS[m - 1]} ${d}`;
}

function bucketTitle(unit: SalesUnit, b: SalesBucket): string {
  const [date, time] = b.local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const hour = parseInt(time.slice(0, 2), 10);
  const when =
    unit === "hour" ? `${MONTHS[m - 1]} ${d}, ${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour >= 12 ? "PM" : "AM"}`
    : unit === "month" ? `${MONTHS[m - 1]} ${y}`
    : unit === "week" ? `Week of ${MONTHS[m - 1]} ${d}`
    : `${MONTHS[m - 1]} ${d}, ${y}`;
  return `${when} — ${dollars(b.totalCents)} · ${b.orders} order${b.orders === 1 ? "" : "s"}`;
}

export function SalesCard({ series }: { series: SalesSeries | null }) {
  const router = useRouter();
  const [unit, setUnit] = useState<SalesUnit>("day");

  // Re-run the server query every minute (and when the tab comes back into
  // view) so the newest period fills in and the oldest one drops off
  // without anyone reloading the page.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") router.refresh(); };
    const id = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [router]);

  if (!series) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <h2 className="font-display text-[15px] font-semibold text-ink">Sales</h2>
        <p className="mt-2 text-[12.5px] text-text-faint">Sales charts aren&apos;t available right now. They&apos;ll appear once the latest database update has been applied.</p>
      </div>
    );
  }

  const buckets = series[unit];
  const total = buckets.reduce((s, b) => s + b.totalCents, 0);
  const orders = buckets.reduce((s, b) => s + b.orders, 0);
  const max = Math.max(1, ...buckets.map((b) => b.totalCents));
  const labelEvery = unit === "hour" ? 3 : unit === "day" ? 2 : 1;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-ink">Sales</h2>
          <p className="mt-0.5 text-[12px] text-text-faint">{SUBTITLES[unit]}</p>
        </div>
        <div role="tablist" aria-label="Sales timeframe" className="inline-flex rounded-lg border border-border bg-paper p-0.5">
          {(Object.keys(LABELS) as SalesUnit[]).map((u) => (
            <button
              key={u}
              role="tab"
              aria-selected={u === unit}
              onClick={() => setUnit(u)}
              className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${u === unit ? "bg-card text-ink shadow-sm" : "text-text-muted hover:text-ink"}`}
            >
              {LABELS[u]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-baseline gap-3">
        <div className="font-display text-[28px] font-semibold text-ink">{dollars(total)}</div>
        <div className="text-[12.5px] text-text-faint">{orders} paid order{orders === 1 ? "" : "s"}</div>
      </div>

      <div className="mt-4 flex h-40 items-end gap-1" aria-hidden={false}>
        {buckets.map((b, i) => (
          <div key={b.local} className="group flex h-full min-w-0 flex-1 flex-col justify-end" title={bucketTitle(unit, b)}>
            <div
              className={`w-full rounded-t ${i === buckets.length - 1 ? "bg-brand" : "bg-brand/60"} ${b.totalCents === 0 ? "min-h-[2px] opacity-30" : ""}`}
              style={{ height: `${Math.max(2, Math.round((b.totalCents / max) * 100))}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1">
        {buckets.map((b, i) => (
          <div key={b.local} className="min-w-0 flex-1 truncate text-center text-[10px] text-text-faint">
            {(buckets.length - 1 - i) % labelEvery === 0 ? bucketLabel(unit, b.local) : ""}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-text-faint">Only paid orders count. The newest period (darker bar) is still filling in.</p>
    </div>
  );
}
