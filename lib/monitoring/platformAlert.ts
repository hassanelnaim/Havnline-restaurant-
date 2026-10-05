import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderEmailLayout, type EmailRow } from "@/lib/email/templates";
import { recentlySent, markSent } from "@/lib/monitoring/alertThrottle";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://havnline.com";

// One email per kind of problem per window. A real outage produces the
// same error on every call; without this the inbox would get hundreds.
const DEFAULT_THROTTLE_MINUTES = 15;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function platformAdminRecipients(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAIL || "")
    .split(/[,;]/)
    .map((e) => e.trim())
    .filter(Boolean);
}

export interface PlatformAlert {
  /** Identifies the KIND of problem; alerts with the same key are throttled together. */
  key: string;
  subject: string;
  heading: string;
  intro: string;
  /** Plain text values — escaped here. */
  rows?: { label: string; value: string }[];
  throttleMinutes?: number;
}

export type PlatformAlertResult = "sent" | "throttled" | "not_configured" | "failed";

/**
 * Emails the platform owner (PLATFORM_ADMIN_EMAIL) about a problem with
 * the service itself — as opposed to the per-business emails, which tell
 * a restaurant about ITS calls. Best-effort by design: it never throws,
 * and a missing email key or recipient just logs, so an alerting problem
 * can't become a calling problem.
 *
 * Throttling uses a row in service_circuit_breakers (shared by every
 * serverless instance; "tripped_until" here means "don't email this
 * again until"), backed by a per-instance memory check in case that
 * table is unreachable.
 */
export async function sendPlatformAlert(alert: PlatformAlert): Promise<PlatformAlertResult> {
  try {
    const recipients = platformAdminRecipients();
    if (recipients.length === 0 || !resend) {
      console.error(`[alert] not emailed (PLATFORM_ADMIN_EMAIL or RESEND_API_KEY missing): ${alert.subject}`);
      return "not_configured";
    }

    const now = Date.now();
    const windowMs = (alert.throttleMinutes ?? DEFAULT_THROTTLE_MINUTES) * 60_000;
    if (recentlySent(alert.key, now, windowMs)) return "throttled";

    const service = `alert:${alert.key}`.slice(0, 120);
    const admin = createAdminClient();
    try {
      const { data } = await admin.from("service_circuit_breakers").select("tripped_until").eq("service", service).maybeSingle();
      if (data?.tripped_until && new Date(data.tripped_until).getTime() > now) {
        markSent(alert.key, now);
        return "throttled";
      }
      // Claim the window BEFORE sending so a burst of simultaneous
      // errors doesn't each pass the check above and each send.
      await admin.from("service_circuit_breakers").upsert(
        {
          service,
          tripped_until: new Date(now + windowMs).toISOString(),
          last_reason: alert.subject.slice(0, 300),
          updated_at: new Date(now).toISOString(),
        },
        { onConflict: "service" }
      );
    } catch (err) {
      console.error("[alert] throttle check failed, relying on in-memory throttle:", err);
    }
    markSent(alert.key, now);

    const rows: EmailRow[] = (alert.rows || []).map((r) => ({ label: r.label, value: escapeHtml(r.value) }));
    const html = renderEmailLayout({
      preheader: alert.subject,
      heading: alert.heading,
      intro: escapeHtml(alert.intro),
      rows,
      cta: { label: "Open the admin dashboard", url: `${APP_URL}/admin` },
      footerNote: `You're getting this because you're the HavnLine platform admin. Further emails about the same problem are held back for ${Math.round(windowMs / 60_000)} minutes.`,
    });

    try {
      await resend.emails.send({
        from: "HavnLine Alerts <notifications@havnline.com>",
        to: recipients,
        subject: alert.subject,
        html,
      });
      return "sent";
    } catch (err) {
      console.error("[alert] email send failed:", err);
      return "failed";
    }
  } catch (err) {
    console.error("[alert] unexpected failure:", err);
    return "failed";
  }
}

/** Waits for an alert but never longer than `ms`, so error paths stay quick. */
export async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}
