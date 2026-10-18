import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { getStripeClient } from "@/lib/billing/stripe";
import { effectivePlatformFeeBps } from "@/lib/billing/platformFee";
import { countsTowardSales } from "@/lib/orders/sales";
import { localDayBoundsUtc } from "@/lib/format";
import { safeTimezone } from "@/lib/business/timezone";
import type { DbBusiness } from "@/lib/database/types";

export interface BillingInvoice {
  id: string;
  number: string | null;
  date: string;
  amountCents: number;
  status: string;
  pdfUrl: string | null;
  hostedUrl: string | null;
}

export interface BillingCard {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface BillingOverview {
  /** Everything read live from Stripe. Null when Stripe can't be reached or there's no customer yet. */
  stripe: {
    card: BillingCard | null;
    priceCents: number | null;
    nextChargeDate: string | null;
    trialEnd: string | null;
    cancelAt: string | null;
    invoices: BillingInvoice[];
  } | null;
  month: {
    label: string;
    calls: number;
    orders: number;
    salesCents: number;
    /** Estimate: HavnLine's % of this month's card-paid orders at the current rate. */
    feeCents: number;
    feeBps: number | null;
  };
}

const iso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);

function cardFrom(pm: string | Stripe.PaymentMethod | null | undefined): BillingCard | null {
  if (!pm || typeof pm === "string" || !pm.card) return null;
  return { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
}

async function loadStripe(business: DbBusiness): Promise<BillingOverview["stripe"]> {
  const stripe = getStripeClient();
  if (!stripe || !business.stripe_customer_id) return null;
  try {
    const [subscription, customer, invoices] = await Promise.all([
      business.stripe_subscription_id
        ? stripe.subscriptions.retrieve(business.stripe_subscription_id, { expand: ["default_payment_method"] }).catch(() => null)
        : Promise.resolve(null),
      stripe.customers.retrieve(business.stripe_customer_id, { expand: ["invoice_settings.default_payment_method"] }).catch(() => null),
      stripe.invoices.list({ customer: business.stripe_customer_id, limit: 6 }).catch(() => null),
    ]);

    // The subscription's own card wins; otherwise the customer's default.
    const customerPm = customer && !("deleted" in customer && customer.deleted) ? (customer as Stripe.Customer).invoice_settings?.default_payment_method : null;
    const card = cardFrom(subscription?.default_payment_method) || cardFrom(customerPm);

    const live = subscription && subscription.status !== "canceled";
    return {
      card,
      priceCents: subscription?.items.data[0]?.price.unit_amount ?? null,
      nextChargeDate: live && !subscription.cancel_at_period_end ? iso(subscription.current_period_end) : null,
      trialEnd: subscription?.status === "trialing" ? iso(subscription.trial_end) : null,
      cancelAt: live && subscription.cancel_at_period_end ? iso(subscription.cancel_at || subscription.current_period_end) : null,
      invoices: (invoices?.data || [])
        .filter((inv) => inv.status !== "draft")
        .map((inv) => ({
          id: inv.id,
          number: inv.number,
          date: iso(inv.created) as string,
          amountCents: inv.total,
          status: inv.status || "open",
          pdfUrl: inv.invoice_pdf || null,
          hostedUrl: inv.hosted_invoice_url || null,
        })),
    };
  } catch (err) {
    console.error("[billing] could not load Stripe billing details:", err);
    return null;
  }
}

async function loadMonth(business: DbBusiness): Promise<BillingOverview["month"]> {
  const tz = safeTimezone(business.timezone);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const startIso = localDayBoundsUtc(`${y}-${m}-01`, tz).startIso;
  const label = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "long" }).format(new Date());
  const feeBps = effectivePlatformFeeBps(business);

  const empty = { label, calls: 0, orders: 0, salesCents: 0, feeCents: 0, feeBps };
  if (!isSupabaseConfigured()) return empty;

  const admin = createAdminClient();
  const [callsRes, ordersRes] = await Promise.all([
    admin.from("calls").select("id", { count: "exact", head: true }).eq("business_id", business.id).gte("started_at", startIso),
    admin.from("orders").select("status, payment_status, total_cents, amount_refunded_cents").eq("business_id", business.id).gte("created_at", startIso),
  ]);

  const counted = (ordersRes.data || []).filter(countsTowardSales);
  const salesCents = counted.reduce((s, o) => s + (o.total_cents || 0), 0);
  // The fee only applies to orders paid by card through HavnLine.
  const cardPaidCents = counted.filter((o) => o.payment_status === "paid").reduce((s, o) => s + (o.total_cents || 0), 0);
  return {
    label,
    calls: callsRes.count || 0,
    orders: counted.length,
    salesCents,
    feeCents: feeBps ? Math.round((cardPaidCents * feeBps) / 10_000) : 0,
    feeBps,
  };
}

export async function getBillingOverview(business: DbBusiness): Promise<BillingOverview> {
  const [stripe, month] = await Promise.all([loadStripe(business), loadMonth(business)]);
  return { stripe, month };
}
