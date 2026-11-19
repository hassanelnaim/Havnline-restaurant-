import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { accountForPayment, cancelOrderPayment } from "@/lib/billing/stripeConnect";
import { recordPaymentIfWebhookMissed } from "@/lib/billing/connectPayments";

/**
 * Payment links run out after 30 minutes (lib/billing/payLink.ts). Stripe
 * Checkout used to expire them itself; HavnLine's own page does it here:
 * when someone opens a link that has run out, and in the nightly sweep for
 * the rest. The payment is cancelled at Stripe FIRST, so a customer who
 * pays at the last second is never charged for an order marked dead: if
 * the cancel finds it already paid, nothing is touched and the payment
 * webhook places the order as usual.
 */

interface ExpirableOrder {
  id: string;
  stripe_payment_intent_id: string | null;
  stripe_connect_account_id?: string | null;
}

/** Returns true if the link is now dead, false if the customer got there first (or Stripe couldn't be reached). */
export async function expireOrderPayLink(order: ExpirableOrder, businessAccountId: string | null): Promise<boolean> {
  const admin = createAdminClient();
  const account = accountForPayment(order, businessAccountId);
  if (order.stripe_payment_intent_id && account) {
    const cancelled = await cancelOrderPayment(account, order.stripe_payment_intent_id);
    if (!cancelled.success) {
      // Paid in time: make sure it's recorded even if its webhook never came.
      if (cancelled.alreadyPaid) await recordPaymentIfWebhookMissed(account, order.stripe_payment_intent_id);
      return false;
    }
  }
  await admin.from("orders").update({ status: "cancelled", payment_status: "failed" }).eq("id", order.id).eq("payment_status", "awaiting_payment");
  return true;
}

export async function expireAddendumPayLink(addendum: ExpirableOrder, businessAccountId: string | null): Promise<boolean> {
  const admin = createAdminClient();
  const account = accountForPayment(addendum, businessAccountId);
  if (addendum.stripe_payment_intent_id && account) {
    const cancelled = await cancelOrderPayment(account, addendum.stripe_payment_intent_id);
    if (!cancelled.success) {
      if (cancelled.alreadyPaid) await recordPaymentIfWebhookMissed(account, addendum.stripe_payment_intent_id);
      return false;
    }
  }
  await admin.from("order_addendum_charges").update({ status: "expired" }).eq("id", addendum.id).eq("status", "awaiting_payment");
  return true;
}

/**
 * Closes every link that ran out without being paid: nightly for all
 * restaurants, and for one restaurant when its Orders page loads (so a
 * dead order doesn't sit at "awaiting payment" all day). Returns how many
 * were closed.
 */
export async function sweepExpiredPayLinks(businessId?: string): Promise<number> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const [orders, addenda] = await Promise.all([
    fetchAllRows<ExpirableOrder & { business_id: string }>((from, to) => {
      let q = admin
        .from("orders")
        .select("id, business_id, stripe_payment_intent_id, stripe_connect_account_id")
        .eq("payment_status", "awaiting_payment")
        .not("pay_token", "is", null)
        .lt("payment_expires_at", now);
      if (businessId) q = q.eq("business_id", businessId);
      return q.order("id").range(from, to);
    }),
    fetchAllRows<ExpirableOrder & { business_id: string }>((from, to) => {
      let q = admin
        .from("order_addendum_charges")
        .select("id, business_id, stripe_payment_intent_id, stripe_connect_account_id")
        .eq("status", "awaiting_payment")
        .not("pay_token", "is", null)
        .lt("payment_expires_at", now);
      if (businessId) q = q.eq("business_id", businessId);
      return q.order("id").range(from, to);
    }),
  ]);
  if (orders.error) throw new Error(`could not list expired payment links (run migration 047): ${orders.error.message}`);
  if (addenda.error) throw new Error(`could not list expired add-on links: ${addenda.error.message}`);

  const businessIds = Array.from(new Set([...orders.data, ...addenda.data].map((r) => r.business_id)));
  const accounts = new Map<string, string | null>();
  if (businessIds.length) {
    const { data } = await admin.from("businesses").select("id, stripe_connect_account_id").in("id", businessIds);
    for (const b of data || []) accounts.set(b.id, b.stripe_connect_account_id);
  }

  let closed = 0;
  for (const o of orders.data) if (await expireOrderPayLink(o, accounts.get(o.business_id) ?? null)) closed += 1;
  for (const a of addenda.data) if (await expireAddendumPayLink(a, accounts.get(a.business_id) ?? null)) closed += 1;
  return closed;
}

/** For page loads: closes this restaurant's run-out links, never blocking the page for long or failing it. */
export async function closeExpiredPayLinksQuietly(businessId: string): Promise<void> {
  try {
    await Promise.race([sweepExpiredPayLinks(businessId), new Promise((resolve) => setTimeout(resolve, 3000))]);
  } catch (err) {
    console.error("[pay] could not close expired payment links:", err instanceof Error ? err.message : err);
  }
}
