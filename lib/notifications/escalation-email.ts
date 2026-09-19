import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://havnline.com";

/**
 * Emails every member of a business when a call escalates to a human —
 * but only if that business has escalation notifications turned on
 * (businesses.notification_preferences.escalations). Silently does
 * nothing if Resend isn't configured yet (no RESEND_API_KEY), rather
 * than throwing and breaking the call itself over a missing email key.
 */
export async function sendEscalationEmail(businessId: string, callId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: business } = await admin
    .from("businesses")
    .select("name, notification_preferences")
    .eq("id", businessId)
    .single();

  if (!business) return;
  const prefs = business.notification_preferences as { calls?: boolean; escalations?: boolean; digest?: boolean } | null;
  if (!prefs?.escalations) return;

  if (!resend) {
    console.error("Escalation email skipped: RESEND_API_KEY is not set.");
    return;
  }

  const [{ data: call }, { data: members }] = await Promise.all([
    admin.from("calls").select("customer_name, phone, escalation_reason").eq("id", callId).maybeSingle(),
    admin.from("business_members").select("user_id").eq("business_id", businessId),
  ]);

  const userIds = (members || []).map((m) => m.user_id);
  if (userIds.length === 0) return;

  const { data: users } = await admin.from("users").select("email").in("id", userIds);
  const recipients = (users || []).map((u) => u.email).filter(Boolean);
  if (recipients.length === 0) return;

  const customerName = call?.customer_name || "A customer";
  const phone = call?.phone || "unknown number";
  const reason = call?.escalation_reason || "No reason was logged.";

  try {
    await resend.emails.send({
      from: "HavnLine Notifications <notifications@havnline.com>",
      to: recipients,
      subject: `${business.name}: a call needs your attention`,
      html: `
        <p><strong>${customerName}</strong> (${phone}) was escalated to you by your AI receptionist.</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p><a href="${APP_URL}/dashboard/escalations">View in your HavnLine dashboard →</a></p>
      `,
    });
  } catch (err) {
    console.error("Failed to send escalation email:", err);
  }
}
