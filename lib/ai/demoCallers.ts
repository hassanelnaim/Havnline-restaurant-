import { normalizePhoneDigits } from "@/lib/phone-utils";

/**
 * Phone numbers whose calls run in demo mode: the order goes all the way
 * through and the AI says its usual payment-link line, but no payment is
 * needed and nothing is texted (the same simulated payment the dashboard's
 * Test Order-Taker uses). For recording demo calls before card payments
 * are set up. Every other caller is unaffected.
 *
 * Set in Vercel as DEMO_CALLER_NUMBERS, comma-separated, e.g.
 * "3135551234, +13135556789". Remove it to turn demo mode off.
 */
export function isDemoCaller(callerPhone: string | null | undefined): boolean {
  if (!callerPhone) return false;
  const list = (process.env.DEMO_CALLER_NUMBERS || "")
    .split(",")
    .map((n) => normalizePhoneDigits(n))
    .filter((n) => n.length >= 10);
  if (list.length === 0) return false;
  return list.includes(normalizePhoneDigits(callerPhone));
}

/**
 * Whether this call is a demo call. Besides DEMO_CALLER_NUMBERS, the
 * restaurant's own numbers (main phone and escalation phone in Settings)
 * count while card payments aren't connected yet: no real order can be
 * taken then anyway, so letting the owner run a full test call from their
 * own phone risks nothing. Once Stripe is connected, only the explicit list
 * applies. Logs why, so a call that isn't treated as a demo can be traced.
 */
export function isDemoCall(
  callerPhone: string | null | undefined,
  business: { phone?: string | null; escalation_phone?: string | null; stripe_connect_charges_enabled?: boolean | null; stripe_connect_account_id?: string | null }
): boolean {
  if (!callerPhone) return false;
  const caller = normalizePhoneDigits(callerPhone);
  const viaList = isDemoCaller(callerPhone);
  const paymentsReady = Boolean(business.stripe_connect_charges_enabled && business.stripe_connect_account_id);
  const ownNumbers = [business.phone, business.escalation_phone].map((n) => normalizePhoneDigits(n || "")).filter((n) => n.length >= 10);
  const viaOwnNumber = !paymentsReady && ownNumbers.includes(caller);
  const demo = viaList || viaOwnNumber;
  const listed = (process.env.DEMO_CALLER_NUMBERS || "").split(",").filter((n) => n.trim()).length;
  console.log(`[demo-call] caller ends ${caller.slice(-4)}: demo=${demo} (list has ${listed} number${listed === 1 ? "" : "s"}, own-number match=${viaOwnNumber}, payments ready=${paymentsReady})`);
  return demo;
}
