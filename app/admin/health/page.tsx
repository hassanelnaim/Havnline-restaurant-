import { requirePlatformAdmin } from "@/lib/supabase/platform-admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { getHealthReport } from "@/lib/admin/health";
import { ADMIN_TIMEZONE } from "@/lib/admin/overview";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { HealthView } from "@/components/admin/health-view";

export const dynamic = "force-dynamic";
// "Run now" on the weekly digest can take up to 45 seconds.
export const maxDuration = 60;

export default async function AdminHealthPage() {
  await requirePlatformAdmin();

  if (!isSupabaseConfigured()) {
    return (
      <div>
        <h1 className="font-display text-[24px] font-semibold text-ink">Health</h1>
        <p className="mt-2 text-[13.5px] text-text-muted">Connect Supabase to see background jobs, stuck items, alerts and setup checks.</p>
      </div>
    );
  }

  const report = await getHealthReport();
  const now = Date.now();

  return (
    <div>
      <AutoRefresh />
      <HealthView report={report} now={now} timeZone={ADMIN_TIMEZONE} />
    </div>
  );
}
