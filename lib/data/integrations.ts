import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { mockIntegrations } from "@/lib/mock/data";
import type { DbIntegration, IntegrationProvider } from "@/lib/database/types";

const ALL_PROVIDERS: IntegrationProvider[] = ["spoton", "twilio", "sms", "voice_provider"];

const COMING_SOON: IntegrationProvider[] = [];

export async function getIntegrations(): Promise<DbIntegration[]> {
  if (!isSupabaseConfigured()) return mockIntegrations.filter((i) => ALL_PROVIDERS.includes(i.provider));
  const businessId = await getCurrentBusinessId();
  if (!businessId) return mockIntegrations.filter((i) => ALL_PROVIDERS.includes(i.provider));

  const supabase = createClient();
  const { data } = await supabase.from("integrations").select("*").eq("business_id", businessId);
  const existing = data || [];

  return ALL_PROVIDERS.map((provider) => {
    const found = existing.find((i) => i.provider === provider);
    if (found) return found;
    return {
      id: `stub_${provider}`,
      business_id: businessId,
      provider,
      status: COMING_SOON.includes(provider) ? "coming_soon" : "not_connected",
      external_account_id: null,
      connected_at: null,
      metadata: null,
    } as DbIntegration;
  });
}
