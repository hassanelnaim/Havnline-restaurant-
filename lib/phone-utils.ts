/**
 * Phone numbers land in this app in at least two different shapes:
 * Twilio's caller ID (E.164, e.g. "+13135551234", on calls.phone) and
 * whatever a caller SAYS out loud during ordering, which the AI writes
 * down as free text (e.g. "313-555-1234", on customers.phone — see
 * create_customer/lookup_customer in lib/ai/tools.ts, which take
 * whatever string the model produces with no format enforced).
 *
 * Comparing those two directly almost never matches. This strips
 * everything down to the last 10 digits (US/Canada local number) so a
 * caller's number matches across both shapes — used for "does this
 * caller's past-calls list have anything" and "is this caller blocked."
 * Client-safe: no server-only imports, so it can be used from both
 * server data functions and client components.
 */
export function normalizePhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}
