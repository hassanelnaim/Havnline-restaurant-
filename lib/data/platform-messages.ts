import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";

export interface DashboardMessage {
  id: string;
  subject: string;
  body: string;
  sentAt: string;
}

/** Messages from HavnLine that nobody at the signed-in restaurant has marked read, newest first. */
export async function getUnreadPlatformMessages(): Promise<DashboardMessage[]> {
  if (!isSupabaseConfigured()) return [];
  const businessId = await getCurrentBusinessId();
  if (!businessId) return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_message_recipients")
    .select("message_id, created_at, platform_messages(subject, body, created_at)")
    .eq("business_id", businessId)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(5);
  // Before migration 049 the table doesn't exist: show nothing rather than break the dashboard.
  if (error) return [];
  return (data || []).flatMap((r) => {
    const m = r.platform_messages as unknown as { subject: string; body: string; created_at: string } | { subject: string; body: string; created_at: string }[] | null;
    const msg = Array.isArray(m) ? m[0] : m;
    return msg ? [{ id: r.message_id, subject: msg.subject, body: msg.body, sentAt: msg.created_at }] : [];
  });
}
