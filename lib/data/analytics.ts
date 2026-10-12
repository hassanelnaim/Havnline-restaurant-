import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

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

async function loadBuckets(businessId: string, unit: SalesUnit, timezone: string): Promise<SalesBucket[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("sales_buckets", {
    p_business_id: businessId,
    p_unit: unit,
    p_tz: timezone,
    p_count: SALES_WINDOWS[unit],
  });
  if (error) throw new Error(`sales_buckets(${unit}) failed: ${error.message}`);
  return ((data || []) as { bucket_local: string; total_cents: number | string; order_count: number | string }[]).map((r) => ({
    local: r.bucket_local,
    totalCents: Number(r.total_cents),
    orders: Number(r.order_count),
  }));
}

/**
 * All four timeframes at once (a handful of rows each), so switching the
 * toggle on the dashboard is instant. Returns null when analytics can't be
 * loaded (not configured, or the database function hasn't been created yet)
 * so the dashboard shows a notice instead of crashing.
 */
export async function getSalesSeries(businessId: string, timezone: string): Promise<SalesSeries | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const [hour, day, week, month] = await Promise.all(SALES_UNITS.map((u) => loadBuckets(businessId, u, timezone)));
    return { hour, day, week, month };
  } catch (err) {
    console.error("getSalesSeries failed:", err);
    return null;
  }
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

async function loadSellers(businessId: string, days: number): Promise<SellerRow[]> {
  const supabase = createClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc("top_sellers", { p_business_id: businessId, p_since: since });
  if (error) throw new Error(`top_sellers(${days}d) failed: ${error.message}`);
  return ((data || []) as { menu_item_id: string; item_name: string; category_name: string; units: number | string; revenue_cents: number | string }[]).map((r) => ({
    menuItemId: r.menu_item_id,
    name: r.item_name,
    category: r.category_name,
    units: Number(r.units),
    revenueCents: Number(r.revenue_cents),
  }));
}

export async function getSellerData(businessId: string): Promise<SellerData | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const [d7, d30, d90] = await Promise.all(SELLER_WINDOW_DAYS.map((d) => loadSellers(businessId, d)));
    return { 7: d7, 30: d30, 90: d90 };
  } catch (err) {
    console.error("getSellerData failed:", err);
    return null;
  }
}

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
