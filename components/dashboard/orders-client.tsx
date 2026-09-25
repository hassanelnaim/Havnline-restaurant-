"use client";
import { useState, useTransition } from "react";
import { RefreshCw, XCircle, ClipboardList, Printer } from "lucide-react";
import type { OrderWithItems } from "@/lib/database/types";
import { retrySubmitOrderAction, cancelOrderAction } from "@/app/actions/orders";
import { OrderStatusBadge } from "@/components/dashboard/status-badges";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { formatDateTime } from "@/lib/format";

export function OrdersClient({ initialOrders, timezone, spotonConnected }: { initialOrders: OrderWithItems[]; timezone: string; spotonConnected: boolean }) {
  const [orders, setOrders] = useState(initialOrders);
  const [, startTransition] = useTransition();
  const [retryingId, setRetryingId] = useState<string | null>(null);

  function retry(orderId: string) {
    setRetryingId(orderId);
    startTransition(async () => {
      const result = await retrySubmitOrderAction(orderId);
      setRetryingId(null);
      if (result.success) {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: "submitted", submit_error: null } : o)));
      } else {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, submit_error: result.error || "Retry failed." } : o)));
      }
    });
  }

  function cancel(orderId: string) {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: "cancelled" } : o)));
    startTransition(async () => { await cancelOrderAction(orderId); });
  }

  if (orders.length === 0) {
    return <EmptyState icon={ClipboardList} title="No orders yet" description="Orders your AI takes on phone calls will show up here." />;
  }

  return (
    <div className="space-y-3">
      {orders.map((order) => (
        <Card key={order.id}>
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-paper text-text-faint"><Printer className="h-4 w-4" /></div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-ink">{order.customer_name || "Phone order"}</span>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  <div className="mt-0.5 text-[12px] text-text-muted">{order.phone} · {formatDateTime(order.created_at, timezone)}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[15px] font-semibold text-ink">${(order.total_cents / 100).toFixed(2)}</div>
                {order.tax_cents > 0 && <div className="text-[11px] text-text-faint">incl. ${(order.tax_cents / 100).toFixed(2)} tax</div>}
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-dashed border-border bg-paper p-4 font-mono text-[12.5px] leading-relaxed text-text">
              <div className="divide-y divide-dashed divide-border">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
                    <div>
                      <span className="font-medium">{item.quantity}× {item.item_name}</span>
                      {item.modifiers.length > 0 && <span className="text-text-muted"> — {item.modifiers.map((m) => m.modifier_name).join(", ")}</span>}
                      {item.notes && <div className="text-[11px] text-text-faint">Note: {item.notes}</div>}
                    </div>
                    <span className="text-text-muted">${((item.unit_price_cents + item.modifiers.reduce((s, m) => s + m.price_delta_cents, 0)) * item.quantity / 100).toFixed(2)}</span>
                  </div>
                ))}
              </div>

              {order.special_instructions && (
                <>
                  <div className="my-2 border-t border-dashed border-border" />
                  <div className="text-text-muted">Note: {order.special_instructions}</div>
                </>
              )}
            </div>

            {order.submit_error && (
              <div className="mt-3 rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">
                Didn't reach the kitchen printer: {order.submit_error}. Ring this order in manually, or retry below.
              </div>
            )}

            <div className="mt-3 flex items-center gap-2">
              {order.status !== "submitted" && order.status !== "cancelled" && spotonConnected && (
                <Button size="sm" variant="outline" onClick={() => retry(order.id)} disabled={retryingId === order.id}>
                  <RefreshCw className="h-3.5 w-3.5" /> {retryingId === order.id ? "Sending…" : order.submit_error ? "Retry send" : "Send to kitchen"}
                </Button>
              )}
              {order.status !== "cancelled" && (
                <Button size="sm" variant="ghost" onClick={() => cancel(order.id)}>
                  <XCircle className="h-3.5 w-3.5" /> Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
