import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderEmailLayout } from "@/lib/email/templates";
import { LEGAL_NAME, MAILING_ADDRESS, SUPPORT_EMAIL } from "@/lib/legal/company";

/**
 * Messages from HavnLine to restaurants (Admin > Messages). Each one is
 * emailed to everyone on the restaurant's account, with replies going to
 * the support inbox, and shown on the restaurant's dashboard until someone
 * there marks it read. Service updates only: no promotions, so no
 * unsubscribe link, but every email names the sender and the address.
 */

export const SUBJECT_MAX = 150;
export const BODY_MAX = 5000;
/** Resend's batch endpoint takes at most 100 emails per call. */
const BATCH_SIZE = 100;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://havnline.com";
const FROM = "HavnLine <notifications@havnline.com>";

export type MessageAudience =
  | { kind: "all" }
  | { kind: "status"; statuses: string[] }
  | { kind: "selected"; businessIds: string[] };

export interface AudienceRestaurant {
  id: string;
  name: string;
}

/** Subscription states a message can be aimed at. "suspended" is the admin suspension, not a Stripe state. */
export const AUDIENCE_STATUSES: { value: string; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "trialing", label: "On trial" },
  { value: "past_due", label: "Past due" },
  { value: "canceled", label: "Canceled" },
  { value: "none", label: "Not subscribed yet" },
  { value: "suspended", label: "Suspended" },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The restaurants a message goes to, worked out on the server whatever the page sent. */
export async function resolveAudience(audience: MessageAudience): Promise<AudienceRestaurant[]> {
  const admin = createAdminClient();
  if (audience.kind === "selected") {
    const ids = [...new Set(audience.businessIds)].filter((id) => UUID.test(id));
    if (ids.length === 0) return [];
    const { data } = await admin.from("businesses").select("id, name").in("id", ids);
    return (data || []).map((b) => ({ id: b.id, name: b.name || "Restaurant" }));
  }
  const { data } = await admin.from("businesses").select("id, name, subscription_status, is_suspended").order("name");
  const rows = data || [];
  if (audience.kind === "all") return rows.map((b) => ({ id: b.id, name: b.name || "Restaurant" }));
  const wanted = new Set(audience.statuses);
  return rows
    .filter((b) => (wanted.has("suspended") && b.is_suspended) || wanted.has(b.subscription_status || "none"))
    .map((b) => ({ id: b.id, name: b.name || "Restaurant" }));
}

export function describeAudience(audience: MessageAudience, count: number): string {
  if (audience.kind === "all") return "All restaurants";
  if (audience.kind === "status") {
    const labels = AUDIENCE_STATUSES.filter((s) => audience.statuses.includes(s.value)).map((s) => s.label);
    return labels.join(", ") || "No group";
  }
  return count === 1 ? "1 restaurant" : `${count} restaurants`;
}

