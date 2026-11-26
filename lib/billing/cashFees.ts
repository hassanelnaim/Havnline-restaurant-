import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/billing/stripe";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import type { CronJobOutcome } from "@/lib/monitoring/cronRuns";

/**
 * HavnLine's fee on cash-at-pickup orders (migration 052). A card order's
 * fee is taken inside the Stripe payment; a cash order's money never goes
 * through Stripe, so each night the fees on cash orders more than a day
 * old (time for staff to mark a no-show) are added to the restaurant's
 * Stripe customer as one pending invoice item, which Stripe puts on their
 * next monthly subscription invoice.
 *
 * Never charged: no-shows, cancelled orders, and orders placed during the
 * free trial (their fee was recorded as 0). Each order is billed once:
 * cash_fee_billed_at is set when it's billed (or decided not to be), and
 * the Stripe call uses an idempotency key made from the order ids, so a
 * rerun after a crash can't bill the same orders twice.
 */

const SETTLE_MS = 24 * 60 * 60 * 1000;

interface CashOrderRow {
  id: string;
  business_id: string;
  status: string;
  no_show_at: string | null;
  cash_fee_cents: number | null;
  created_at: string;
}

export async function billCashOrderFees(now: Date = new Date()): Promise<CronJobOutcome> {
  const admin = createAdminClient();
  const cutoff = new Date(now.getTime() - SETTLE_MS).toISOString();
  const { data: rows, error } = await fetchAllRows<CashOrderRow>((from, to) =>
    admin
      .from("orders")
      .select("id, business_id, status, no_show_at, cash_fee_cents, created_at")
      .eq("payment_method", "cash")
      .is("cash_fee_billed_at", null)
      .neq("status", "building")
      .lt("created_at", cutoff)
      .order("created_at")
      .order("id")
      .range(from, to)
  );
  if (error) {
    // Before migration 052 the columns don't exist: nothing to bill.
    if (/payment_method|cash_fee/.test(error.message)) return { ok: true, result: { skipped: "migration 052 not run" } };
    return { ok: false, result: { error: error.message } };
  }

  const stripe = getStripeClient();
  const byBusiness = new Map<string, CashOrderRow[]>();
  for (const r of rows) byBusiness.set(r.business_id, [...(byBusiness.get(r.business_id) || []), r]);

  let billedOrders = 0;
  let billedCents = 0;
  let notCharged = 0;
  const problems: string[] = [];
  const stamp = now.toISOString();

  for (const [businessId, orders] of byBusiness) {
    const chargeable = orders.filter((o) => o.status !== "cancelled" && !o.no_show_at && (o.cash_fee_cents || 0) > 0);
    const free = orders.filter((o) => !chargeable.includes(o));
    if (free.length) {
      const { error: freeError } = await admin.from("orders").update({ cash_fee_billed_at: stamp, cash_fee_invoice_item: "not_charged" }).in("id", free.map((o) => o.id));
      if (freeError) problems.push(`${businessId}: ${freeError.message}`);
      else notCharged += free.length;
    }
    if (!chargeable.length) continue;

    const { data: business } = await admin.from("businesses").select("name, stripe_customer_id").eq("id", businessId).maybeSingle();
    if (!business?.stripe_customer_id || !stripe) {
      // Left unbilled: picked up on a later night once they have a billing account.
      problems.push(`${business?.name || businessId}: no Stripe billing customer, ${chargeable.length} cash fee(s) waiting`);
      continue;
    }

    const amount = chargeable.reduce((sum, o) => sum + (o.cash_fee_cents || 0), 0);
    const ids = chargeable.map((o) => o.id).sort();
    const key = createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 40);
    const first = chargeable[0].created_at.slice(0, 10);
    const last = chargeable[chargeable.length - 1].created_at.slice(0, 10);
    try {
      const item = await stripe.invoiceItems.create(
        {
          customer: business.stripe_customer_id,
          amount,
          currency: "usd",
          description: `HavnLine fee on ${chargeable.length} cash order${chargeable.length === 1 ? "" : "s"} (${first === last ? first : `${first} to ${last}`})`,
          metadata: { business_id: businessId, kind: "cash_order_fees", orders: String(chargeable.length) },
        },
        { idempotencyKey: `cash-fees:${businessId}:${key}` }
      );
      const { error: markError } = await admin.from("orders").update({ cash_fee_billed_at: stamp, cash_fee_invoice_item: item.id }).in("id", ids);
      if (markError) problems.push(`${business.name}: billed (${item.id}) but couldn't mark the orders: ${markError.message}`);
      billedOrders += ids.length;
      billedCents += amount;
    } catch (err) {
      problems.push(`${business.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    ok: problems.filter((p) => !p.includes("no Stripe billing customer")).length === 0,
    result: { billedOrders, billedCents, notCharged, restaurants: byBusiness.size, problems: problems.slice(0, 20) },
  };
}
