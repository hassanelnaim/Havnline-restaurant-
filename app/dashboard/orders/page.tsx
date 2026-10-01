import Link from "next/link";
import { getBusiness } from "@/lib/data/business";
import { getOrdersForDate } from "@/lib/data/orders";
import { localDateKey } from "@/lib/format";
import { PageHeader } from "@/components/dashboard/page-header";
import { OrdersClient } from "@/components/dashboard/orders-client";

export const dynamic = "force-dynamic";

// This page is today's live order register, not a full history — it
// resets to empty each new business day. For any past day, End of Day
// (which already has a date picker) is the place to look; this used to
// fetch the most recent 100 orders regardless of date, which is how a
// days-old order could still show up here (and in "today" counts, if
// it hadn't scrolled out of that window yet).
export default async function OrdersPage() {
  const business = await getBusiness();
  const today = localDateKey(new Date().toISOString(), business.timezone);
  const orders = await getOrdersForDate(business.id, today, business.timezone);

  return (
    <div>
      <PageHeader
        title="Orders"
        description={
          business.printer_app_paired_at
            ? "Today's phone orders, and whether they made it to your kitchen printer. Refunds, discounts, and adding items are quickest from the paired tablet's Orders tab — this page still has a full-refund button below if you'd rather do it from here."
            : "Today's phone orders. Pair the kitchen printer app in Integrations to send these straight to your kitchen printer — until then, you'll need to ring these in manually."
        }
      />
      <p className="mt-1 text-[12.5px] text-text-muted">
        Looking for a past day? <Link href="/dashboard/end-of-day" className="font-medium text-brand hover:underline">End of day</Link> has a date picker for any previous day.
      </p>
      <div className="mt-4">
        <OrdersClient initialOrders={orders} timezone={business.timezone} printerAppConnected={Boolean(business.printer_app_paired_at)} />
      </div>
    </div>
  );
}