/** Everyone on each restaurant's account, by restaurant. */
async function emailsByRestaurant(businessIds: string[]): Promise<Map<string, string[]>> {
  const admin = createAdminClient();
  const out = new Map<string, string[]>();
  for (let i = 0; i < businessIds.length; i += 500) {
    const chunk = businessIds.slice(i, i + 500);
    const { data: members } = await admin.from("business_members").select("business_id, user_id").in("business_id", chunk);
    const userIds = [...new Set((members || []).map((m) => m.user_id))];
    const emailOf = new Map<string, string>();
    for (let j = 0; j < userIds.length; j += 500) {
      const { data: users } = await admin.from("users").select("id, email").in("id", userIds.slice(j, j + 500));
      for (const u of users || []) if (u.email) emailOf.set(u.id, u.email);
    }
    for (const m of members || []) {
      const email = emailOf.get(m.user_id);
      if (!email) continue;
      const list = out.get(m.business_id) || [];
      if (!list.includes(email)) list.push(email);
      out.set(m.business_id, list);
    }
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text as typed: blank lines start a paragraph, single line breaks stay. */
function bodyHtml(body: string): string {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((p) => escapeHtml(p).replace(/\n/g, "<br>"))
    .join('</p><p style="margin: 12px 0 0;">');
}

function renderMessageEmail(subject: string, body: string, restaurantName: string): { html: string; text: string } {
  const footer = `You're receiving this service update from HavnLine because ${escapeHtml(restaurantName)} has a HavnLine account. Reply to this email to reach HavnLine support. ${LEGAL_NAME}, ${MAILING_ADDRESS}.`;
  const html = renderEmailLayout({
    preheader: body.trim().slice(0, 120),
    heading: subject,
    intro: bodyHtml(body),
    cta: { label: "Open HavnLine", url: `${APP_URL}/dashboard` },
    footerNote: footer,
  });
  const text = `${subject}\n\n${body.trim()}\n\nOpen HavnLine: ${APP_URL}/dashboard\n\nYou're receiving this service update from HavnLine because ${restaurantName} has a HavnLine account. Reply to this email to reach HavnLine support (${SUPPORT_EMAIL}). ${LEGAL_NAME}, ${MAILING_ADDRESS}.`;
  return { html, text };
}

function resendClient(): Resend | null {
  return process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
}

/** One email to the admin, exactly as restaurants will get it. Nothing is saved. */
export async function sendTestMessage(to: string, subject: string, body: string): Promise<{ success: boolean; error?: string }> {
  const resend = resendClient();
  if (!resend) return { success: false, error: "Email isn't set up (RESEND_API_KEY is missing)." };
  const { html, text } = renderMessageEmail(subject, body, "Your restaurant");
  const { error } = await resend.emails.send({ from: FROM, to: [to], replyTo: SUPPORT_EMAIL, subject: `[Test] ${subject}`, html, text });
  if (error) return { success: false, error: `The test email didn't send: ${error.message}` };
  return { success: true };
}

export interface SendSummary {
  messageId: string;
  restaurants: number;
  emailed: number;
  failed: number;
  noEmail: number;
  alreadySent?: boolean;
}

/**
 * Saves the message and one recipient row per restaurant, then emails them
 * in batches. The send key is unique, so a second click (or a retried
 * request) finds the first send and doesn't send again.
 */
export async function sendPlatformMessage(input: {
  sendKey: string;
  subject: string;
  body: string;
  audience: MessageAudience;
  restaurants: AudienceRestaurant[];
  sentBy: string | null;
}): Promise<{ success: true; summary: SendSummary } | { success: false; error: string }> {
  const admin = createAdminClient();
  const audienceText = describeAudience(input.audience, input.restaurants.length);

  const { data: created, error: insertError } = await admin
    .from("platform_messages")
    .insert({ send_key: input.sendKey, subject: input.subject, body: input.body, audience: audienceText, sent_by: input.sentBy })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      const { data: existing } = await admin.from("platform_messages").select("id").eq("send_key", input.sendKey).maybeSingle();
      if (existing) {
        const { count } = await admin.from("platform_message_recipients").select("business_id", { count: "exact", head: true }).eq("message_id", existing.id);
        return { success: true, summary: { messageId: existing.id, restaurants: count || 0, emailed: 0, failed: 0, noEmail: 0, alreadySent: true } };
      }
    }
    console.error("[messages] could not save the message:", insertError.message);
    return { success: false, error: "The message couldn't be saved, so nothing was sent. Try again." };
  }
  const messageId = created.id as string;

  for (let i = 0; i < input.restaurants.length; i += 500) {
    const rows = input.restaurants.slice(i, i + 500).map((r) => ({ message_id: messageId, business_id: r.id }));
    const { error } = await admin.from("platform_message_recipients").insert(rows);
    if (error) {
      console.error("[messages] could not save recipients:", error.message);
      await admin.from("platform_messages").delete().eq("id", messageId);
      return { success: false, error: "The recipient list couldn't be saved, so nothing was sent. Try again." };
    }
  }

  const emails = await emailsByRestaurant(input.restaurants.map((r) => r.id));
  const resend = resendClient();
  const summary: SendSummary = { messageId, restaurants: input.restaurants.length, emailed: 0, failed: 0, noEmail: 0 };

  const withEmail = input.restaurants.filter((r) => (emails.get(r.id) || []).length > 0);
  const withoutEmail = input.restaurants.filter((r) => !(emails.get(r.id) || []).length);
  if (withoutEmail.length) {
    summary.noEmail = withoutEmail.length;
    await admin.from("platform_message_recipients").update({ email_status: "no_email" }).eq("message_id", messageId).in("business_id", withoutEmail.map((r) => r.id));
  }

  for (let i = 0; i < withEmail.length; i += BATCH_SIZE) {
    const chunk = withEmail.slice(i, i + BATCH_SIZE);
    const ids = chunk.map((r) => r.id);
    let errorText: string | null = null;
    if (!resend) {
      errorText = "RESEND_API_KEY is not set";
    } else {
      try {
        const { error } = await resend.batch.send(
          chunk.map((r) => {
            const { html, text } = renderMessageEmail(input.subject, input.body, r.name);
            return { from: FROM, to: emails.get(r.id)!, replyTo: SUPPORT_EMAIL, subject: input.subject, html, text };
          })
        );
        if (error) errorText = error.message;
      } catch (err) {
        errorText = err instanceof Error ? err.message : String(err);
      }
    }
    if (errorText) {
      summary.failed += chunk.length;
      console.error(`[messages] batch of ${chunk.length} emails failed:`, errorText);
      await admin.from("platform_message_recipients").update({ email_status: "failed", email_error: errorText.slice(0, 300) }).eq("message_id", messageId).in("business_id", ids);
    } else {
      summary.emailed += chunk.length;
      await admin.from("platform_message_recipients").update({ email_status: "sent", emailed_at: new Date().toISOString() }).eq("message_id", messageId).in("business_id", ids);
    }
  }
  return { success: true, summary };
}

