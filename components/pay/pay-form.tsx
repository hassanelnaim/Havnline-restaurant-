"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CheckCircle2, Loader2, Lock } from "lucide-react";
import { formatCents } from "@/lib/format";

interface Props {
  publishableKey: string;
  accountId: string;
  clientSecret: string;
  totalCents: number;
  expiresAt: string | null;
  returnUrl: string;
  kind: "order" | "addendum";
  businessName: string;
}

/**
 * Stripe's card form (with Apple Pay / Google Pay when the phone has them)
 * for one payment on the restaurant's own Stripe account. No email field:
 * the payment is card-only, which leaves out Link. Card numbers go from
 * this form straight to Stripe.
 */
export function PayForm(props: Props) {
  // Created once per page: the restaurant's account is fixed for this payment.
  const stripePromise = useMemo(() => loadStripe(props.publishableKey, { stripeAccount: props.accountId }), [props.publishableKey, props.accountId]);
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret: props.clientSecret,
        appearance: {
          theme: "stripe",
          variables: { colorPrimary: "#2563EB", colorText: "#0B1220", borderRadius: "10px", fontSizeBase: "15px" },
        },
      }}
    >
      <Inner {...props} />
    </Elements>
  );
}

function useCountdown(expiresAt: string | null): number | null {
  const [left, setLeft] = useState<number | null>(() => (expiresAt ? Date.parse(expiresAt) - Date.now() : null));
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setLeft(Date.parse(expiresAt) - Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return left;
}

function Inner({ totalCents, expiresAt, returnUrl, kind, businessName }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const left = useCountdown(expiresAt);
  const expired = left !== null && left <= 0;

  // When the link runs out, reload: the page closes it and says so.
  useEffect(() => {
    if (expired && !done && !paying) router.refresh();
  }, [expired, done, paying, router]);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || paying || expired) return;
    setPaying(true);
    setError(null);
    const { error: payError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      // Cards finish right here; only a bank check (3-D Secure) leaves the page and comes back.
      redirect: "if_required",
    });
    if (payError) {
      setError(payError.message || "The payment didn't go through. Please try again.");
      setPaying(false);
      return;
    }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      setDone(true);
      setTimeout(() => router.refresh(), 2500);
      return;
    }
    setPaying(false);
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-card">
        <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
        <h2 className="mt-3 font-display text-[19px] font-semibold text-ink">Payment received</h2>
        <p className="mt-2 text-[13.5px] text-text-muted">
          {kind === "addendum" ? `Your added item is on its way to the kitchen at ${businessName}.` : `Your order is on its way to the kitchen at ${businessName}. You'll get a text confirming it.`}
        </p>
      </div>
    );
  }

  const mins = left !== null ? Math.max(0, Math.floor(left / 60000)) : null;
  const secs = left !== null ? Math.max(0, Math.floor((left % 60000) / 1000)) : null;

  return (
    <form onSubmit={pay} className="rounded-2xl border border-border bg-card p-5 shadow-card">
      {kind === "order" && (
        <p className="mb-4 rounded-lg bg-brand-soft px-3 py-2 text-[12.5px] text-ink">
          Your order goes to the kitchen as soon as you pay.
          {mins !== null && !expired && <> This link works for another <span className="font-semibold tabular-nums">{mins}:{String(secs).padStart(2, "0")}</span>.</>}
        </p>
      )}
      {!ready && !error && (
        <p className="flex items-center gap-2 py-6 text-[13px] text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the secure card form…
        </p>
      )}
      <PaymentElement
        onReady={() => setReady(true)}
        onLoadError={() => setError("The card form couldn't load. Check your connection (or turn off a content blocker) and reload this page.")}
        options={{ layout: "tabs", wallets: { applePay: "auto", googlePay: "auto" } }}
      />
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      <button
        type="submit"
        disabled={!stripe || !ready || paying || expired}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-[15px] font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
        {expired ? "Link expired" : paying ? "Paying…" : `Pay ${formatCents(totalCents)}`}
      </button>
    </form>
  );
}
