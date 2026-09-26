import { getIntegrations } from "@/lib/data/integrations";
import { PageHeader } from "@/components/dashboard/page-header";
import { IntegrationsClient } from "@/components/dashboard/integrations-client";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: { spoton_error?: string };
}) {
  const integrations = await getIntegrations();
  const spoton_error = searchParams.spoton_error;
  return (
    <div>
      <PageHeader title="Integrations" description="Connect SpotOn, your phone, and your AI's voice." />
      <IntegrationsClient initialIntegrations={integrations} spotonError={spoton_error === "not_configured"} />
    </div>
  );
}