"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { groupSellersByCategory, SELLER_WINDOW_DAYS, type SellerData, type SellerWindowDays } from "@/lib/analytics/shared";

const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function TopSellers({ data }: { data: SellerData | null }) {
  const [days, setDays] = useState<SellerWindowDays>(30);
  const groups = useMemo(() => (data ? groupSellersByCategory(data[days]) : []), [data, days]);
  const selling = groups.filter((g) => g.totalUnits > 0);
  const notSelling = groups.filter((g) => g.notSelling.length > 0);
  const maxUnits = Math.max(1, ...selling.map((g) => g.totalUnits));

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-ink">Top sellers</h2>
          <p className="mt-0.5 text-[12px] text-text-faint">Units sold by category, last {days} days</p>
        </div>
        <div role="tablist" aria-label="Top sellers timeframe" className="inline-flex rounded-lg border border-border bg-paper p-0.5">
          {SELLER_WINDOW_DAYS.map((d) => (
            <button
              key={d}
              role="tab"
              aria-selected={d === days}
              onClick={() => setDays(d)}
              className={`rounded-md px-3 py-1 text-[12px] font-medium transition-colors ${d === days ? "bg-card text-ink shadow-sm" : "text-text-muted hover:text-ink"}`}
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
        <>
          {selling.length === 0 ? (
            <p className="text-[12.5px] text-text-faint">No paid orders in the last {days} days yet.</p>
          ) : (
            <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
              {selling.map((g) => (
                <div key={g.category}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[13px] font-semibold text-ink">{g.category}</span>
                    <span className="shrink-0 text-[12px] text-text-muted">{dollars(g.totalRevenueCents)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div
                      className="h-3 rounded-full bg-gradient-to-r from-brand-light to-brand"
                      style={{ width: `${Math.max(3, Math.round((g.totalUnits / maxUnits) * 82))}%` }}
                    />
                    <span className="shrink-0 text-[13px] font-semibold text-brand-dark">{g.totalUnits} sold</span>
                  </div>
                  <ol className="mt-2 space-y-0.5">
                    {g.top.map((item, i) => (
                      <li key={item.menuItemId} className="flex items-baseline gap-2 rounded-md px-1 py-1 text-[12.5px]">
                        <span className="w-4 shrink-0 text-right text-text-faint">{i + 1}.</span>
                        <span className="min-w-0 flex-1 truncate text-text">{item.name}</span>
                        <span className="shrink-0 tabular-nums text-text-muted">{item.units}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}

          {notSelling.length > 0 && (
            <div className="mt-6 border-t border-border pt-5">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-faint">Not selling in the last {days} days</h3>
              <div className="mt-2 divide-y divide-border-soft">
                {notSelling.map((g) => (
                  <details key={g.category} className="group py-1.5">
                    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-1 text-[13px] text-text hover:bg-paper [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint transition-transform group-open:rotate-90" />
                      <span className="flex-1 truncate">{g.category}</span>
                      <span className="shrink-0 text-[12px] text-text-faint">
                        {g.soldItemCount > 0 ? `${g.notSelling.length} of ${g.notSelling.length + g.soldItemCount} items` : `${g.notSelling.length} item${g.notSelling.length === 1 ? "" : "s"}`}
                      </span>
                    </summary>
                    <div className="flex flex-wrap gap-1.5 px-6 pb-1 pt-2">
                      {g.notSelling.map((i) => (
                        <span key={i.menuItemId} className="rounded-full border border-border bg-paper px-2.5 py-0.5 text-[12px] text-text-muted">{i.name}</span>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
