"use client";
import { useState, useTransition } from "react";
import { Receipt, Printer, ClipboardList } from "lucide-react";
import type { OrderWithItems } from "@/lib/database/types";
import type { EndOfDaySummary } from "@/app/actions/reports";
import { getEndOfDaySummaryAction } from "@/app/actions/reports";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/dashboard/status-badges";
import { EmptyState } from "@/components/dashboard/empty-state";
import { formatDateTime, formatDateWithWeekday, formatCents } from "@/lib/format";

export function EndOfDayClient({
  businessName,
  timezone,
  maxDateKey,
  initialSummary,
  initialOrders,
}: {
  businessName: string;
  timezone: string;
  maxDateKey: string;
  initialSummary: EndOfDaySummary;
  initialOrders: OrderWithItems[];
}) {
  const [dateKey, setDateKey] = useState(initialSummary.dateKey);
  const [summary, setSummary] = useState(initialSummary);
  const [orders, setOrders] = useState(initialOrders);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function loadDate(nextDateKey: string) {
    setDateKey(nextDateKey);
    setError(null);
    startTransition(async () => {
      const result = await getEndOfDaySummaryAction(nextDateKey);
      if (!result.success || !result.summary) {
        setError(result.error || "Could not load that day.");
        return;
      }
      setSummary(result.summary);
      setOrders(result.orders || []);
    });
  }

  return (
    <div className="space-y-6">
      {/* Screen-only header row with the date picker and print button — none of this
          is useful once it's on paper, so it never shows up in the printed report. */}
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <div className="max-w-[220px]">
          <Label htmlFor="eod-date">Report date</Label>
          <Input
            id="eod-date"
            type="date"
            className="mt-1.5"
            max={maxDateKey}
            value={dateKey}
            onChange={(e) => e.target.value && loadDate(e.target.value)}
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()} disabled={isPending}>
          <Printer className="h-3.5 w-3.5" /> Print report
        </Button>
      </div>

      {error && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger print:hidden">{error}</div>}

      {/* Print-only heading — the screen already has the dashboard's own
          header, but a printed page needs to say what it is and which
          business/day it's for on its own. */}
      <div className="hidden print:block">
        <h1 className="text-[18px] font-semibold text-ink">{businessName} — End of day</h1>
        <p className="text-[13px] text-text-muted">{formatDateWithWeekday(summary.dateKey)}</p>
      </div>

      <Card className={isPending ? "opacity-60" : undefined}>
        <CardContent className="flex flex-wrap items-center gap-6 p-5">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-text-faint">
            <Receipt className="h-3.5 w-3.5" /> {formatDateWithWeekday(summary.dateKey)}
          </div>
          <div><div className="text-[11px] text-text-faint">Orders</div><div className="font-mono text-[15px] font-semibold text-ink">{summary.orderCount}</div></div>
          <div><div className="text-[11px] text-text-faint">Cancelled</div><div className="font-mono text-[15px] font-semibold text-ink">{summary.cancelledCount}</div></div>
          <div><div className="text-[11px] text-text-faint">Gross sales</div><div className="font-mono text-[15px] font-semibold text-ink">{formatCents(summary.grossCents)}</div></div>
          <div><div className="text-[11px] text-text-faint">Net sales</div><div className="font-mono text-[15px] font-semibold text-ink">{formatCents(summary.netCents)}</div></div>
          <div><div className="text-[11px] text-text-faint">Tax collected</div><div className="font-mono text-[15px] font-semibold text-ink">{formatCents(summary.taxCents)}</div></div>
        </CardContent>
      </Card>

      {orders.length === 0 ? (
        <div className="print:hidden">
          <EmptyState icon={ClipboardList} title="No orders that day" description="Pick a different date to see its orders." />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border-soft text-left text-[11px] uppercase tracking-wide text-text-faint">
                  <th className="px-4 py-2.5 font-medium">Time</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 font-medium">Items</th>
                  <th className="px-4 py-2.5 font-medium text-right">Total</th>
                  <th className="px-4 py-2.5 font-medium print:hidden">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-text-muted">{formatDateTime(order.created_at, timezone)}</td>
                    <td className="px-4 py-2.5 text-ink">{order.customer_name || "Phone order"}<span className="ml-1.5 text-text-faint">{order.phone}</span></td>
                    <td className="px-4 py-2.5 text-text-muted">{order.items.reduce((n, i) => n + i.quantity, 0)} item{order.items.reduce((n, i) => n + i.quantity, 0) === 1 ? "" : "s"}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-ink">{formatCents(order.total_cents)}</td>
                    <td className="px-4 py-2.5 print:hidden"><OrderStatusBadge status={order.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
