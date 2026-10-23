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
 * Whether this call is a demo call: the caller is on DEMO_CALLER_NUMBERS AND
 * the restaurant hasn't connected card payments yet.
 *
 * Caller ID is easy to fake, so a demo call can never apply where real
 * orders are taken: once Stripe is connected, every caller pays. (The
 * restaurant's own numbers used to count as demo callers automatically;
 * anyone faking that number got a free order printed, so that rule is
 * gone.) Keep DEMO_CALLER_NUMBERS empty except while recording a demo.
 */
export function isDemoCall(
  callerPhone: string | null | undefined,
  business: { stripe_connect_charges_enabled?: boolean | null; stripe_connect_account_id?: string | null }
): boolean {
  if (!callerPhone || !isDemoCaller(callerPhone)) return false;
  const paymentsReady = Boolean(business.stripe_connect_charges_enabled && business.stripe_connect_account_id);
  console.log(`[demo-call] caller ends ${normalizePhoneDigits(callerPhone).slice(-4)} is on DEMO_CALLER_NUMBERS: demo=${!paymentsReady} (payments ready=${paymentsReady})`);
  return !paymentsReady;
}
