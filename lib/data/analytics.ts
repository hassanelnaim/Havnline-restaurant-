import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { SALES_UNITS, SALES_WINDOWS, SELLER_WINDOW_DAYS } from "@/lib/analytics/shared";
import type { SalesBucket, SalesData, SalesPeriodTotals, SalesUnit, SellerData, SellerRow } from "@/lib/analytics/shared";

// Twice the visible window: the newer half is drawn, the older half is the
// "previous" stretch the total is compared against. (The database function
// accepts up to 60 periods; the largest request here is 48 hours.)
async function loadBuckets(businessId: string, unit: SalesUnit, timezone: string): Promise<{ current: SalesBucket[]; previous: SalesPeriodTotals }> {
  const supabase = await createClient();
  const count = SALES_WINDOWS[unit];
  const { data, error } = await supabase.rpc("sales_buckets", {
    p_business_id: businessId,
    p_unit: unit,
    p_tz: timezone,
    p_count: count * 2,
  });
  if (error) throw new Error(`sales_buckets(${unit}) failed: ${error.message}`);
  const all = ((data || []) as { bucket_local: string; total_cents: number | string; order_count: number | string }[])
    .map((r) => ({ local: r.bucket_local, totalCents: Number(r.total_cents), orders: Number(r.order_count) }))
    .sort((a, b) => (a.local < b.local ? -1 : a.local > b.local ? 1 : 0));
  const current = all.slice(-count);
  const older = all.slice(0, Math.max(0, all.length - count));
  return {
    current,
    previous: { totalCents: older.reduce((s, b) => s + b.totalCents, 0), orders: older.reduce((s, b) => s + b.orders, 0) },
  };
}

/**
 * All four timeframes at once (a handful of rows each), so switching the
 * toggle on the dashboard is instant. Returns null when analytics can't be
 * loaded (not configured, or the database function hasn't been created yet)
 * so the dashboard shows a notice instead of crashing.
 */
export async function getSalesSeries(businessId: string, timezone: string): Promise<SalesData | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const [hour, day, week, month] = await Promise.all(SALES_UNITS.map((u) => loadBuckets(businessId, u, timezone)));
    return {
      series: { hour: hour.current, day: day.current, week: week.current, month: month.current },
      previous: { hour: hour.previous, day: day.previous, week: week.previous, month: month.previous },
    };
  } catch (err) {
    console.error("getSalesSeries failed:", err);
    return null;
  }
}

async function loadSellers(businessId: string, days: number): Promise<SellerRow[]> {
  const supabase = await createClient();
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
