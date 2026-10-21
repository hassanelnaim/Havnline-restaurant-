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
