import { normalizePhoneDigits } from "../phone-utils";

/**
 * Rules for ringing the restaurant live when the AI escalates. Pure
 * functions (no I/O) so every case can be tested directly.
 */

// Marker written to call_messages (role "system") when a live transfer
// starts. Used to know a transfer was already tried on this call, and by
// the voice webhook to recognise a transfer that has looped back.
export const LIVE_TRANSFER_MARKER = "Live transfer to";

export function shouldAttemptLiveTransfer(input: {
  channel: "test" | "phone";
  restaurantPhone: string | null | undefined;
  isOpen: boolean;
  alreadyAttempted: boolean;
  callerPhone: string | null | undefined;
}): boolean {
  if (input.channel !== "phone") return false;
  if (!input.isOpen || input.alreadyAttempted) return false;
  // Not a number we can actually dial: don't promise the caller a transfer.
  if (!toDialableNumber(input.restaurantPhone)) return false;
  const restaurant = normalizePhoneDigits(input.restaurantPhone || "");
  // The caller IS the restaurant's phone: ringing it would ring the caller.
  if (input.callerPhone && normalizePhoneDigits(input.callerPhone) === restaurant) return false;
  return true;
}

/**
 * True when an inbound call is really our own transfer coming back — the
 * restaurant's main line forwards to the HavnLine number, so ringing it
 * would otherwise start another AI call, which could escalate again.
 */
export function isTransferLoop(input: {
  from: string;
  to: string;
  restaurantPhone: string | null | undefined;
  recentTransfer: boolean;
}): boolean {
  const from = normalizePhoneDigits(input.from);
  if (!from) return false;
  if (from === normalizePhoneDigits(input.to)) return true;
  const restaurant = input.restaurantPhone ? normalizePhoneDigits(input.restaurantPhone) : "";
  return Boolean(restaurant) && from === restaurant && input.recentTransfer;
}

/**
 * Formats a phone number the way Twilio's <Dial> expects (E.164).
 * Accepts what people actually type: "(313) 555-1234", "313-555-1234",
 * "1 313 555 1234", "+13135551234". Returns null if it can't be a
 * real number.
 */
export function toDialableNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.trim().startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/**
 * The number a live escalation rings: the optional escalation phone when
 * the business has set one (the main phone then gets NO escalated
 * calls), otherwise the main phone.
 */
/**
 * The numbers a forwarded call rings when the AI isn't answering (Pause AI,
 * or the emergency fallback when HavnLine itself is down): the restaurant's
 * main phone, where staff pick up as normal, and its escalation phone, both
 * at once (<Dial> with several <Number>s rings them together and the first
 * to answer gets the call). If the main line forwards back to HavnLine,
 * that leg is turned away (see isForwardedLegReturning) and the escalation
 * phone keeps ringing. Never the HavnLine number itself or the caller's
 * own number. In +1 format, without duplicates.
 */
export function forwardTargets(
  business: { phone?: string | null; escalation_phone?: string | null },
  havnlineNumber: string,
  callerNumber: string
): string[] {
  const skip = new Set([normalizePhoneDigits(havnlineNumber), normalizePhoneDigits(callerNumber)].filter(Boolean));
  const out: string[] = [];
  for (const raw of [business.phone, business.escalation_phone]) {
    const n = toDialableNumber(raw?.trim() || null);
    if (!n) continue;
    const digits = normalizePhoneDigits(n);
    if (skip.has(digits) || out.some((o) => normalizePhoneDigits(o) === digits)) continue;
    out.push(n);
  }
  return out;
}

/**
 * A call to this HavnLine number that shows this same number as the caller:
 * one of HavnLine's own forwarded calls (they carry the HavnLine number as
 * caller ID) coming straight back, because the phone it rang forwards to
 * HavnLine. It is rejected as busy, not answered, so the forwarded call's
 * other numbers keep ringing.
 */
export function isForwardedLegReturning(from: string, to: string): boolean {
  const f = normalizePhoneDigits(from);
  return Boolean(f) && f === normalizePhoneDigits(to);
}

/** <Number> nouns for forwardTargets. */
export function dialNumbersXml(numbers: string[]): string {
  return numbers.map((n) => `<Number>${n.replace(/[^+\d]/g, "")}</Number>`).join("");
}

export function escalationTargetPhone(business: {
  phone?: string | null;
  escalation_phone?: string | null;
}): string | null {
  const escalation = business.escalation_phone?.trim();
  if (escalation) return escalation;
  return business.phone?.trim() || null;
}
