import { getBusiness } from "@/lib/data/business";
import { getOrdersForBusiness } from "@/lib/data/orders";
import { PageHeader } from "@/components/dashboard/page-header";
import { OrdersClient } from "@/components/dashboard/orders-client";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const business = await getBusiness();
  const orders = await getOrdersForBusiness(business.id);

  return (
    <div>
      <PageHeader
        title="Orders"
        description={
          business.printer_app_paired_at
            ? "Every order your AI takes, and whether it made it to your kitchen printer."
            : "Every order your AI takes. Pair the kitchen printer app in Integrations to send these straight to your kitchen printer — until then, you'll need to ring these in manually."
        }
      />
      <OrdersClient initialOrders={orders} timezone={business.timezone} printerAppConnected={Boolean(business.printer_app_paired_at)} />
    </div>
  );
}
