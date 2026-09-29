"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { formatDate } from "@/lib/format";

interface BusinessRow {
  id: string;
  name: string;
  phone: string | null;
  subscription_status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-success-soft text-success",
  trialing: "bg-brand-soft text-brand-dark",
  past_due: "bg-amber-100 text-amber-700",
  canceled: "bg-danger-soft text-danger",
  none: "bg-border-soft text-text-muted",
};

export function BusinessListClient({ businesses }: { businesses: BusinessRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return businesses;
    return businesses.filter((b) => b.name.toLowerCase().includes(q) || (b.phone || "").toLowerCase().includes(q));
  }, [businesses, query]);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or phone…"
          className="h-9 w-full rounded-lg border border-border bg-paper pl-8 pr-3 text-[13px]"
        />
      </div>

      <div className="mt-4 overflow-x-auto">
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
            {filtered.map((b) => (
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
        {filtered.length === 0 && (
          <p className="py-8 text-center text-[13px] text-text-muted">{businesses.length === 0 ? "No businesses yet." : "No businesses match your search."}</p>
        )}
      </div>
    </div>
  );
}
