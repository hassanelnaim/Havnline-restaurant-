import type { OrderWithItems, MenuItemWithModifiers } from "@/lib/database/types";
import { countsTowardSales } from "@/lib/orders/sales";

export interface SpecialSuggestion {
  title: string;
  detail: string;
  href: string;
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
        title: "Not enough order history yet",
        detail: "Once you've got a couple weeks of real orders in, this will start surfacing slow days, cooling menu items, and bundle ideas based on your own numbers.",
        href: "/dashboard/orders",
      },
    ];
  }

  const suggestions: SpecialSuggestion[] = [];

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
      const pctBelow = Math.round((1 - slowestAvg / overallAvg) * 100);
      suggestions.push({
        title: `${WEEKDAY_DISPLAY[slowestIdx]}s are your slowest day`,
        detail: `Averaging ${pctBelow}% below your typical day over the last ${windowDays} days. A ${WEEKDAY_DISPLAY[slowestIdx]}-only special could be worth testing.`,
        href: "/dashboard/menu",
      });
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
      title: `"${coldItem.name}" hasn't sold in ${windowDays} days`,
      detail: `It's still active on your menu at $${(coldItem.price_cents / 100).toFixed(2)} — featuring it or running it as a limited-time discount could get it moving again.`,
      href: "/dashboard/menu",
    });
  }

  // --- 3. Low items-per-order — a bundle/combo opportunity ---------------
  const totalItemUnits = salesOrders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);
  const avgItemsPerOrder = salesOrders.length > 0 ? totalItemUnits / salesOrders.length : 0;

  if (avgItemsPerOrder > 0 && avgItemsPerOrder <= 1.3) {
    suggestions.push({
      title: "Most orders are a single item",
      detail: `Averaging ${avgItemsPerOrder.toFixed(1)} items per order over the last ${windowDays} days. A simple combo or "add a side" special could raise your average order value.`,
      href: "/dashboard/menu",
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      title: "No red flags in your recent orders",
      detail: "Sales are steady across the week with no obviously cooling items — still a good time to test a new limited-time offer if you want to push growth further.",
      href: "/dashboard/menu",
    });
  }

  return suggestions.slice(0, 2);
}
