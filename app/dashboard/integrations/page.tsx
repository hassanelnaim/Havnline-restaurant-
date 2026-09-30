import { getIntegrations } from "@/lib/data/integrations";
import { getBusiness } from "@/lib/data/business";
import { PageHeader } from "@/components/dashboard/page-header";
import { IntegrationsClient } from "@/components/dashboard/integrations-client";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const [integrations, business] = await Promise.all([getIntegrations(), getBusiness()]);
  return (
    <div>
      <PageHeader title="Integrations" description="Connect your kitchen printer, phone, your AI's voice, and payments." />
      <IntegrationsClient
        initialIntegrations={integrations}
        stripeConnectAccountId={business.stripe_connect_account_id}
        stripeConnectChargesEnabled={business.stripe_connect_charges_enabled}
        platformFeeBps={business.platform_fee_bps}
      />
    </div>
  );
}