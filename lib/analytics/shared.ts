/**
 * Client-safe pieces of the dashboard analytics: types, window sizes and the
 * pure ranking function. Nothing here may import server-only code (the
 * Supabase server client, next/headers), because browser components import
 * this file. The database loaders live in lib/data/analytics.ts.
 */

export type SalesUnit = "hour" | "day" | "week" | "month";

export interface SalesBucket {
  /** Local start of the period, "YYYY-MM-DDTHH:MM:SS" (already in the business's timezone). */
  local: string;
  totalCents: number;
  orders: number;
}

/** How many periods each view shows. Old periods fall off as new ones begin. */
export const SALES_WINDOWS: Record<SalesUnit, number> = { hour: 24, day: 14, week: 8, month: 12 };
export const SALES_UNITS: SalesUnit[] = ["hour", "day", "week", "month"];

export type SalesSeries = Record<SalesUnit, SalesBucket[]>;

export interface SalesPeriodTotals {
  totalCents: number;
  orders: number;
}

/**
 * What the Sales card shows: the bars for each timeframe, plus the totals of
 * the equal-length stretch just before it (the previous 8 weeks for the
 * weekly view, and so on) for the "vs previous" comparison.
 */
export interface SalesData {
  series: SalesSeries;
  previous: Record<SalesUnit, SalesPeriodTotals>;
}

/** Whole-number percentage change, or null when there's nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Short money label for the top of a bar, so neighbouring labels never
 * collide: $8.50, $245, $1.2k, $12k.
 */
export function compactDollars(cents: number): string {
  const dollars = cents / 100;
  if (dollars === 0) return "$0";
  if (dollars < 100) return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
  if (Math.round(dollars) < 1000) return `$${Math.round(dollars)}`;
  if (Math.round(dollars / 100) < 100) return `$${(Math.round(dollars / 100) / 10).toString()}k`;
  return `$${Math.round(dollars / 1000)}k`;
}

export interface SellerRow {
  menuItemId: string;
  name: string;
  category: string;
  units: number;
  revenueCents: number;
}

export const SELLER_WINDOW_DAYS = [7, 30, 90] as const;
export type SellerWindowDays = (typeof SELLER_WINDOW_DAYS)[number];
export type SellerData = Record<SellerWindowDays, SellerRow[]>;

/**
 * Ranks items within each food category: best sellers first (by units,
 * then revenue as the tiebreaker), and separately the items that sold
 * nothing in the window. Pure, so it's tested directly.
 */
export interface CategorySellers {
  category: string;
  top: SellerRow[];
  notSelling: SellerRow[];
  /** Every unit sold in this category in the window (not just the top items). */
  totalUnits: number;
  totalRevenueCents: number;
  /** How many different items in this category sold at least once. */
  soldItemCount: number;
}

export function groupSellersByCategory(rows: SellerRow[], topPerCategory = 3): CategorySellers[] {
  const byCategory = new Map<string, SellerRow[]>();
  for (const row of rows) {
    const list = byCategory.get(row.category) || [];
    list.push(row);
    byCategory.set(row.category, list);
  }
  const result: CategorySellers[] = [];
  for (const [category, items] of byCategory) {
    const sold = items.filter((i) => i.units > 0).sort((a, b) => b.units - a.units || b.revenueCents - a.revenueCents || a.name.localeCompare(b.name));
    const notSelling = items.filter((i) => i.units === 0).sort((a, b) => a.name.localeCompare(b.name));
    result.push({
      category,
      top: sold.slice(0, topPerCategory),
      notSelling,
      totalUnits: sold.reduce((sum, i) => sum + i.units, 0),
      totalRevenueCents: sold.reduce((sum, i) => sum + i.revenueCents, 0),
      soldItemCount: sold.length,
    });
  }
  // Categories with the most sales first; "Other" last.
  return result.sort((a, b) => (a.category === "Other" ? 1 : b.category === "Other" ? -1 : b.totalUnits - a.totalUnits || b.totalRevenueCents - a.totalRevenueCents || a.category.localeCompare(b.category)));
}
