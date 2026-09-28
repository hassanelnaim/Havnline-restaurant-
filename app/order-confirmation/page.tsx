import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { formatCents } from "@/lib/format";
import { Logo } from "@/components/brand/logo";

export const dynamic = "force-dynamic";

/**
 * Where a customer lands after paying (or cancelling) a phone order's
 * Stripe Checkout link — success_url / cancel_url in
 * createOrderCheckoutSession (lib/billing/stripeConnect.ts). Public,
 * unauthenticated, and deliberately minimal: this page only reads the
 * order by its UUID (unguessable) and shows a status, nothing a
 * customer couldn't already see in their own confirmation text.
 *
 * NOTE: this page doesn't decide anything — the actual payment
 * confirmation, kitchen print, and SMS all happen from the Connect
 * webhook (app/api/webhooks/stripe-connect/route.ts), which can fire
 * slightly before or after Stripe redirects the customer here. So a
 * fresh page load right after paying may still show "processing" for
 * a moment; that's normal, not a bug.
 */
export default async function OrderConfirmationPage({ searchParams }: { searchParams: { order_id?: string; cancelled?: string } }) {
  const orderId = searchParams.order_id;
  const cancelled = searchParams.cancelled === "1";

  let order: { payment_status: string; total_cents: number; business_id: string } | null = null;
  let businessName = "the restaurant";

  if (orderId && isSupabaseConfigured()) {
    const admin = createAdminClient();
    const { data } = await admin.from("orders").select("payment_status, total_cents, business_id").eq("id", orderId).maybeSingle();
    order = data;
    if (order) {
      const { data: business } = await admin.from("businesses").select("name").eq("id", order.business_id).maybeSingle();
      if (business?.name) businessName = business.name;
    }
  }

  const paid = order?.payment_status === "paid";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 text-center">
      <Logo wordmarkClassName="text-[15px]" className="mb-8" />
      <div className="max-w-sm rounded-2xl border border-border bg-card p-8 shadow-card">
        {cancelled ? (
          <>
            <XCircle className="mx-auto h-10 w-10 text-danger" />
            <h1 className="mt-3 font-display text-[18px] font-semibold text-ink">Payment cancelled</h1>
            <p className="mt-2 text-[13.5px] text-text-muted">Your order at {businessName} wasn't charged and hasn't been sent to the kitchen. Call back if you'd still like to order.</p>
          </>
        ) : paid ? (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
            <h1 className="mt-3 font-display text-[18px] font-semibold text-ink">Payment received</h1>
            {order && <p className="mt-1 text-[22px] font-semibold text-ink">{formatCents(order.total_cents)}</p>}
            <p className="mt-2 text-[13.5px] text-text-muted">Your order at {businessName} is on its way to the kitchen. See you soon!</p>
          </>
        ) : (
          <>
            <Clock className="mx-auto h-10 w-10 text-brand" />
            <h1 className="mt-3 font-display text-[18px] font-semibold text-ink">Finishing up…</h1>
            <p className="mt-2 text-[13.5px] text-text-muted">We're confirming your payment with {businessName}. This usually takes just a few seconds — you'll also get a text once it's done.</p>
          </>
        )}
      </div>
    </div>
  );
}
