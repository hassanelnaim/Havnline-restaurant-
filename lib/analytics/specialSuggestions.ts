import type { OrderWithItems, MenuItemWithModifiers } from "@/lib/database/types";
import { countsTowardSales } from "@/lib/orders/sales";

import { promotionPrefillHref } from "@/lib/analytics/promotionPrefill";

export type SuggestionKind = "slow-day" | "cold-item" | "bundle" | "steady" | "not-enough-data";

export interface SpecialSuggestion {
  kind: SuggestionKind;
  title: string;
  detail: string;
  href: string;
  /** The button on the card: opens the promotion form pre-filled for this idea. */
  actionLabel: string;
}

/** Today and four weeks from today, as YYYY-MM-DD in the business's timezone. */
function promotionWindow(timezone: string): { start: string; end: string } {
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const now = new Date();
  return { start: fmt(now), end: fmt(new Date(now.getTime() + 27 * 24 * 60 * 60 * 1000)) };
}

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_DISPLAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayIndex(iso: string, timezone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(new Date(iso)).toLowerCase();
  return WEEKDAY_NAMES.indexOf(name);
}

// Minimum amount of real sales history before pattern-matching means
// anything — a brand-new business with 3 orders would otherwise get a
// confident-sounding "Tuesdays are slow" suggestion off a single data
// point, which is worse than no suggestion at all.
const MIN_ORDERS_FOR_PATTERNS = 10;

/**
 * Computes a short list of concrete, data-backed ideas for a
 * limited-time offer or special — replacing the old "Recent callers"
 * dashboard card, which just repeated names the owner already knows.
 * Every suggestion here is derived from this business's own order
 * history over `windowDays`, never invented or generic filler, and
 * links straight to where they'd act on it (the Menu page's
 * time-based pricing).
 */
export function getSpecialSuggestions(
  orders: OrderWithItems[],
  items: MenuItemWithModifiers[],
  timezone: string,
  windowDays: number
): SpecialSuggestion[] {
  const salesOrders = orders.filter(countsTowardSales);

  if (salesOrders.length < MIN_ORDERS_FOR_PATTERNS) {
    return [
      {
        kind: "not-enough-data",
        actionLabel: "View orders",
        title: "Not enough order history yet",
        detail: "Once you've got a couple weeks of real orders in, this will start surfacing slow days, cooling menu items, and bundle ideas based on your own numbers.",
        href: "/dashboard/orders",
      },
    ];
  }

  const suggestions: SpecialSuggestion[] = [];
  const promoDates = promotionWindow(timezone);

  // --- 1. Slowest weekday, by revenue per calendar occurrence -----------
  // Total order count alone would just restate which days you're open
  // more hours on; dividing by how many times each weekday actually
  // occurred in the window turns it into a real "this day underperforms"
  // signal.
  const revenueByWeekday = Array(7).fill(0) as number[];
  const occurrencesByWeekday = Array(7).fill(0) as number[];

  for (let i = 0; i < windowDays; i++) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(d).toLowerCase();
    occurrencesByWeekday[WEEKDAY_NAMES.indexOf(wd)] += 1;
  }
  for (const o of salesOrders) {
    revenueByWeekday[weekdayIndex(o.created_at, timezone)] += o.total_cents;
  }

  const avgByWeekday = revenueByWeekday.map((rev, i) => (occurrencesByWeekday[i] > 0 ? rev / occurrencesByWeekday[i] : 0));
  const overallAvg = avgByWeekday.reduce((a, b) => a + b, 0) / 7;

  if (overallAvg > 0) {
    let slowestIdx = -1;
    let slowestAvg = Infinity;
    for (let i = 0; i < 7; i++) {
      if (occurrencesByWeekday[i] >= 2 && avgByWeekday[i] < slowestAvg) {
        slowestAvg = avgByWeekday[i];
        slowestIdx = i;
      }
    }
    if (slowestIdx !== -1 && slowestAvg < overallAvg * 0.7) {
      const day = WEEKDAY_DISPLAY[slowestIdx];
      const daySpecialHref = promotionPrefillHref({
        title: `${day} special`,
        description: `10% off every ${day}`,
        appliesTo: "Whole menu",
        days: [slowestIdx],
        discountType: "percent",
        discountValue: "10",
        ...promoDates,
      });
      if (slowestAvg === 0) {
        // "100% below your typical day" is technically true but reads oddly.
        suggestions.push({
          kind: "slow-day",
          title: `No sales on ${day}s lately`,
          detail: `Nothing sold on a ${day} in the last ${windowDays} days. A ${day}-only special could bring in some business.`,
          href: daySpecialHref,
          actionLabel: `Create a ${day} special`,
        });
      } else {
        const pctBelow = Math.round((1 - slowestAvg / overallAvg) * 100);
        suggestions.push({
          kind: "slow-day",
          title: `${day}s are your slowest day`,
          detail: `${day}s bring in about ${pctBelow}% less than your typical day over the last ${windowDays} days. A ${day}-only special could be worth testing.`,
          href: daySpecialHref,
          actionLabel: `Create a ${day} special`,
        });
      }
    }
  }

  // --- 2. A menu item that's gone cold ----------------------------------
  // Active on the menu, but hasn't appeared in a single order all
  // window — easy to miss since it doesn't show up as an error
  // anywhere, it just quietly stops selling.
  const soldMenuItemIds = new Set<string>();
  for (const o of salesOrders) {
    for (const item of o.items) {
      if (item.menu_item_id) soldMenuItemIds.add(item.menu_item_id);
    }
  }
  const coldItem = items
    .filter((item) => item.is_active && !soldMenuItemIds.has(item.id))
    .sort((a, b) => b.price_cents - a.price_cents)[0];

  if (coldItem) {
    suggestions.push({
      kind: "cold-item",
      title: `"${coldItem.name}" hasn't sold in ${windowDays} days`,
      detail: `It's still active on your menu at $${(coldItem.price_cents / 100).toFixed(2)} — featuring it or running it as a limited-time discount could get it moving again.`,
      href: promotionPrefillHref({
        title: `${coldItem.name} special`,
        description: `15% off ${coldItem.name} for a limited time`,
        appliesTo: coldItem.name,
        itemIds: [coldItem.id],
        discountType: "percent",
        discountValue: "15",
        ...promoDates,
      }),
      actionLabel: `Discount ${coldItem.name}`,
    });
  }

  // --- 3. Low items-per-order — a bundle/combo opportunity ---------------
  const totalItemUnits = salesOrders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);
  const avgItemsPerOrder = salesOrders.length > 0 ? totalItemUnits / salesOrders.length : 0;

  if (avgItemsPerOrder > 0 && avgItemsPerOrder <= 1.3) {
    suggestions.push({
      kind: "bundle",
      actionLabel: "Create a combo deal",
      title: "Most orders are a single item",
      detail: `Averaging ${avgItemsPerOrder.toFixed(1)} items per order over the last ${windowDays} days. A simple combo or "add a side" special could raise your average order value.`,
      href: promotionPrefillHref({ title: "Combo deal", description: "Add a side and a drink to any entrée for a set price", ...promoDates }),
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      kind: "steady",
      actionLabel: "Create a promotion",
      title: "No red flags in your recent orders",
      detail: "Sales are steady across the week with no obviously cooling items — still a good time to test a new limited-time offer if you want to push growth further.",
      href: promotionPrefillHref({ ...promoDates }),
    });
  }

  return suggestions.slice(0, 2);
}
