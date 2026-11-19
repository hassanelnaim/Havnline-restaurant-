import type { Metadata } from "next";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { formatCents } from "@/lib/format";
import { getSiteUrl } from "@/lib/env";
import { Logo } from "@/components/brand/logo";
import { PayForm } from "@/components/pay/pay-form";
import { looksLikePayToken } from "@/lib/billing/payLink";
import { accountForPayment, ensurePaymentDomain, getPaymentForPage } from "@/lib/billing/stripeConnect";
import { expireAddendumPayLink, expireOrderPayLink } from "@/lib/billing/payExpiry";
import { recordPaymentIfWebhookMissed } from "@/lib/billing/connectPayments";
import { runAfterResponse } from "@/lib/runtime/afterResponse";
import type { PendingAddendumItem } from "@/lib/billing/orderItemAddition";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pay for your order", robots: { index: false, follow: false } };

/**
 * HavnLine's payment page: the link texted after a phone order, or the QR
 * code on the kitchen tablet for an added item. Public and unauthenticated:
 * the long random token in the link is what identifies the order, and the
 * page shows nothing the customer didn't already order. Card details go
 * from Stripe's form straight to Stripe. The order is placed by the payment
 * webhook (lib/billing/connectPayments.ts), never by this page.
 */

interface Line {
  name: string;
  quantity: number;
  cents: number;
  extras: string[];
}

interface Loaded {
  kind: "order" | "addendum";
  id: string;
  businessId: string;
  state: "open" | "paid" | "dead";
  lines: Line[];
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number;
  expiresAt: string | null;
  paymentIntentId: string | null;
  account: string | null;
  business: { name: string; stripe_connect_account_id: string | null; stripe_pm_domain_account?: string | null };
}

async function load(token: string): Promise<Loaded | null> {
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, business_id, status, payment_status, subtotal_cents, tax_cents, total_cents, payment_expires_at, stripe_payment_intent_id, stripe_connect_account_id")
    .eq("pay_token", token)
    .maybeSingle();
  if (order) {
    const { data: business } = await admin.from("businesses").select("name, stripe_connect_account_id, stripe_pm_domain_account").eq("id", order.business_id).maybeSingle();
    if (!business) return null;
    const { data: items } = await admin.from("order_items").select("id, item_name, quantity, unit_price_cents").eq("order_id", order.id).order("created_at");
    const ids = (items || []).map((i) => i.id);
    const { data: mods } = ids.length ? await admin.from("order_item_modifiers").select("order_item_id, modifier_name, price_delta_cents").in("order_item_id", ids) : { data: [] };
    const lines = (items || []).map((i) => {
      const own = (mods || []).filter((m) => m.order_item_id === i.id);
      return {
        name: i.item_name,
        quantity: i.quantity,
        cents: (i.unit_price_cents + own.reduce((s, m) => s + (m.price_delta_cents || 0), 0)) * i.quantity,
        extras: own.map((m) => m.modifier_name),
      };
    });
    const paid = ["paid", "partially_refunded", "refunded"].includes(order.payment_status);
    const dead = !paid && (order.status === "cancelled" || order.payment_status === "failed");
    return {
      kind: "order",
      id: order.id,
      businessId: order.business_id,
      state: paid ? "paid" : dead ? "dead" : "open",
      lines,
      subtotalCents: order.subtotal_cents,
      taxCents: order.tax_cents,
      totalCents: order.total_cents,
      expiresAt: order.payment_expires_at,
      paymentIntentId: order.stripe_payment_intent_id,
      account: accountForPayment(order, business.stripe_connect_account_id),
      business,
    };
  }

  const { data: addendum } = await admin
    .from("order_addendum_charges")
    .select("id, business_id, status, items, amount_cents, payment_expires_at, stripe_payment_intent_id, stripe_connect_account_id")
    .eq("pay_token", token)
    .maybeSingle();
  if (!addendum) return null;
  const { data: business } = await admin.from("businesses").select("name, stripe_connect_account_id, stripe_pm_domain_account").eq("id", addendum.business_id).maybeSingle();
  if (!business) return null;
  const lines = ((addendum.items as PendingAddendumItem[]) || []).map((i) => ({
    name: i.itemName,
    quantity: i.quantity,
    cents: (i.unitPriceCents + (i.modifiers || []).reduce((s, m) => s + (m.priceDeltaCents || 0), 0)) * i.quantity,
    extras: (i.modifiers || []).map((m) => m.modifierName),
  }));
  return {
    kind: "addendum",
    id: addendum.id,
    businessId: addendum.business_id,
    state: addendum.status === "paid" ? "paid" : addendum.status === "awaiting_payment" ? "open" : "dead",
    lines,
    subtotalCents: null,
    taxCents: null,
    totalCents: addendum.amount_cents,
    expiresAt: addendum.payment_expires_at,
    paymentIntentId: addendum.stripe_payment_intent_id,
    account: accountForPayment(addendum, business.stripe_connect_account_id),
    business,
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-paper px-4 py-10">
      <Logo wordmarkClassName="text-[15px]" className="mb-6" />
      <main className="w-full max-w-md">{children}</main>
      <p className="mt-6 max-w-md text-center text-[11.5px] text-text-faint">
        Payments are processed securely by Stripe. HavnLine never sees your card number.
      </p>
    </div>
  );
}

