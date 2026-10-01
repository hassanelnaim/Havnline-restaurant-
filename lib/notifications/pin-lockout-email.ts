import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderEmailLayout } from "@/lib/email/templates";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://havnline.com";

/**
 * Emails every member of a business when the tablet's money-PIN
 * verification has been rate-limited (too many attempts in a short
 * window — see app/api/printer-app/verify-pin/route.ts). This fires
 * on being LOCKED OUT, not on every wrong guess, and the caller itself
 * dedupes repeated calls (its own checkRateLimit key) so a sustained
 * brute-force attempt sends roughly one email per window rather than
 * one per rejected request.
 *
 * Unlike sendEscalationEmail, this isn't gated behind a notification
 * preference — a possible attempt to brute-force the PIN that moves
 * money is security-relevant regardless of what the owner has opted
 * into for day-to-day call/escalation alerts.
 */
export async function sendMoneyPinLockoutEmail(businessId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();
  if (!business) return;

  if (!resend) {
    console.error("Money-PIN lockout email skipped: RESEND_API_KEY is not set.");
    return;
  }

  const { data: members } = await admin.from("business_members").select("user_id").eq("business_id", businessId);
  const userIds = (members || []).map((m) => m.user_id);
  if (userIds.length === 0) return;

  const { data: users } = await admin.from("users").select("email").in("id", userIds);
  const recipients = (users || []).map((u) => u.email).filter(Boolean);
  if (recipients.length === 0) return;

  const html = renderEmailLayout({
    preheader: "Repeated incorrect PIN attempts on your paired tablet temporarily locked out money actions.",
    heading: "Your tablet's money PIN was locked out",
    intro: `Several incorrect PIN attempts were made on the HavnLine Printer tablet paired to <strong>${escapeHtml(business.name)}</strong>, so PIN entry is temporarily on cooldown. If this wasn't your staff, consider changing the PIN.`,
    rows: [{ label: "Business", value: escapeHtml(business.name) }],
    cta: { label: "Change the PIN in Settings", url: `${APP_URL}/dashboard/settings` },
    footerNote: `You're getting this because repeated failed PIN attempts were detected on ${escapeHtml(business.name)}'s paired tablet on HavnLine.`,
  });

  try {
    await resend.emails.send({
      from: "HavnLine Notifications <notifications@havnline.com>",
      to: recipients,
      subject: `${business.name}: tablet PIN temporarily locked out`,
      html,
    });
  } catch (err) {
    console.error("Failed to send money-PIN lockout email:", err);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
