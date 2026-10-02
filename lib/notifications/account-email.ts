import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderEmailLayout } from "@/lib/email/templates";
import { formatCents } from "@/lib/format";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://havnline.com";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Account/billing emails below are deliberately NOT gated by
 * businesses.notification_preferences (unlike calls/escalations/digest
 * in lib/notifications/call-email.ts, escalation-email.ts,
 * weekly-digest-email.ts). Those three are optional activity
 * notifications a business can choose to turn off. These are critical
 * account-state emails — a failed card, a canceled subscription, or a
 * suspended account each mean phone calls will stop being answered
 * correctly, so every business member always gets these regardless of
 * their notification preferences.
 */
async function getRecipients(admin: ReturnType<typeof createAdminClient>, businessId: string): Promise<string[]> {
  const { data: members } = await admin.from("business_members").select("user_id").eq("business_id", businessId);
  const userIds = (members || []).map((m) => m.user_id);
  if (userIds.length === 0) return [];
  const { data: users } = await admin.from("users").select("email").in("id", userIds);
  return (users || []).map((u) => u.email).filter(Boolean);
}

async function send(to: string[], subject: string, html: string, context: string): Promise<void> {
  if (!resend) {
    console.error(`${context} email skipped: RESEND_API_KEY is not set.`);
    return;
  }
  if (to.length === 0) return;
  try {
    await resend.emails.send({ from: "HavnLine Notifications <notifications@havnline.com>", to, subject, html });
  } catch (err) {
    console.error(`Failed to send ${context} email:`, err);
  }
}

/** Sent from the Stripe billing webhook on invoice.payment_failed. */
export async function sendPaymentFailedEmail(businessId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();
  if (!business) return;

  const recipients = await getRecipients(admin, businessId);
  const html = renderEmailLayout({
    preheader: `A payment for your ${business.name} subscription didn't go through.`,
    heading: "Your last payment didn't go through",
    intro: `We couldn't charge the card on file for <strong>${escapeHtml(business.name)}</strong>'s HavnLine subscription. Update your payment method to keep your AI receptionist answering calls without interruption.`,
    cta: { label: "Update payment method", url: `${APP_URL}/dashboard/billing` },
    footerNote: `This is sent to every member of ${escapeHtml(business.name)} — billing alerts can't be turned off.`,
  });
  await send(recipients, `Action needed: update your payment method for ${business.name}`, html, "payment-failed");
}

/** Sent from the Stripe billing webhook on customer.subscription.deleted. */
export async function sendSubscriptionCanceledEmail(businessId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();
  if (!business) return;

  const recipients = await getRecipients(admin, businessId);
  const html = renderEmailLayout({
    preheader: `Your ${business.name} HavnLine subscription has ended.`,
    heading: "Your subscription has ended",
    intro: `<strong>${escapeHtml(business.name)}</strong>'s HavnLine subscription is now canceled. Your AI receptionist will stop answering calls. You can resubscribe any time to pick back up.`,
    cta: { label: "Resubscribe", url: `${APP_URL}/dashboard/billing` },
    footerNote: `This is sent to every member of ${escapeHtml(business.name)} — billing alerts can't be turned off.`,
  });
  await send(recipients, `${business.name}: your HavnLine subscription has ended`, html, "subscription-canceled");
}

/** Sent from suspendBusinessAction (app/actions/business-lifecycle.ts) when a platform admin suspends a business. */
export async function sendBusinessSuspendedEmail(businessId: string, reason: string): Promise<void> {
  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();
  if (!business) return;

  const recipients = await getRecipients(admin, businessId);
  const html = renderEmailLayout({
    preheader: `Your ${business.name} account has been suspended and your AI receptionist is now offline.`,
    heading: "Your account has been suspended",
    intro: `<strong>${escapeHtml(business.name)}</strong>'s HavnLine account has been suspended and your AI receptionist has been taken offline — calls will no longer be answered.${
      reason ? ` <strong>Reason:</strong> ${escapeHtml(reason)}` : ""
    } Contact HavnLine support if you believe this is a mistake.`,
    footerNote: `This is sent to every member of ${escapeHtml(business.name)}.`,
  });
  await send(recipients, `${business.name}: your HavnLine account has been suspended`, html, "business-suspended");
}

