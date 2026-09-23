import { getIntegrations } from "@/lib/data/integrations";
import { PageHeader } from "@/components/dashboard/page-header";
import { IntegrationsClient } from "@/components/dashboard/integrations-client";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const integrations = await getIntegrations();
  return (
    <div>
      <PageHeader title="Integrations" description="Connect SpotOn, your phone, and your AI's voice." />
      <IntegrationsClient initialIntegrations={integrations} />
    </div>
  );
}
