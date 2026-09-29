import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderEmailLayout } from "@/lib/email/templates";
import { OPERATIONAL_SUBSCRIPTION_STATUSES } from "@/lib/billing/stripe";
import { formatCents } from "@/lib/format";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://havnline.com";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface DigestResult {
  businessesChecked: number;
  emailsSent: number;
  errors: string[];
}

/**
 * Emails every business that has notification_preferences.digest turned
 * on with a rolling "past 7 days" summary — calls, orders, sales,
 * escalations. Meant to be called once a week from
 * app/api/cron/weekly-digest/route.ts (Vercel Cron).
 *
 * Deliberately a plain rolling 7-day window (now - 7d to now) computed
 * once in UTC, not a per-business "local calendar week" — a single cron
 * fire happens at one UTC instant for every business regardless of
 * their timezone, so there's no single "local Monday" it could align
 * to for all of them at once. A rolling week is simpler and still
 * accurate; only the label ("the past 7 days") reflects that, not a
 * specific Mon-Sun range.
 */
export async function sendWeeklyDigestEmails(): Promise<DigestResult> {
  const admin = createAdminClient();
  const result: DigestResult = { businessesChecked: 0, emailsSent: 0, errors: [] };

  if (!resend) {
    result.errors.push("RESEND_API_KEY is not set — no digest emails sent.");
    return result;
  }

  const { data: businesses } = await admin
    .from("businesses")
    .select("id, name, timezone, notification_preferences, subscription_status")
    .not("notification_preferences", "is", null);

  const digestBusinesses = (businesses || []).filter((b) => {
    const prefs = b.notification_preferences as { digest?: boolean } | null;
    return prefs?.digest && OPERATIONAL_SUBSCRIPTION_STATUSES.includes(b.subscription_status);
  });

  result.businessesChecked = digestBusinesses.length;

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startIso = weekAgo.toISOString();
  const endIso = now.toISOString();

  for (const business of digestBusinesses) {
    try {
      const [{ data: calls }, { data: orders }, { data: members }] = await Promise.all([
        admin.from("calls").select("outcome").eq("business_id", business.id).gte("started_at", startIso).lt("started_at", endIso),
        admin
          .from("orders")
          .select("total_cents")
          .eq("business_id", business.id)
          .neq("status", "building")
          .gte("created_at", startIso)
          .lt("created_at", endIso),
        admin.from("business_members").select("user_id").eq("business_id", business.id),
      ]);

      const userIds = (members || []).map((m) => m.user_id);
      if (userIds.length === 0) continue;

      const { data: users } = await admin.from("users").select("email").in("id", userIds);
      const recipients = (users || []).map((u) => u.email).filter(Boolean);
      if (recipients.length === 0) continue;

      const callsCount = (calls || []).length;
      const escalationsCount = (calls || []).filter((c) => c.outcome === "escalated").length;
      const ordersCount = (orders || []).length;
      const salesCents = (orders || []).reduce((sum, o) => sum + (o.total_cents || 0), 0);

      const html = renderEmailLayout({
        preheader: `${callsCount} calls, ${ordersCount} orders, ${formatCents(salesCents)} in sales over the past 7 days at ${business.name}.`,
        heading: "Your week at a glance",
        intro: `Here's how <strong>${escapeHtml(business.name)}</strong>'s AI receptionist did over the past 7 days.`,
        rows: [
          { label: "Calls", value: String(callsCount) },
          { label: "Orders", value: String(ordersCount) },
          { label: "Sales", value: formatCents(salesCents) },
          { label: "Escalations", value: String(escalationsCount) },
        ],
        cta: { label: "View your dashboard", url: `${APP_URL}/dashboard` },
        footerNote: `You're getting this because the weekly digest is turned on for ${escapeHtml(business.name)} on HavnLine. <a href="${APP_URL}/dashboard/settings" style="color: #5B6472;">Manage notification settings</a>.`,
      });

      await resend.emails.send({
        from: "HavnLine Notifications <notifications@havnline.com>",
        to: recipients,
        subject: `${business.name}: your week at a glance`,
        html,
      });

      result.emailsSent += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`Weekly digest failed for business ${business.id}:`, err);
      result.errors.push(`${business.id}: ${message}`);
    }
  }

  return result;
}
