import { getBusiness } from "@/lib/data/business";
import { getOrdersForDate } from "@/lib/data/orders";
import { localDateKey } from "@/lib/format";
import { PageHeader } from "@/components/dashboard/page-header";
import { EndOfDayClient } from "@/components/dashboard/end-of-day-client";

export const dynamic = "force-dynamic";

// Orders that never actually happened shouldn't count toward the
// day's sales totals — same rule used everywhere else this math
// happens (orders-client.tsx, app/actions/reports.ts).
const COUNTS_TOWARD_SALES = new Set(["confirmed", "submitted"]);

export default async function EndOfDayPage() {
  const business = await getBusiness();
  const today = localDateKey(new Date().toISOString(), business.timezone);

  const orders = await getOrdersForDate(business.id, today, business.timezone);
  const salesOrders = orders.filter((o) => COUNTS_TOWARD_SALES.has(o.status));

  return (
    <div>
      <PageHeader title="End of day" description="Reconcile a day's phone orders against your register — pick any past day, or print tonight's." />
      <div className="mt-6">
        <EndOfDayClient
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
        />
      </div>
    </div>
  );
}
