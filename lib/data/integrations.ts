import { isSupabaseConfigured } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { mockIntegrations } from "@/lib/mock/data";
import type { DbIntegration, IntegrationProvider } from "@/lib/database/types";

const ALL_PROVIDERS: IntegrationProvider[] = ["twilio", "sms", "printer_app"];

const COMING_SOON: IntegrationProvider[] = [];

/**
 * These rows go straight to the browser (the Integrations page is a client
 * component), and the Twilio row's metadata also holds the business's
 * sub-account SID and auth token. Only the fields the page shows are passed
 * on; the credentials stay on the server.
 */
function publicMetadata(row: DbIntegration): Record<string, unknown> | null {
  const meta = row.metadata as Record<string, unknown> | null;
  if (!meta) return null;
  if (row.provider === "twilio") return typeof meta.phone_number === "string" ? { phone_number: meta.phone_number } : null;
  return null;
}

export async function getIntegrations(): Promise<DbIntegration[]> {
  if (!isSupabaseConfigured()) return mockIntegrations.filter((i) => ALL_PROVIDERS.includes(i.provider));
  const businessId = await getCurrentBusinessId();
  if (!businessId) return mockIntegrations.filter((i) => ALL_PROVIDERS.includes(i.provider));

  // Read on the server only: the integrations table (it holds each
  // business's Twilio credentials) is hidden from signed-in users since
  // migration 032. Scoped to the signed-in business above.
  const admin = createAdminClient();
  const { data } = await admin.from("integrations").select("*").eq("business_id", businessId);
  const existing = data || [];

  // printer_app doesn't live in the generic `integrations` table — its
  // real state (device_token, printer_ip) lives in printer_devices,
  // since the tablet app authenticates with its own device token
  // rather than as this business's logged-in owner. Built here as a
  // synthetic row so the rest of the dashboard can treat it like any
  // other integration.
  const { data: device } = await admin.from("printer_devices").select("paired_at, printer_ip, last_seen_at").eq("business_id", businessId).maybeSingle();

  return ALL_PROVIDERS.map((provider) => {
    if (provider === "printer_app") {
      return {
        id: `printer_app_${businessId}`,
        business_id: businessId,
        provider,
        status: device ? "connected" : "not_connected",
        external_account_id: null,
        connected_at: device?.paired_at || null,
        metadata: device ? { printer_ip: device.printer_ip, last_seen_at: device.last_seen_at } : null,
      } as DbIntegration;
    }
    const found = existing.find((i) => i.provider === provider);
    if (found) return { ...found, metadata: publicMetadata(found) } as DbIntegration;
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
