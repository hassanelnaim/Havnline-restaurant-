import type { DbBusiness, DbBusinessHours, Weekday } from "@/lib/database/types";

const WEEKDAY_SEQUENCE: Weekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * "19:00:00" (or "19:00") -> "7 PM"; "19:30" -> "7:30 PM". The ONE
 * place hours get converted from the DB's 24-hour time to something
 * spoken out loud. Every caller that puts a time in front of the AI —
 * systemPrompt.ts's hours list, nextOpenTimeText below — must go
 * through this instead of handing the model a raw "19:00:00" and
 * trusting it to convert 24-hour time to AM/PM correctly itself. It
 * doesn't reliably: that conversion is exactly the kind of mental math
 * a model optimized for low-latency phone replies gets wrong under
 * time pressure, consistently (not just occasionally) — which is what
 * "7 AM to 7 AM" instead of "7 AM to 7 PM" actually was.
 */
export function formatTimeForSpeech(time: string): string {
  const [hStr, mStr] = time.split(":");
  let hour = parseInt(hStr, 10);
  const minute = parseInt(mStr || "0", 10);
  if (Number.isNaN(hour)) return time;
  const period = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return minute === 0 ? `${hour} ${period}` : `${hour}:${String(minute).padStart(2, "0")} ${period}`;
}

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

/**
 * "today at 7 AM" / "tomorrow at 7 AM" / "Wednesday at 7 AM" — a
 * ready-to-say sentence fragment for when the business is closed,
 * fully computed here rather than left for the AI to work out from the
 * full weekly hours table (today's hours vs. tomorrow's, which day is
 * actually next, and the 24→12-hour conversion — three separate ways
 * to get it wrong, on top of each other, under time pressure). Walks
 * forward from today (not just today's row) so a business closed for
 * the rest of today, or closed all day today, still gets a correct
 * answer pointing at whichever day it actually reopens.
 */
export function nextOpenTimeText(business: Pick<DbBusiness, "timezone">, hours: DbBusinessHours[]): string | null {
  const currentWeekdayName = (new Intl.DateTimeFormat("en-US", { timeZone: business.timezone, weekday: "long" })
    .format(new Date())
    .toLowerCase()) as Weekday;
  const currentTimeStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: business.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  const todayIndex = WEEKDAY_SEQUENCE.indexOf(currentWeekdayName);
  if (todayIndex === -1) return null;

  for (let offset = 0; offset <= 7; offset++) {
    const weekday = WEEKDAY_SEQUENCE[(todayIndex + offset) % 7];
    const dayHours = hours.find((h) => h.weekday === weekday);
    if (!dayHours?.is_open || !dayHours.open_time) continue;

    const openTime = dayHours.open_time.slice(0, 5);

    if (offset === 0) {
      const closeTime = dayHours.close_time?.slice(0, 5) ?? null;
      // Open-24-hours (equal open/close time) is covered by
      // isBusinessOpenNow already returning true — this function is
      // only ever reached while closed, so that combination can't
      // apply to "today" here.
      if (closeTime && openTime === closeTime) continue;
      // Already past today's open time — since we're closed, today's
      // whole window (open and close) must already be behind us, so
      // the next real opening is a later day, not today.
      if (currentTimeStr >= openTime) continue;
      return `today at ${formatTimeForSpeech(openTime)}`;
    }
    if (offset === 1) return `tomorrow at ${formatTimeForSpeech(openTime)}`;
    return `${capitalize(weekday)} at ${formatTimeForSpeech(openTime)}`;
  }
  return null;
}
