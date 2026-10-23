import { requirePlatformAdmin } from "@/lib/supabase/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { mockAdminBusinesses } from "@/lib/mock/data";
import { BusinessListClient } from "@/components/admin/business-list-client";
import { AutoRefresh } from "@/components/admin/auto-refresh";

export const dynamic = "force-dynamic";

export default async function AdminBusinessesPage() {
  await requirePlatformAdmin();
  const demoMode = !isSupabaseConfigured();

  const businesses = demoMode
    ? mockAdminBusinesses
    : (async () => {
        const admin = createAdminClient();
        const { data } = await admin
          .from("businesses")
          .select("id, name, phone, subscription_status, cancel_at_period_end, current_period_end, created_at")
          .order("created_at", { ascending: false });
        return data || [];
      })();

  const rows = await businesses;

  return (
    <div>
      <AutoRefresh />
      <div>
        <h1 className="font-display text-[24px] font-semibold text-ink">All businesses</h1>
        <p className="mt-1 text-[13.5px] text-text-muted">{rows.length} on HavnLine.</p>
      </div>

      <div className="mt-6">
        <BusinessListClient businesses={rows} />
      </div>
    </div>
  );
}
