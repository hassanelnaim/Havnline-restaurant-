"use client";

import { useMemo, useState } from "react";
import { groupSellersByCategory, SELLER_WINDOW_DAYS, type SellerData, type SellerWindowDays } from "@/lib/analytics/shared";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function TopSellers({ data }: { data: SellerData | null }) {
  const [days, setDays] = useState<SellerWindowDays>(30);
  const groups = useMemo(() => (data ? groupSellersByCategory(data[days]) : []), [data, days]);
  const anySales = groups.some((g) => g.top.length > 0);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold text-ink">Top sellers</h2>
        <div role="tablist" aria-label="Top sellers timeframe" className="inline-flex rounded-lg border border-border bg-paper p-0.5">
          {SELLER_WINDOW_DAYS.map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={d === days}
              onClick={() => setDays(d)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${d === days ? "bg-card text-ink shadow-sm" : "text-text-muted hover:text-ink"}`}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <p className="text-[12.5px] text-text-faint">Top sellers aren&apos;t available right now. They&apos;ll appear once the latest database update has been applied.</p>
      ) : groups.length === 0 ? (
        <p className="text-[12.5px] text-text-faint">Add menu items and take a few orders to see what sells.</p>
      ) : (
        <div className="max-h-[420px] space-y-4 overflow-y-auto pr-1">
          {!anySales && <p className="text-[12.5px] text-text-faint">No paid orders in the last {days} days yet.</p>}
          {groups.map((g) => (
            <div key={g.category}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">{g.category}</div>
              {g.top.length > 0 && (
                <ol className="mt-1 space-y-0.5">
                  {g.top.map((item, i) => (
                    <li key={item.menuItemId} className="flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-paper">
                      <span className="min-w-0 truncate text-text"><span className="mr-1.5 text-text-faint">{i + 1}.</span>{item.name}</span>
                      <span className="shrink-0 text-[12px] text-text-muted">{item.units} sold · {dollars(item.revenueCents)}</span>
                    </li>
                  ))}
                </ol>
              )}
              {g.notSelling.length > 0 && (
                <p className="mt-1 px-2 text-[12px] leading-relaxed text-text-faint">
                  <span className="font-medium text-text-muted">Not selling:</span> {g.notSelling.map((i) => i.name).join(", ")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