/** Sent from reactivateBusinessAction when a platform admin lifts a suspension. */
export async function sendBusinessReactivatedEmail(businessId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();
  if (!business) return;

  const recipients = await getRecipients(admin, businessId);
  const html = renderEmailLayout({
    preheader: `Your ${business.name} account has been reactivated.`,
    heading: "Your account is back",
    intro: `<strong>${escapeHtml(business.name)}</strong>'s HavnLine account has been reactivated. Your AI receptionist is not turned back on automatically — head to your dashboard to bring it back online when you're ready.`,
    cta: { label: "Go to your dashboard", url: `${APP_URL}/dashboard/ai-employee` },
    footerNote: `This is sent to every member of ${escapeHtml(business.name)}.`,
  });
  await send(recipients, `${business.name}: your HavnLine account is reactivated`, html, "business-reactivated");
}

/** Sent from the Stripe Connect webhook the first time charges_enabled flips true. */
export async function sendPaymentsLiveEmail(businessId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();
  if (!business) return;

  const recipients = await getRecipients(admin, businessId);
  const html = renderEmailLayout({
    preheader: `${business.name} can now take phone payments through HavnLine.`,
    heading: "You're set up to take payments",
    intro: `Stripe has finished verifying <strong>${escapeHtml(business.name)}</strong>. Your AI receptionist can now text customers a secure payment link to pay for their order right over the phone.`,
    cta: { label: "Review payment settings", url: `${APP_URL}/dashboard/integrations` },
    footerNote: `This is sent to every member of ${escapeHtml(business.name)}.`,
  });
  await send(recipients, `${business.name}: you're set up to take phone payments`, html, "payments-live");
}

/**
 * Sent from the Stripe Connect webhook when a business's Stripe
 * account is deauthorized/disconnected — either they disconnected it
 * themselves, or Stripe did. Without this, a business could go from
 * "collecting real payments" to silently falling back to pay-at-pickup
 * with no idea why, until a customer or a failed charge tipped them off.
 */
export async function sendPaymentsDisconnectedEmail(businessId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();
  if (!business) return;

  const recipients = await getRecipients(admin, businessId);
  const html = renderEmailLayout({
    preheader: `${business.name}'s Stripe account was disconnected from HavnLine.`,
    heading: "Your Stripe account was disconnected",
    intro: `<strong>${escapeHtml(business.name)}</strong>'s connection to Stripe was removed, so HavnLine can no longer text customers a payment link. Orders will fall back to pay-at-pickup until you reconnect.`,
    cta: { label: "Reconnect Stripe", url: `${APP_URL}/dashboard/integrations` },
    footerNote: `This is sent to every member of ${escapeHtml(business.name)}.`,
  });
  await send(recipients, `${business.name}: your Stripe account was disconnected`, html, "payments-disconnected");
}

/**
 * Sent from processOrderRefund (lib/billing/orderRefund.ts) once the
 * refund has actually gone through on Stripe's side and been recorded
 * on the order — never optimistically before that. Covers both
 * callers that land there: the dashboard's Refund button and the
 * tablet's PIN-gated refund/discount flow. Treated like the other
 * account-email.ts notices (always sent, not gated by
 * notification_preferences) since it's real money leaving the
 * business's own payouts, the same category as a failed payment.
 */
export async function sendOrderRefundedEmail(input: {
  businessId: string;
  orderId: string;
  customerName: string | null;
  customerPhone: string | null;
  refundedCents: number;
  fullyRefunded: boolean;
  reason: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("name").eq("id", input.businessId).single();
  if (!business) return;

  const recipients = await getRecipients(admin, input.businessId);
  const html = renderEmailLayout({
    preheader: `${formatCents(input.refundedCents)} was refunded on an order at ${business.name}.`,
    heading: input.fullyRefunded ? "An order was refunded" : "An order was partially refunded",
    intro: `<strong>${formatCents(input.refundedCents)}</strong> was just refunded back to the customer's card on an order at <strong>${escapeHtml(business.name)}</strong>.`,
    rows: [
      { label: "Customer", value: escapeHtml(input.customerName || "Phone order") },
      ...(input.customerPhone ? [{ label: "Phone", value: `<span style="font-family: 'IBM Plex Mono', Menlo, Consolas, monospace; font-size: 13px;">${escapeHtml(input.customerPhone)}</span>` }] : []),
      { label: "Amount", value: formatCents(input.refundedCents) },
      { label: "Reason", value: escapeHtml(input.reason || "No reason given") },
    ],
    cta: { label: "View order", url: `${APP_URL}/dashboard/orders` },
    footerNote: `This is sent to every member of ${escapeHtml(business.name)} whenever a refund actually goes through — billing alerts can't be turned off.`,
  });
  await send(recipients, `${business.name}: ${formatCents(input.refundedCents)} refunded on an order`, html, "order-refunded");
}
