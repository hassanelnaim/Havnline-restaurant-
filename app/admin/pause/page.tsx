import { requirePlatformAdmin } from "@/lib/supabase/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { AUDIENCE_STATUSES, BODY_MAX, SUBJECT_MAX } from "@/lib/admin/messages";
import { listPauses, type PauseListRow } from "@/lib/admin/pauses";
import { PauseComposer } from "@/components/admin/pause-composer";
import { PauseList } from "@/components/admin/pause-list";
import type { ComposerRestaurant } from "@/components/admin/audience-picker";

export const dynamic = "force-dynamic";

export default async function AdminPausePage(props: { searchParams: Promise<{ to?: string }> }) {
  await requirePlatformAdmin();
  const { to } = await props.searchParams;
  const configured = isSupabaseConfigured();

  let restaurants: ComposerRestaurant[] = [];
  let pauses: PauseListRow[] = [];
  let missing: string | null = null;
  if (configured) {
    const admin = createAdminClient();
    const { data } = await admin.from("businesses").select("id, name, subscription_status, is_suspended").order("name");
    restaurants = (data || []).map((b) => ({ id: b.id, name: b.name || "Restaurant", status: b.subscription_status || "none", isSuspended: Boolean(b.is_suspended) }));
    const [m049, m050] = await Promise.all([
      admin.from("platform_messages").select("id", { head: true, count: "exact" }),
      admin.from("ai_pauses").select("id", { head: true, count: "exact" }),
    ]);
    if (m049.error) missing = "049 (lib/database/migrations/049_platform_messages.sql)";
    else if (m050.error) missing = "050 (lib/database/migrations/050_ai_pause.sql)";
    else pauses = await listPauses();
  }
  const initialSelected = to && restaurants.some((r) => r.id === to) ? [to] : [];

  return (
    <div>
      <h1 className="font-display text-[24px] font-semibold text-ink">Pause AI</h1>
      <p className="mt-1 text-[13.5px] text-text-muted">Take the AI order-taker off the phones for an update. Calls ring the restaurant instead, and it comes back on by itself.</p>
      {missing ? (
        <div className="mt-6 rounded-2xl border border-border bg-paper p-5 text-[13px] text-ink">Run migration {missing} in the Supabase SQL editor to turn on pausing.</div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <PauseComposer restaurants={restaurants} statuses={AUDIENCE_STATUSES} subjectMax={SUBJECT_MAX} bodyMax={BODY_MAX} initialSelected={initialSelected} />
          <PauseList pauses={pauses} />
        </div>
      )}
    </div>
  );
}
