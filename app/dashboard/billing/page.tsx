import { getBusiness } from "@/lib/data/business";
import { getBillingOverview } from "@/lib/data/billing";
import { PageHeader } from "@/components/dashboard/page-header";
import { BillingClient } from "@/components/dashboard/billing-client";

export const dynamic = "force-dynamic";

export default async function BillingPage(props: { searchParams?: Promise<{ success?: string; canceled?: string }> }) {
  const searchParams = await props.searchParams;
  const business = await getBusiness();
  const overview = await getBillingOverview(business);
  return (
    <div className="pb-24">
      <PageHeader title="Billing" description="Your plan, payment method, and invoices." />
      <BillingClient
        status={business.subscription_status}
        timezone={business.timezone}
        feeBps={business.platform_fee_bps}
        fallbackPeriodEnd={business.current_period_end}
        cancelAtPeriodEnd={business.cancel_at_period_end}
        overview={overview}
        justSubscribed={searchParams?.success === "1"}
      />
    </div>
  );
}
