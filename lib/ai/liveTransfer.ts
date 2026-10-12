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
export function escalationTargetPhone(business: {
  phone?: string | null;
  escalation_phone?: string | null;
}): string | null {
  const escalation = business.escalation_phone?.trim();
  if (escalation) return escalation;
  return business.phone?.trim() || null;
}
