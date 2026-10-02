import type { DbBusiness, DbBusinessHours } from "@/lib/database/types";

/**
 * The single source of truth for "is this business open right now",
 * used both to tell the AI what to say (lib/ai/systemPrompt.ts) and to
 * actually block an order server-side (lib/ai/tools.ts). Previously
 * this same calculation lived only inline in systemPrompt.ts as a
 * string the AI was told to follow — nothing stopped an order from
 * actually going through if the AI didn't follow it. Keeping one
 * function used in both places means the AI's spoken claim ("we're
 * closed") and the actual enforcement can never disagree.
 *
 * A business with no hours rows configured at all (hours.length === 0)
 * is treated as OPEN rather than closed — this is an onboarding-
 * incomplete state, not a deliberate "always closed" setting, and
 * blocking every order for a business that simply hasn't filled in
 * its hours yet would be a footgun, not a real safeguard.
 */
export function isBusinessOpenNow(business: Pick<DbBusiness, "timezone">, hours: DbBusinessHours[]): boolean {
  if (hours.length === 0) return true;

  const currentWeekday = new Intl.DateTimeFormat("en-US", { timeZone: business.timezone, weekday: "long" })
    .format(new Date())
    .toLowerCase();
  const currentTimeStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: business.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  const todayHours = hours.find((h) => h.weekday === currentWeekday);
  if (!todayHours?.is_open || !todayHours.open_time || !todayHours.close_time) return false;

  const openTime = todayHours.open_time.slice(0, 5);
  const closeTime = todayHours.close_time.slice(0, 5);

  // Equal open/close time (e.g. 7:00 AM to 7:00 AM) is the convention
  // for "open 24 hours" — the plain range check below would otherwise
  // only ever match the single instant equal to that time, which is
  // exactly backwards from what setting the same time for both fields
  // is meant to express.
  if (openTime === closeTime) return true;

  // Same overnight-wrap handling as effectivePriceCents
  // (lib/business/pricing.ts) — e.g. 10 PM to 2 AM wraps past
  // midnight, so a close time earlier than the open time doesn't mean
  // "already closed," it means "still open until that time tomorrow."
  return openTime <= closeTime ? currentTimeStr >= openTime && currentTimeStr <= closeTime : currentTimeStr >= openTime || currentTimeStr <= closeTime;
}

/** Human-readable "opens again at [time]" for the AI to read out when closed. */
export function nextOpenTimeText(business: Pick<DbBusiness, "timezone">, hours: DbBusinessHours[]): string | null {
  const currentWeekday = new Intl.DateTimeFormat("en-US", { timeZone: business.timezone, weekday: "long" })
    .format(new Date())
    .toLowerCase();
  const todayHours = hours.find((h) => h.weekday === currentWeekday && h.is_open && h.open_time);
  return todayHours?.open_time || null;
}
