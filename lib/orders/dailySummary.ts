import { countsTowardSales } from "@/lib/orders/sales";

// Shared by every printer-app route that needs "this day's numbers"
// (today-orders' header stats, the dashboard tab's day cards, and the
// calendar's single-day lookup) so there's exactly one definition of
// what counts as a sale, cancelled, etc. — not a slightly-different
// reduce() copied into each route.
export interface DailySummary {
  dateKey: string;
  orderCount: number;
  cancelledCount: number;
  grossCents: number;
  netCents: number;
  taxCents: number;
  refundedCents: number;
  /** Cash at pickup (migration 052): sales paid or to be paid in cash, and how much is still to collect. */
  cashCents: number;
  cashOutstandingCents: number;
  cardCents: number;
  noShowCount: number;
}

interface SummarizableOrder {
  status: string;
  payment_status: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_refunded_cents: number | null;
  payment_method?: string | null;
  cash_collected_at?: string | null;
  no_show_at?: string | null;
}

export function buildDailySummary(dateKey: string, orders: SummarizableOrder[]): DailySummary {
  const salesOrders = orders.filter(countsTowardSales);
  return {
    dateKey,
    orderCount: salesOrders.length,
    cancelledCount: orders.filter((o) => o.status === "cancelled").length,
    grossCents: salesOrders.reduce((sum, o) => sum + o.total_cents, 0),
    netCents: salesOrders.reduce((sum, o) => sum + o.subtotal_cents, 0),
    taxCents: salesOrders.reduce((sum, o) => sum + o.tax_cents, 0),
    refundedCents: orders.reduce((sum, o) => sum + (o.amount_refunded_cents || 0), 0),
    // Cash is what's in the drawer: after any cash given back. A partly
    // refunded cash order still counts here (it isn't in salesOrders).
    cashCents: orders
      .filter((o) => o.payment_method === "cash" && o.status !== "building" && o.status !== "cancelled" && ["not_required", "paid", "partially_refunded"].includes(o.payment_status))
      .reduce((sum, o) => sum + o.total_cents - (o.amount_refunded_cents || 0), 0),
    cashOutstandingCents: salesOrders.filter((o) => o.payment_method === "cash" && !o.cash_collected_at).reduce((sum, o) => sum + o.total_cents, 0),
    cardCents: salesOrders.filter((o) => o.payment_method !== "cash").reduce((sum, o) => sum + o.total_cents, 0),
    noShowCount: orders.filter((o) => Boolean(o.no_show_at)).length,
  };
}
