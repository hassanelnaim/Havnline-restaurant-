import { requirePlatformAdmin } from "@/lib/supabase/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { AUDIENCE_STATUSES, BODY_MAX, SUBJECT_MAX, listSentMessages } from "@/lib/admin/messages";
import { MessageComposer, type ComposerRestaurant } from "@/components/admin/message-composer";
import { SentMessages } from "@/components/admin/sent-messages";

export const dynamic = "force-dynamic";

export default async function AdminMessagesPage(props: { searchParams: Promise<{ to?: string }> }) {
  await requirePlatformAdmin();
  const { to } = await props.searchParams;
  const configured = isSupabaseConfigured();

  let restaurants: ComposerRestaurant[] = [];
  let sent: Awaited<ReturnType<typeof listSentMessages>> = [];
  let tablesMissing = false;
  if (configured) {
    const admin = createAdminClient();
    const { data } = await admin.from("businesses").select("id, name, subscription_status, is_suspended").order("name");
    restaurants = (data || []).map((b) => ({ id: b.id, name: b.name || "Restaurant", status: b.subscription_status || "none", isSuspended: Boolean(b.is_suspended) }));
    const { error } = await admin.from("platform_messages").select("id", { head: true, count: "exact" });
    tablesMissing = Boolean(error);
    if (!tablesMissing) sent = await listSentMessages();
  }
  const initialSelected = to && restaurants.some((r) => r.id === to) ? [to] : [];

  return (
    <div>
      <h1 className="font-display text-[24px] font-semibold text-ink">Messages</h1>
      <p className="mt-1 text-[13.5px] text-text-muted">Send a service update to every restaurant, a group, or just one.</p>
      {tablesMissing ? (
        <div className="mt-6 rounded-2xl border border-border bg-paper p-5 text-[13px] text-ink">
          Run migration 049 (lib/database/migrations/049_platform_messages.sql) in the Supabase SQL editor to turn on messages.
        </div>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <MessageComposer restaurants={restaurants} statuses={AUDIENCE_STATUSES} subjectMax={SUBJECT_MAX} bodyMax={BODY_MAX} initialSelected={initialSelected} />
          <SentMessages messages={sent} />
        </div>
      )}
    </div>
  );
}
