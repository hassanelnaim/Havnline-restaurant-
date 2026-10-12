import type { DbMenuItem } from "@/lib/database/types";

export interface TimePricedItem {
  price_cents: DbMenuItem["price_cents"];
  special_price_cents: DbMenuItem["special_price_cents"];
  special_price_start_time: DbMenuItem["special_price_start_time"];
  special_price_end_time: DbMenuItem["special_price_end_time"];
  /** 0=Sunday..6=Saturday. null/empty = every day. Optional so older callers keep compiling. */
  special_price_days?: DbMenuItem["special_price_days"];
}

/** A recurring schedule: certain weekdays, optionally within a time-of-day window. */
export interface ScheduleWindow {
  days?: number[] | null;
  start?: string | null;
  end?: string | null;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The current weekday (0=Sun) and "HH:MM" in the given timezone. */
export function localDayAndTime(timezone: string, now: Date = new Date()): { weekday: number; hhmm: string; dateKey: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return {
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
    hhmm: `${get("hour")}:${get("minute")}`,
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/**
 * Whether a recurring schedule is running right now in the business's
 * timezone. No days = every day; no time window = all day. An overnight
 * window (start later than end, e.g. 22:00-02:00) belongs to the day it
 * STARTED on: Friday 22:00-02:00 still counts at 1am Saturday.
 */
export function isScheduleActive(w: ScheduleWindow, timezone: string, now: Date = new Date()): boolean {
  const days = w.days && w.days.length > 0 ? w.days : null;
  const { weekday, hhmm } = localDayAndTime(timezone, now);
  const dayOk = (d: number) => !days || days.includes(d);

  if (!w.start || !w.end) return dayOk(weekday);

  const start = w.start.slice(0, 5);
  const end = w.end.slice(0, 5);
  if (start <= end) return dayOk(weekday) && hhmm >= start && hhmm < end;
  if (hhmm >= start) return dayOk(weekday);
  if (hhmm < end) return dayOk((weekday + 6) % 7);
  return false;
}

/** True when this item has a special price configured at all (a time window, days, or both). */
function hasSpecialPrice(item: TimePricedItem): boolean {
  if (item.special_price_cents == null) return false;
  const hasWindow = Boolean(item.special_price_start_time && item.special_price_end_time);
  const hasDays = Boolean(item.special_price_days && item.special_price_days.length > 0);
  return hasWindow || hasDays;
}

/**
 * The price this item is actually charged at RIGHT NOW, in the
 * business's own timezone — e.g. a Breakfast Special that's $9.99
 * from 7:00-11:00am and $11.99 otherwise, or a Taco Tuesday item that is
 * $5 all day Tuesday. The special applies when it is one of its days (if
 * any days are set) AND inside its time window (if one is set). An item
 * with no special price configured just always uses price_cents.
 */
export function effectivePriceCents(item: TimePricedItem, timezone: string, now: Date = new Date()): number {
  if (!hasSpecialPrice(item)) return item.price_cents;
  const active = isScheduleActive(
    { days: item.special_price_days, start: item.special_price_start_time, end: item.special_price_end_time },
    timezone,
    now
  );
  return active ? (item.special_price_cents as number) : item.price_cents;
}

/** "7:00 AM" from a "HH:MM:SS" or "HH:MM" time string, for display. */
export function formatTimeOfDay(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** "Mon, Wed, Fri" / "every day" / "weekdays" / "weekends" */
export function describeDays(days: number[] | null | undefined): string {
  const set = Array.from(new Set(days || [])).sort((a, b) => a - b);
  if (set.length === 0 || set.length === 7) return "every day";
  if (set.join() === "1,2,3,4,5") return "Monday to Friday";
  if (set.join() === "0,6") return "weekends";
  return set.map((d) => WEEKDAY_SHORT[d]).join(", ");
}

/** "Tuesdays from 11 AM to 3 PM" / "every day from 7 AM to 11 AM" / "all day Tuesday". */
export function describeSchedule(w: ScheduleWindow): string {
  const hasWindow = Boolean(w.start && w.end);
  const daysText = describeDays(w.days);
  if (!hasWindow) return daysText === "every day" ? "all day, every day" : `all day ${daysText}`;
  return `${daysText} from ${formatTimeOfDay(w.start as string)} to ${formatTimeOfDay(w.end as string)}`;
}

/** e.g. "$9.99 Mon, Tue from 7 AM to 11 AM, $11.99 otherwise" — for the AI's system prompt and the menu page. */
export function describeTimePricing(item: TimePricedItem): string | null {
  if (!hasSpecialPrice(item)) return null;
  const specialText = `$${((item.special_price_cents as number) / 100).toFixed(2)} ${describeSchedule({ days: item.special_price_days, start: item.special_price_start_time, end: item.special_price_end_time })}`;
  const baseText = `$${(item.price_cents / 100).toFixed(2)} otherwise`;
  return `${specialText}, ${baseText}`;
}

// ---------------------------------------------------------------------------
// Promotions that actually discount
// ---------------------------------------------------------------------------

export interface PromotionLike {
  id: string;
  title: string;
  is_active: boolean;
  start_date: string; // YYYY-MM-DD, inclusive
  end_date: string; // YYYY-MM-DD, inclusive
  days_of_week?: number[] | null;
  start_time?: string | null;
  end_time?: string | null;
  discount_type?: "percent" | "amount" | null;
  discount_value?: number | null;
  menu_item_ids?: string[] | null;
}

/** Plain-language discount, e.g. "15% off" / "$2.00 off each item". null for mention-only promotions. */
export function describeDiscount(p: Pick<PromotionLike, "discount_type" | "discount_value">): string | null {
  if (!p.discount_type || !p.discount_value) return null;
  return p.discount_type === "percent" ? `${p.discount_value}% off` : `$${(p.discount_value / 100).toFixed(2)} off each item`;
}

/** Whether a promotion is running right now: switched on, inside its date range, and on one of its days/times. */
export function isPromotionActiveNow(p: PromotionLike, timezone: string, now: Date = new Date()): boolean {
  if (!p.is_active) return false;
  const { dateKey } = localDayAndTime(timezone, now);
  if (p.start_date > dateKey || p.end_date < dateKey) return false;
  return isScheduleActive({ days: p.days_of_week, start: p.start_time, end: p.end_time }, timezone, now);
}

function discountedCents(priceCents: number, p: PromotionLike): number {
  if (p.discount_type === "percent" && p.discount_value) {
    const pct = Math.min(100, Math.max(0, p.discount_value));
    return Math.max(0, Math.round((priceCents * (100 - pct)) / 100));
  }
  if (p.discount_type === "amount" && p.discount_value) {
    return Math.max(0, priceCents - p.discount_value);
  }
  return priceCents;
}

export interface ItemPriceQuote {
  /** What the customer pays for one unit, before modifiers. */
  unitPriceCents: number;
  /** The price before any promotion (already reflects a time/day special). */
  priceBeforePromotionCents: number;
  /** The promotion that lowered the price, if any. */
  promotion: { id: string; title: string; description: string } | null;
}

/**
 * The final per-unit price for a menu item right now: its time/day special
 * price (or normal price), then the single best active promotion that covers
 * it. Promotions never stack — the one giving the lowest price wins. Only
 * promotions that carry a real discount are considered; mention-only ones
 * never change a price.
 */
export function quoteItemPrice(
  item: TimePricedItem & { id: string },
  promotions: PromotionLike[],
  timezone: string,
  now: Date = new Date()
): ItemPriceQuote {
  const before = effectivePriceCents(item, timezone, now);
  let best: { cents: number; promo: PromotionLike } | null = null;
  for (const promo of promotions) {
    if (!promo.discount_type || !promo.discount_value) continue;
    if (!isPromotionActiveNow(promo, timezone, now)) continue;
    const scope = promo.menu_item_ids && promo.menu_item_ids.length > 0 ? promo.menu_item_ids : null;
    if (scope && !scope.includes(item.id)) continue;
    const cents = discountedCents(before, promo);
    if (cents < before && (!best || cents < best.cents)) best = { cents, promo };
  }
  if (!best) return { unitPriceCents: before, priceBeforePromotionCents: before, promotion: null };
  return {
    unitPriceCents: best.cents,
    priceBeforePromotionCents: before,
    promotion: { id: best.promo.id, title: best.promo.title, description: describeDiscount(best.promo) || "" },
  };
}

