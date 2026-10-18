"use client";
import { useState } from "react";
import { AlertCircle, CheckCircle2, CreditCard, FileText, PhoneCall, ShoppingBag, ExternalLink } from "lucide-react";
import { startCheckoutAction, openBillingPortalAction } from "@/app/actions/billing";
import { MONTHLY_PRICE_CENTS, DEFAULT_PLATFORM_FEE_BPS } from "@/lib/billing/constants";
import type { BillingOverview } from "@/lib/data/billing";
import { Button } from "@/components/ui/button";

type Tone = "success" | "warning" | "danger" | "neutral" | "brand";
const TONES: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-border-soft text-text-muted",
  brand: "bg-brand-soft text-brand-dark",
};

const STATUS: Record<string, { label: string; tone: Tone }> = {
  none: { label: "No plan yet", tone: "neutral" },
  trialing: { label: "Free trial", tone: "brand" },
  active: { label: "Active", tone: "success" },
  past_due: { label: "Payment failed", tone: "danger" },
  canceled: { label: "Canceled", tone: "neutral" },
};

const BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", diners: "Diners", jcb: "JCB", unionpay: "UnionPay" };

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const moneyShort = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : money(cents));

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 ${className}`}>{children}</section>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-[12.5px] text-text-muted">{label}</span>
      <span className="text-right text-[13px] font-medium text-ink">{children}</span>
    </div>
  );
}

export function BillingClient({
  status,
  timezone,
  feeBps,
  fallbackPeriodEnd,
  cancelAtPeriodEnd,
  overview,
  justSubscribed,
}: {
  status: string;
  timezone: string;
  feeBps: number | null;
  fallbackPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  overview: BillingOverview;
  justSubscribed: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = STATUS[status] || STATUS.none;
  const hasPlan = status !== "none" && status !== "canceled";
  const stripe = overview.stripe;
  const priceCents = stripe?.priceCents ?? MONTHLY_PRICE_CENTS;
  const feePercent = (feeBps ?? DEFAULT_PLATFORM_FEE_BPS) / 100;
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric" });

  // Prefer Stripe's live dates; fall back to what the webhook last stored.
  const cancelAt = stripe?.cancelAt || (cancelAtPeriodEnd && fallbackPeriodEnd ? fallbackPeriodEnd : null);
  const nextCharge = stripe ? stripe.nextChargeDate : !cancelAtPeriodEnd ? fallbackPeriodEnd : null;
  const trialEnd = stripe?.trialEnd || null;

  async function go(action: () => Promise<{ url?: string; error?: string }>, fallbackError: string) {
    setLoading(true);
    setError(null);
    const result = await action();
    if (result.url) { window.location.href = result.url; return; }
    setLoading(false);
    setError(result.error || fallbackError);
  }
  const subscribe = () => go(startCheckoutAction, "Could not start checkout.");
  const manage = () => go(openBillingPortalAction, "Could not open billing.");

  const m = overview.month;

  return (
    <div className="space-y-5">
      {justSubscribed && (
        <div className="flex items-center gap-2 rounded-xl border border-success/20 bg-success-soft px-4 py-3 text-[13px] font-medium text-success">
          <CheckCircle2 className="h-4 w-4" /> You&apos;re subscribed. Thanks for choosing HavnLine!
        </div>
      )}
      {status === "past_due" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/20 bg-danger-soft px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] font-medium text-danger"><AlertCircle className="h-4 w-4" /> Your last payment didn&apos;t go through. Update your card to keep your AI answering calls.</span>
          <Button size="sm" variant="brand" onClick={manage} disabled={loading}>Update card</Button>
        </div>
      )}
      {error && <div className="rounded-xl border border-danger/20 bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</div>}

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Plan */}
        <Card className="lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-[15px] font-semibold text-ink">HavnLine plan</h2>
              <p className="mt-1 text-[13px] text-text-muted">
                <span className="font-display text-[22px] font-semibold text-ink">{moneyShort(priceCents)}</span> / month, plus {feePercent}% of each card-paid phone order
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${TONES[meta.tone]}`}>{meta.label}</span>
          </div>

          {hasPlan ? (
            <>
              <div className="mt-4 divide-y divide-border-soft border-t border-border-soft">
                {trialEnd && <Row label="Free trial ends">{date(trialEnd)}</Row>}
                {cancelAt ? (
                  <Row label="Plan ends"><span className="text-amber-700">{date(cancelAt)}</span></Row>
                ) : nextCharge ? (
                  <Row label="Next charge">{money(priceCents)} on {date(nextCharge)}</Row>
                ) : null}
                <Row label="Payment method">
                  {stripe?.card ? (
                    <span className="inline-flex items-center gap-1.5">
                      <CreditCard className="h-4 w-4 text-text-faint" />
                      {BRANDS[stripe.card.brand] || stripe.card.brand} •••• {stripe.card.last4}
                      <span className="font-normal text-text-faint">exp {String(stripe.card.expMonth).padStart(2, "0")}/{String(stripe.card.expYear).slice(-2)}</span>
                    </span>
                  ) : (
                    <span className="font-normal text-text-faint">{stripe ? "None on file" : "Shown in Manage billing"}</span>
                  )}
                </Row>
                {status === "trialing" && <Row label="Order fee"><span className="font-normal text-text-muted">No fee during your trial</span></Row>}
              </div>
              {cancelAt && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                  Your plan is set to cancel. Your AI stops answering on {date(cancelAt)}. You can keep it from Manage billing.
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="brand" size="sm" onClick={manage} disabled={loading}>{loading ? "Opening…" : cancelAt ? "Keep my plan" : "Manage billing"}</Button>
                <span className="text-[12px] text-text-faint">Change your card, download receipts, or cancel. Opens Stripe.</span>
              </div>
            </>
          ) : (
            <>
              <p className="mt-4 text-[13px] leading-relaxed text-text-muted">
                {status === "canceled"
                  ? "Your plan has ended, so your AI isn't answering calls. Start again any time, and your menu and settings are still here."
                  : "Start with a 7-day free trial. You won't be charged until it ends, and you can cancel any time before then."}
              </p>
              <div className="mt-4">
                <Button variant="brand" size="sm" onClick={subscribe} disabled={loading}>
                  {loading ? "Opening checkout…" : status === "canceled" ? "Restart my plan" : "Start 7-day free trial"}
                </Button>
              </div>
            </>
          )}
        </Card>

        {/* This month */}
        <Card className="lg:col-span-2">
          <h2 className="font-display text-[15px] font-semibold text-ink">{m.label} so far</h2>
          <p className="mt-0.5 text-[12px] text-text-faint">What your AI has done for you this month</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-paper px-3.5 py-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint"><PhoneCall className="h-3.5 w-3.5" /> Calls</div>
              <div className="mt-1 font-display text-[22px] font-semibold text-ink">{m.calls.toLocaleString()}</div>
            </div>
            <div className="rounded-xl border border-border bg-paper px-3.5 py-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint"><ShoppingBag className="h-3.5 w-3.5" /> Orders</div>
              <div className="mt-1 font-display text-[22px] font-semibold text-ink">{m.orders.toLocaleString()}</div>
            </div>
          </div>
          <div className="mt-3 divide-y divide-border-soft border-t border-border-soft">
            <Row label="Order sales">{money(m.salesCents)}</Row>
            <Row label={`HavnLine fee${m.feeBps ? ` (${m.feeBps / 100}%)` : ""}`}>{m.feeBps ? `about ${money(m.feeCents)}` : <span className="font-normal text-text-muted">None (free trial)</span>}</Row>
          </div>
          {m.orders > 0 && (
            <p className="mt-3 text-[12px] text-text-muted">
              Your AI took {m.orders} order{m.orders === 1 ? "" : "s"} worth {money(m.salesCents)} this month.
            </p>
          )}
        </Card>
      </div>

      {/* Invoices */}
      {hasPlan || (stripe?.invoices.length ?? 0) > 0 ? (
        <Card>
          <h2 className="font-display text-[15px] font-semibold text-ink">Invoices</h2>
          {!stripe ? (
            <p className="mt-2 text-[12.5px] text-text-faint">Invoices couldn&apos;t be loaded right now. You can always find them in Manage billing.</p>
          ) : stripe.invoices.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-text-faint">No invoices yet. Your first one arrives when your {status === "trialing" ? "trial ends" : "plan renews"}.</p>
          ) : (
            <div className="mt-3 divide-y divide-border-soft">
              {stripe.invoices.map((inv) => {
                const paid = inv.status === "paid";
                const tone: Tone = paid ? "success" : inv.status === "open" ? "warning" : "neutral";
                const label = paid ? "Paid" : inv.status === "open" ? "Due" : inv.status === "void" ? "Void" : inv.status === "uncollectible" ? "Unpaid" : inv.status;
                return (
                  <div key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                    <span className="flex w-36 items-center gap-2 text-[13px] text-ink"><FileText className="h-4 w-4 text-text-faint" />{date(inv.date)}</span>
                    <span className="w-24 text-[13px] font-medium tabular-nums text-ink">{money(inv.amountCents)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>{label}</span>
                    <span className="ml-auto flex items-center gap-3 text-[12.5px]">
                      {inv.pdfUrl && <a href={inv.pdfUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-dark hover:text-brand">PDF</a>}
                      {inv.hostedUrl && (
                        <a href={inv.hostedUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-dark hover:text-brand">
                          {paid ? "View" : "Pay"} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