function Notice({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Shell>
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
        {icon}
        <h1 className="mt-3 font-display text-[19px] font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-[13.5px] text-text-muted">{body}</p>
      </div>
    </Shell>
  );
}

function Summary({ data }: { data: Loaded }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <p className="text-[12px] font-medium uppercase tracking-wide text-text-faint">{data.kind === "addendum" ? "Added to your order" : "Your order"}</p>
      <h1 className="mt-0.5 font-display text-[19px] font-semibold text-ink">{data.business.name}</h1>
      <ul className="mt-4 space-y-2.5">
        {data.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-3 text-[13.5px]">
            <span className="text-text">
              {l.quantity > 1 && <span className="font-medium">{l.quantity}× </span>}
              {l.name}
              {l.extras.length > 0 && <span className="block text-[12px] text-text-muted">{l.extras.join(", ")}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-text">{formatCents(l.cents)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 space-y-1 border-t border-border pt-3 text-[13px]">
        {data.subtotalCents !== null && data.taxCents !== null && (
          <>
            <div className="flex justify-between text-text-muted"><span>Subtotal</span><span className="tabular-nums">{formatCents(data.subtotalCents)}</span></div>
            <div className="flex justify-between text-text-muted"><span>Tax</span><span className="tabular-nums">{formatCents(data.taxCents)}</span></div>
          </>
        )}
        <div className="flex justify-between pt-1 text-[15px] font-semibold text-ink"><span>Total</span><span className="tabular-nums">{formatCents(data.totalCents)}</span></div>
      </div>
    </div>
  );
}

export default async function PayPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const notFound = <Notice icon={<XCircle className="mx-auto h-10 w-10 text-danger" />} title="Link not found" body="This payment link isn't valid. Check the text you received, or call the restaurant." />;
  if (!looksLikePayToken(token) || !isSupabaseConfigured()) return notFound;

  const data = await load(token);
  if (!data) return notFound;
  const name = data.business.name;

  const paidNotice = (
    <Notice
      icon={<CheckCircle2 className="mx-auto h-10 w-10 text-success" />}
      title="Payment received"
      body={data.kind === "addendum" ? `Thanks! Your added item is on its way to the kitchen at ${name}.` : `Thanks! Your order is on its way to the kitchen at ${name}. You'll get a text confirming it.`}
    />
  );
  const deadNotice = (
    <Notice
      icon={<Clock className="mx-auto h-10 w-10 text-text-faint" />}
      title="This link has expired"
      body={`Nothing was charged and the order wasn't placed. Call ${name} to order again.`}
    />
  );

  if (data.state === "paid") return paidNotice;
  if (data.state === "dead") return deadNotice;

  // Ran out: close it (cancelling the payment at Stripe first). If the
  // customer paid in the last seconds, the cancel finds it paid instead.
  if (data.expiresAt && Date.parse(data.expiresAt) <= Date.now()) {
    const ref = { id: data.id, stripe_payment_intent_id: data.paymentIntentId, stripe_connect_account_id: data.account };
    const closed = data.kind === "order" ? await expireOrderPayLink(ref, data.account) : await expireAddendumPayLink(ref, data.account);
    return closed ? deadNotice : paidNotice;
  }

  const publishableKey = (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "").trim();
  if (!data.paymentIntentId || !data.account || !publishableKey) {
    if (!publishableKey) console.error("[pay] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY isn't set; the payment page can't show the card form.");
    return <Notice icon={<XCircle className="mx-auto h-10 w-10 text-danger" />} title="Payment isn't available right now" body={`Nothing was charged. Please call ${name} to finish your order.`} />;
  }

  const siteUrl = getSiteUrl();
  const [payment] = await Promise.all([
    getPaymentForPage(data.account, data.paymentIntentId),
    // Lets Apple Pay and Google Pay show; cards work either way.
    ensurePaymentDomain(data.businessId, data.account, data.business.stripe_pm_domain_account, siteUrl),
  ]);
  if (payment.status === "succeeded") {
    // The page is open but the order still waits for payment: Stripe says it
    // was paid, so its webhook hasn't arrived (or never will). Record it now,
    // after the page is sent, so the order still reaches the kitchen.
    runAfterResponse("record payment the webhook missed", recordPaymentIfWebhookMissed(data.account, data.paymentIntentId));
    return paidNotice;
  }
  if (payment.status === "processing") return paidNotice;
  if (payment.status === "canceled") return deadNotice;
  if (!payment.clientSecret) {
    return <Notice icon={<XCircle className="mx-auto h-10 w-10 text-danger" />} title="Payment isn't available right now" body={`Nothing was charged. Try again in a minute, or call ${name}.`} />;
  }

  return (
    <Shell>
      <div className="space-y-4">
        <Summary data={data} />
        <PayForm
          publishableKey={publishableKey}
          accountId={data.account}
          clientSecret={payment.clientSecret}
          totalCents={data.totalCents}
          expiresAt={data.expiresAt}
          returnUrl={`${siteUrl}/pay/${token}`}
          kind={data.kind}
          businessName={name}
        />
      </div>
    </Shell>
  );
}
