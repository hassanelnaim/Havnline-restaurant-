import type { DbMenuItem } from "@/lib/database/types";

export interface TimePricedItem {
  price_cents: DbMenuItem["price_cents"];
  special_price_cents: DbMenuItem["special_price_cents"];
  special_price_start_time: DbMenuItem["special_price_start_time"];
  special_price_end_time: DbMenuItem["special_price_end_time"];
}

/**
 * The price this item is actually charged at RIGHT NOW, in the
 * business's own timezone — e.g. a Breakfast Special that's $9.99
 * from 7:00-11:00am and $11.99 otherwise. All three special_price_*
 * fields must be set for the window to apply at all; an item with any
 * of them missing just always uses price_cents, same as before this
 * feature existed.
 *
 * Handles an overnight window (e.g. a late-night menu running
 * 22:00-02:00) by treating start > end as "wraps past midnight."
 */
export function effectivePriceCents(item: TimePricedItem, timezone: string): number {
  if (item.special_price_cents == null || !item.special_price_start_time || !item.special_price_end_time) {
    return item.price_cents;
  }

  const currentTimeStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  const start = item.special_price_start_time.slice(0, 5);
  const end = item.special_price_end_time.slice(0, 5);

  const inWindow = start <= end ? currentTimeStr >= start && currentTimeStr < end : currentTimeStr >= start || currentTimeStr < end;

  return inWindow ? item.special_price_cents : item.price_cents;
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

/** e.g. "$9.99 from 7 AM to 11 AM, $11.99 the rest of the day" — for the AI's system prompt and the menu page. */
export function describeTimePricing(item: TimePricedItem): string | null {
  if (item.special_price_cents == null || !item.special_price_start_time || !item.special_price_end_time) return null;
  const specialText = `$${(item.special_price_cents / 100).toFixed(2)} from ${formatTimeOfDay(item.special_price_start_time)} to ${formatTimeOfDay(item.special_price_end_time)}`;
  const baseText = `$${(item.price_cents / 100).toFixed(2)} the rest of the day`;
  return `${specialText}, ${baseText}`;
}
