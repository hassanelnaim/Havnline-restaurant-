import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderEmailLayout } from "@/lib/email/templates";
import { OPERATIONAL_SUBSCRIPTION_STATUSES } from "@/lib/billing/stripe";
import { formatCents } from "@/lib/format";
import { countsTowardSales } from "@/lib/orders/sales";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://havnline.com";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface DigestResult {
  businessesChecked: number;
  emailsSent: number;
  /** Still due this week when the time budget ran out; the next daily run sends them. */
  remaining: number;
  errors: string[];
}

// The cron runs every day. Each business gets one digest per week (the week
// is named by its Monday, UTC), so the first run of the week sends them,
// and any run that ran out of time is finished by the next one.
const TIME_BUDGET_MS = 45_000;

function weekKeyOf(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
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
  const startedAt = Date.now();
  const result: DigestResult = { businessesChecked: 0, emailsSent: 0, remaining: 0, errors: [] };

  if (!resend) {
    result.errors.push("RESEND_API_KEY is not set — no digest emails sent.");
    return result;
  }

  const now = new Date();
  const weekKey = weekKeyOf(now);

  let trackWeeks = true;
  let { data: businesses, error: listError } = await admin
    .from("businesses")
    .select("id, name, timezone, notification_preferences, subscription_status, last_digest_week")
    .not("notification_preferences", "is", null);
  if (listError) {
    // Before migration 036 (no last_digest_week column): the old behavior,
    // everyone gets one now, nothing is remembered.
    console.error("[weekly-digest] could not read last_digest_week (run migration 036):", listError.message);
    trackWeeks = false;
    ({ data: businesses } = await admin
      .from("businesses")
      .select("id, name, timezone, notification_preferences, subscription_status")
      .not("notification_preferences", "is", null) as any);
  }

  const digestBusinesses = (businesses || []).filter((b: any) => {
    const prefs = b.notification_preferences as { digest?: boolean } | null;
    return prefs?.digest && OPERATIONAL_SUBSCRIPTION_STATUSES.includes(b.subscription_status) && (!trackWeeks || b.last_digest_week !== weekKey);
  });

  result.businessesChecked = digestBusinesses.length;

  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startIso = weekAgo.toISOString();
  const endIso = now.toISOString();

  for (const business of digestBusinesses as any[]) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      result.remaining += 1;
      continue;
    }
    if (trackWeeks) {
      // Claimed before sending, so two overlapping runs can't both send it.
      const { data: claimed } = await admin
        .from("businesses")
        .update({ last_digest_week: weekKey })
        .eq("id", business.id)
        .or(`last_digest_week.is.null,last_digest_week.neq.${weekKey}`)
        .select("id")
        .maybeSingle();
      if (!claimed) continue;
    }
    try {
      // Paged: a busy restaurant has more than 1,000 calls in a week.
      const [{ data: calls }, { data: orders }, { data: members }] = await Promise.all([
        fetchAllRows<{ outcome: string | null }>((from, to) =>
          admin.from("calls").select("outcome").eq("business_id", business.id).gte("started_at", startIso).lt("started_at", endIso).order("id").range(from, to)
        ),
        fetchAllRows<{ total_cents: number; status: string; payment_status: string }>((from, to) =>
          admin.from("orders").select("total_cents, status, payment_status").eq("business_id", business.id).gte("created_at", startIso).lt("created_at", endIso).order("id").range(from, to)
        ),
        admin.from("business_members").select("user_id").eq("business_id", business.id),
      ]);

      const userIds = (members || []).map((m) => m.user_id);
      if (userIds.length === 0) continue;

      const { data: users } = await admin.from("users").select("email").in("id", userIds);
      const recipients = (users || []).map((u) => u.email).filter(Boolean);
      if (recipients.length === 0) continue;

      const callsCount = (calls || []).length;
      const escalationsCount = (calls || []).filter((c) => c.outcome === "escalated").length;
      // "Orders" = real order attempts (same rule as the dashboard's
      // "Orders today": excludes still-building and cancelled, but
      // does include ones still awaiting payment). "Sales" is the
      // stricter subset that actually counts as money collected — see
      // lib/orders/sales.ts.
      const realOrders = (orders || []).filter((o) => o.status !== "building" && o.status !== "cancelled");
      const ordersCount = realOrders.length;
      const salesCents = realOrders.filter(countsTowardSales).reduce((sum, o) => sum + (o.total_cents || 0), 0);

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
