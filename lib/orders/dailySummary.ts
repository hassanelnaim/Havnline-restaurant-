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
}

interface SummarizableOrder {
  status: string;
  payment_status: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_refunded_cents: number | null;
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
  };
}
