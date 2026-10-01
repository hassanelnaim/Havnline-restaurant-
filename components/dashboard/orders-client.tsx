"use client";
import { useMemo, useState, useTransition } from "react";
import { RefreshCw, XCircle, ClipboardList, Printer, Receipt, Undo2 } from "lucide-react";
import type { OrderWithItems } from "@/lib/database/types";
import { retrySubmitOrderAction } from "@/app/actions/orders";
import { voidOrderAction, refundOrderAction } from "@/app/actions/payments";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/dashboard/status-badges";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/dashboard/empty-state";
import { formatDateTime, formatCents, localDateKey } from "@/lib/format";
import { countsTowardSales } from "@/lib/orders/sales";

export function OrdersClient({ initialOrders, timezone, printerAppConnected }: { initialOrders: OrderWithItems[]; timezone: string; printerAppConnected: boolean }) {
  const [orders, setOrders] = useState(initialOrders);
  const [, startTransition] = useTransition();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [refundOrderId, setRefundOrderId] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refunding, setRefunding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // The Orders page now only ever fetches today's orders (see
  // app/dashboard/orders/page.tsx), so this filter is mostly a
  // no-op/safety net rather than doing real work — kept as-is so this
  // summary stays correct even if that changes later.
  const todaysSummary = useMemo(() => {
    const today = localDateKey(new Date().toISOString(), timezone);
    const todays = orders.filter((o) => countsTowardSales(o) && localDateKey(o.created_at, timezone) === today);
    return {
      orderCount: todays.length,
      grossCents: todays.reduce((sum, o) => sum + o.total_cents, 0),
      netCents: todays.reduce((sum, o) => sum + o.subtotal_cents, 0),
      taxCents: todays.reduce((sum, o) => sum + o.tax_cents, 0),
    };
  }, [orders, timezone]);

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

  function voidOrder(orderId: string) {
    setVoidingId(orderId);
    setActionError(null);
    startTransition(async () => {
      const result = await voidOrderAction(orderId);
      setVoidingId(null);
      if (!result.success) { setActionError(result.error || "Could not void this order."); return; }
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: "cancelled" } : o)));
    });
  }

  function submitRefund() {
    if (!refundOrderId) return;
    setRefunding(true);
    setActionError(null);
    startTransition(async () => {
      const result = await refundOrderAction(refundOrderId, undefined, refundReason);
      setRefunding(false);
      if (!result.success) { setActionError(result.error || "Could not process the refund."); return; }
      setOrders((prev) => prev.map((o) => (o.id === refundOrderId ? { ...o, payment_status: "refunded", amount_refunded_cents: o.total_cents } : o)));
      setRefundOrderId(null);
      setRefundReason("");
    });
  }

  if (orders.length === 0) {
    return <EmptyState icon={ClipboardList} title="No orders yet" description="Orders your AI takes on phone calls will show up here." />;
  }

  const refundTarget = orders.find((o) => o.id === refundOrderId) || null;

  return (
    <div className="space-y-6">
      {actionError && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{actionError}</div>}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-5">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-text-faint"><Receipt className="h-3.5 w-3.5" /> Today</div>
          <div><div className="text-[11px] text-text-faint">Orders</div><div className="font-mono text-[15px] font-semibold text-ink">{todaysSummary.orderCount}</div></div>
          <div><div className="text-[11px] text-text-faint">Gross sales</div><div className="font-mono text-[15px] font-semibold text-ink">{formatCents(todaysSummary.grossCents)}</div></div>
          <div><div className="text-[11px] text-text-faint">Net sales</div><div className="font-mono text-[15px] font-semibold text-ink">{formatCents(todaysSummary.netCents)}</div></div>
          <div><div className="text-[11px] text-text-faint">Tax collected</div><div className="font-mono text-[15px] font-semibold text-ink">{formatCents(todaysSummary.taxCents)}</div></div>
        </CardContent>
      </Card>

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
                    {order.payment_status !== "not_required" && <PaymentStatusBadge status={order.payment_status} />}
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
              {order.status !== "submitted" && order.status !== "cancelled" && printerAppConnected && (
                <Button size="sm" variant="brand" onClick={() => retry(order.id)} disabled={retryingId === order.id}>
                  <RefreshCw className="h-3.5 w-3.5" /> {retryingId === order.id ? "Sending…" : order.submit_error ? "Retry send" : "Send to kitchen"}
                </Button>
              )}
              {order.status !== "cancelled" && order.payment_status !== "paid" && order.payment_status !== "refunded" && order.payment_status !== "partially_refunded" && (
                <Button size="sm" variant="ghost" onClick={() => voidOrder(order.id)} disabled={voidingId === order.id}>
                  <XCircle className="h-3.5 w-3.5" /> {voidingId === order.id ? "Voiding…" : "Void"}
                </Button>
              )}
              {order.payment_status === "paid" && (
                <Button size="sm" variant="ghost" onClick={() => setRefundOrderId(order.id)}>
                  <Undo2 className="h-3.5 w-3.5" /> Refund
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      </div>

      <Dialog open={refundOrderId !== null} onOpenChange={(open) => { if (!open) { setRefundOrderId(null); setRefundReason(""); } }}>
        <DialogContent>
          <DialogTitle>Refund order</DialogTitle>
          <DialogDescription>
            {refundTarget ? `This refunds the full ${formatCents(refundTarget.total_cents)} back to the customer's card through Stripe — this actually moves money, not just a status change.` : ""}
          </DialogDescription>
          {printerAppConnected && (
            <p className="mt-2 text-[12px] text-text-muted">
              Need a partial refund or a discount instead? Those — and adding items, comped or charged by QR — are quicker from the paired kitchen tablet's Orders tab. This button only ever issues a full refund.
            </p>
          )}
          <div className="mt-4">
            <label className="text-[12px] font-semibold text-text-muted">Reason (kept on file for this order)</label>
            <Textarea className="mt-1.5" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="e.g. kitchen made it wrong, customer no-showed, duplicate order" rows={3} />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setRefundOrderId(null); setRefundReason(""); }}>Cancel</Button>
            <Button size="sm" variant="brand" onClick={submitRefund} disabled={refunding}>{refunding ? "Refunding…" : "Refund"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