export interface SentMessageRow {
  id: string;
  subject: string;
  body: string;
  audience: string;
  createdAt: string;
  restaurants: number;
  emailed: number;
  failed: number;
  noEmail: number;
  read: number;
  recipients: { businessId: string; name: string; emailStatus: string; emailError: string | null; readAt: string | null }[];
}

/** The latest messages for the admin history list. */
export async function listSentMessages(limit = 30): Promise<SentMessageRow[]> {
  const admin = createAdminClient();
  const { data: messages } = await admin.from("platform_messages").select("id, subject, body, audience, created_at").order("created_at", { ascending: false }).limit(limit);
  if (!messages?.length) return [];
  const { data: recips } = await admin
    .from("platform_message_recipients")
    .select("message_id, business_id, email_status, email_error, read_at, businesses(name)")
    .in("message_id", messages.map((m) => m.id))
    .limit(5000);
  return messages.map((m) => {
    const mine = (recips || []).filter((r) => r.message_id === m.id);
    const nameOf = (r: (typeof mine)[number]) => {
      const b = r.businesses as unknown as { name?: string } | { name?: string }[] | null;
      return (Array.isArray(b) ? b[0]?.name : b?.name) || "Restaurant";
    };
    return {
      id: m.id,
      subject: m.subject,
      body: m.body,
      audience: m.audience,
      createdAt: m.created_at,
      restaurants: mine.length,
      emailed: mine.filter((r) => r.email_status === "sent").length,
      failed: mine.filter((r) => r.email_status === "failed").length,
      noEmail: mine.filter((r) => r.email_status === "no_email").length,
      read: mine.filter((r) => r.read_at).length,
      recipients: mine
        .map((r) => ({ businessId: r.business_id, name: nameOf(r), emailStatus: r.email_status, emailError: r.email_error, readAt: r.read_at }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}
