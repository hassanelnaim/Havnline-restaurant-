import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderEmailLayout } from "@/lib/email/templates";
import { formatDateTime, formatDuration } from "@/lib/format";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://havnline.com";

// Same labels as components/dashboard/status-badges.tsx's CallOutcomeBadge,
// kept in sync by hand since that file is a client component (renders a
// <Badge>) and this one has to stay plain server-side HTML strings.
const OUTCOME_LABELS: Record<string, string> = {
  order_placed: "Order placed",
  question_answered: "Answered",
  escalated: "Escalated to you",
  no_action: "No action needed",
  missed: "Missed",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Emails every member of a business whenever a call finishes — gated by
 * businesses.notification_preferences.calls, same pattern as
 * sendEscalationEmail. Fires once per call, from the Twilio status
 * webhook right after the call is marked "completed" (see
 * app/api/webhooks/twilio/status/route.ts), so it always has the call's
 * final outcome and duration. This is separate from the escalation
 * email on purpose: escalation fires mid-call as an urgent "call me
 * back" alert, this is a general "here's what happened" log entry a
 * business can turn on independently — a business with both turned on
 * will get two emails for an escalated call, which is expected.
 */
export async function sendCallNotificationEmail(businessId: string, callId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: business } = await admin
    .from("businesses")
    .select("name, timezone, notification_preferences")
    .eq("id", businessId)
    .single();

  if (!business) return;
  const prefs = business.notification_preferences as { calls?: boolean; escalations?: boolean; digest?: boolean } | null;
  if (!prefs?.calls) return;

  if (!resend) {
    console.error("Call notification email skipped: RESEND_API_KEY is not set.");
    return;
  }

  const { data: call } = await admin
    .from("calls")
    .select("id, customer_name, phone, started_at, duration_seconds, outcome")
    .eq("id", callId)
    .maybeSingle();

  if (!call) return;

  const { data: members } = await admin.from("business_members").select("user_id").eq("business_id", businessId);
  const userIds = (members || []).map((m) => m.user_id);
  if (userIds.length === 0) return;

  const { data: users } = await admin.from("users").select("email").in("id", userIds);
  const recipients = (users || []).map((u) => u.email).filter(Boolean);
  if (recipients.length === 0) return;

  const callerName = call.customer_name || "Unknown caller";
  const outcomeLabel = OUTCOME_LABELS[call.outcome] || call.outcome;
  const timeLabel = formatDateTime(call.started_at, business.timezone);
  const durationLabel = formatDuration(Math.round((call.duration_seconds || 0) / 60));

  const html = renderEmailLayout({
    preheader: `${callerName} called ${business.name} — ${outcomeLabel.toLowerCase()}.`,
    heading: "You got a call",
    intro: `Your AI receptionist at <strong>${escapeHtml(business.name)}</strong> just finished a call.`,
    rows: [
      { label: "Caller", value: escapeHtml(callerName) },
      { label: "Phone", value: `<span style="font-family: 'IBM Plex Mono', Menlo, Consolas, monospace; font-size: 13px;">${escapeHtml(call.phone)}</span>` },
      { label: "Outcome", value: escapeHtml(outcomeLabel) },
      { label: "When", value: `${escapeHtml(timeLabel)} &middot; ${escapeHtml(durationLabel)}` },
    ],
    cta: { label: "View the transcript", url: `${APP_URL}/dashboard/calls/${call.id}` },
    footerNote: `You're getting this because call notifications are turned on for ${escapeHtml(business.name)} on HavnLine. <a href="${APP_URL}/dashboard/settings" style="color: #5B6472;">Manage notification settings</a>.`,
  });

  try {
    await resend.emails.send({
      from: "HavnLine Notifications <notifications@havnline.com>",
      to: recipients,
      subject: `${business.name}: ${callerName} called — ${outcomeLabel}`,
      html,
    });
  } catch (err) {
    console.error("Failed to send call notification email:", err);
  }
}
