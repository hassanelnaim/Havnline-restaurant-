import { getBusiness } from "@/lib/data/business";
import { getOrdersForDate } from "@/lib/data/orders";
import { localDateKey } from "@/lib/format";
import { countsTowardSales } from "@/lib/orders/sales";
import { PageHeader } from "@/components/dashboard/page-header";
import { OrdersClient } from "@/components/dashboard/orders-client";

export const dynamic = "force-dynamic";

// Today's live order register, plus what used to be the separate End of
// Day page: a date picker and printable reconciliation report for any
// past day. One page instead of two, since they were really the same
// list of orders with a different date filter and a print button.
export default async function OrdersPage() {
  const business = await getBusiness();
  const today = localDateKey(new Date().toISOString(), business.timezone);
  const orders = await getOrdersForDate(business.id, today, business.timezone);
  const salesOrders = orders.filter(countsTowardSales);

  return (
    <div>
      <PageHeader
        title="Orders"
        description={
          business.printer_app_paired_at
            ? "Today's phone orders, and whether they made it to your kitchen printer. Pick an earlier date below to reconcile against your register or print a report. Refunds, discounts, and adding items are quickest from the paired tablet's Orders tab — this page still has a full-refund button if you'd rather do it from here."
            : "Today's phone orders. Pick an earlier date below to reconcile against your register or print a report. Pair the kitchen printer app in Integrations to send these straight to your kitchen printer — until then, you'll need to ring these in manually."
        }
      />
      <div className="mt-4">
        <OrdersClient
          businessName={business.name}
          timezone={business.timezone}
          maxDateKey={today}
          initialSummary={{
            dateKey: today,
            orderCount: salesOrders.length,
            cancelledCount: orders.filter((o) => o.status === "cancelled").length,
            grossCents: salesOrders.reduce((sum, o) => sum + o.total_cents, 0),
            netCents: salesOrders.reduce((sum, o) => sum + o.subtotal_cents, 0),
            taxCents: salesOrders.reduce((sum, o) => sum + o.tax_cents, 0),
          }}
          initialOrders={orders}
          printerAppConnected={Boolean(business.printer_app_paired_at)}
        />
      </div>
    </div>
  );
}
