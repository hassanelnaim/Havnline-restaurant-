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
  const restaurant = input.restaurantPhone ? normalizePhoneDigits(input.restaurantPhone) : "";
  if (restaurant.length < 10) return false;
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
