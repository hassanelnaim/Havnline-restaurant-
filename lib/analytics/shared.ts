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
    result.push({ category, top: sold.slice(0, topPerCategory), notSelling });
  }
  // Categories with the most sales first; "Other" last.
  const total = (c: CategorySellers) => c.top.reduce((s, i) => s + i.units, 0);
  return result.sort((a, b) => (a.category === "Other" ? 1 : b.category === "Other" ? -1 : total(b) - total(a) || a.category.localeCompare(b.category)));
}
