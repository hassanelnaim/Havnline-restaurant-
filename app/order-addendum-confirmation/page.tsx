import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { formatCents } from "@/lib/format";
import { Logo } from "@/components/brand/logo";

export const dynamic = "force-dynamic";

/**
 * Where a customer lands after paying (or cancelling) a Phase 4 QR
 * item-addition charge — success_url / cancel_url set in the items
 * route (app/api/printer-app/today-orders/[id]/items). A SEPARATE
 * page from /order-confirmation on purpose: that page's "paid" check
 * is the ORIGINAL order's payment_status, which is already "paid" by
 * the time any addendum charge even starts (the customer is adding to
 * a meal already being served), so it would show "Payment received"
 * immediately regardless of whether this specific addition actually
 * went through. This page instead reads the one order_addendum_charges
 * row by its own id, so "processing" / "paid" / "cancelled" here
 * always reflects the addition itself, not the original order.
 *
 * NOTE: like order-confirmation, this page doesn't decide anything —
 * the actual confirmation (inserting the real items, printing the
 * addendum ticket) happens from the Connect webhook's addendum_id
 * branch (app/api/webhooks/stripe-connect/route.ts), which can fire
 * slightly before or after Stripe redirects the customer here.
 */
export default async function OrderAddendumConfirmationPage({ searchParams }: { searchParams: { addendum_id?: string; cancelled?: string } }) {
  const addendumId = searchParams.addendum_id;
  const cancelled = searchParams.cancelled === "1";

  let charge: { status: string; amount_cents: number; business_id: string } | null = null;
  let businessName = "the restaurant";

  if (addendumId && isSupabaseConfigured()) {
    const admin = createAdminClient();
    const { data } = await admin.from("order_addendum_charges").select("status, amount_cents, business_id").eq("id", addendumId).maybeSingle();
    charge = data;
    if (charge) {
      const { data: business } = await admin.from("businesses").select("name").eq("id", charge.business_id).maybeSingle();
      if (business?.name) businessName = business.name;
    }
  }

  const paid = charge?.status === "paid";
  const expired = charge?.status === "expired" || charge?.status === "failed";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 text-center">
      <Logo wordmarkClassName="text-[15px]" className="mb-8" />
      <div className="max-w-sm rounded-2xl border border-border bg-card p-8 shadow-card">
        {cancelled || expired ? (
          <>
            <XCircle className="mx-auto h-10 w-10 text-danger" />
            <h1 className="mt-3 font-display text-[18px] font-semibold text-ink">Payment cancelled</h1>
            <p className="mt-2 text-[13.5px] text-text-muted">This item wasn't charged at {businessName}. Ask your server to try again if you'd still like to add it.</p>
          </>
        ) : paid ? (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
            <h1 className="mt-3 font-display text-[18px] font-semibold text-ink">Payment received</h1>
            {charge && <p className="mt-1 text-[22px] font-semibold text-ink">{formatCents(charge.amount_cents)}</p>}
            <p className="mt-2 text-[13.5px] text-text-muted">Your added item is on its way to the kitchen at {businessName}. Thanks!</p>
          </>
        ) : (
          <>
            <Clock className="mx-auto h-10 w-10 text-brand" />
            <h1 className="mt-3 font-display text-[18px] font-semibold text-ink">Finishing up…</h1>
            <p className="mt-2 text-[13.5px] text-text-muted">We're confirming your payment with {businessName}. This usually takes just a few seconds.</p>
          </>
        )}
      </div>
    </div>
  );
}
