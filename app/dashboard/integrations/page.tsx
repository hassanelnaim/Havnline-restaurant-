import { getIntegrations } from "@/lib/data/integrations";
import { getBusiness } from "@/lib/data/business";
import { PageHeader } from "@/components/dashboard/page-header";
import { IntegrationsClient } from "@/components/dashboard/integrations-client";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const [integrations, business] = await Promise.all([getIntegrations(), getBusiness()]);
  return (
    // Extra bottom space so the live-chat bubble never sits on top of the
    // last card.
    <div className="pb-24">
      <PageHeader title="Integrations" description="Connect your phone number, payments, and kitchen tablet." />
      <IntegrationsClient
        initialIntegrations={integrations}
        stripeConnectAccountId={business.stripe_connect_account_id}
        stripeConnectChargesEnabled={business.stripe_connect_charges_enabled}
        platformFeeBps={business.platform_fee_bps}
        // Only whether the EIN is on file is sent to the browser, never the number.
        textingIdentity={{ legalBusinessName: business.legal_business_name, hasEin: Boolean(business.ein), soleProprietor: business.texting_entity_type === "sole_proprietor" }}
      />
    </div>
  );
}
