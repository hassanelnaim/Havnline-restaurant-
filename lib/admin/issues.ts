import { createAdminClient } from "@/lib/supabase/admin";
import { OPERATIONAL_SUBSCRIPTION_STATUSES } from "@/lib/billing/stripe";

export type IssueSeverity = "critical" | "warning" | "info";

export interface BusinessIssue {
  businessId: string;
  businessName: string;
  severity: IssueSeverity;
  label: string;
  detail: string;
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Read-only health scan across every business — computed fresh from
 * real data on every call (no separate health-check job/cron, no
 * stored "flagged" state), so it's never stale in the way the old
 * hardcoded MRR was. Meant to answer "is anything broken, and where,"
 * not to fix it — see the individual admin actions (suspend, status
 * override, fee editor, etc.) for that.
 *
 * Pass a businessId to scope this to one business (used on that
 * business's own admin page); omit it for the platform-wide panel on
 * the Command Center.
 */
export async function getBusinessIssues(businessId?: string): Promise<BusinessIssue[]> {
  const admin = createAdminClient();
  const issues: BusinessIssue[] = [];

  let businessQuery = admin
    .from("businesses")
    .select("id, name, subscription_status, is_suspended, suspended_reason, cancel_at_period_end, current_period_end, created_at, stripe_connect_account_id, stripe_connect_charges_enabled, phone_payments_enabled");
  if (businessId) businessQuery = businessQuery.eq("id", businessId);
  const { data: businesses } = await businessQuery;
  if (!businesses || businesses.length === 0) return [];

  const businessIds = businesses.map((b) => b.id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: aiReceptionists }, { data: recentCalls }, { data: failedOrders }] = await Promise.all([
    admin.from("ai_receptionists").select("business_id, status").in("business_id", businessIds),
    admin.from("calls").select("business_id, started_at").in("business_id", businessIds).gte("started_at", sevenDaysAgo),
    admin.from("orders").select("business_id, submit_error").in("business_id", businessIds).not("submit_error", "is", null).gte("created_at", sevenDaysAgo),
  ]);

  const aiStatusByBusiness = new Map((aiReceptionists || []).map((a) => [a.business_id, a.status]));
  const recentCallCountByBusiness = new Map<string, number>();
  for (const call of recentCalls || []) {
    recentCallCountByBusiness.set(call.business_id, (recentCallCountByBusiness.get(call.business_id) || 0) + 1);
  }
  const failedOrderCountByBusiness = new Map<string, number>();
  for (const order of failedOrders || []) {
    failedOrderCountByBusiness.set(order.business_id, (failedOrderCountByBusiness.get(order.business_id) || 0) + 1);
  }

  for (const b of businesses) {
    const isOperational = OPERATIONAL_SUBSCRIPTION_STATUSES.includes(b.subscription_status);

    if (b.subscription_status === "past_due") {
      issues.push({
        businessId: b.id,
        businessName: b.name,
        severity: "critical",
        label: "Payment failed",
        detail: "Their last subscription payment didn't go through — billing is past due.",
      });
    }

    if (b.is_suspended) {
      issues.push({
        businessId: b.id,
        businessName: b.name,
        severity: "warning",
        label: "Account suspended",
        detail: b.suspended_reason ? `Reason: ${b.suspended_reason}` : "No reason logged.",
      });
    }

    if (b.phone_payments_enabled && !b.stripe_connect_charges_enabled) {
      issues.push({
        businessId: b.id,
        businessName: b.name,
        severity: "warning",
        label: "Phone payments on, but Stripe isn't ready",
        detail: "Phone payments is toggled on, but their Stripe Connect account isn't actually able to accept charges yet — customers may be getting a broken payment flow.",
      });
    } else if (b.stripe_connect_account_id && !b.stripe_connect_charges_enabled) {
      issues.push({
        businessId: b.id,
        businessName: b.name,
        severity: "info",
        label: "Stripe onboarding unfinished",
        detail: "They started connecting Stripe but haven't finished onboarding.",
      });
    }

    const failedOrderCount = failedOrderCountByBusiness.get(b.id) || 0;
    if (failedOrderCount > 0) {
      issues.push({
        businessId: b.id,
        businessName: b.name,
        severity: "warning",
        label: "Kitchen printer failures",
        detail: `${failedOrderCount} order${failedOrderCount === 1 ? "" : "s"} failed to reach the kitchen printer in the last 7 days.`,
      });
    }

    // A business that's operational, has its AI turned on, and has
    // been around longer than a week but took zero calls in the last
    // 7 days is the clearest signal something's actually broken
    // (Twilio number forwarding, webhook misconfiguration) rather than
    // just a quiet week — worth a human looking, not an alarm.
    const daysOld = (Date.now() - new Date(b.created_at).getTime()) / (24 * 60 * 60 * 1000);
    const aiStatus = aiStatusByBusiness.get(b.id);
    const recentCallCount = recentCallCountByBusiness.get(b.id) || 0;
    if (isOperational && aiStatus === "online" && daysOld > 7 && recentCallCount === 0) {
      issues.push({
        businessId: b.id,
        businessName: b.name,
        severity: "warning",
        label: "No calls in 7 days",
        detail: "Their AI is on and their account is active, but it hasn't taken a single call in the last week — worth checking their phone forwarding is actually set up right.",
      });
    }

    if (b.cancel_at_period_end && b.current_period_end) {
      issues.push({
        businessId: b.id,
        businessName: b.name,
        severity: "info",
        label: "Canceling",
        detail: `Access ends ${new Date(b.current_period_end).toLocaleDateString()}.`,
      });
    }
  }

  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
