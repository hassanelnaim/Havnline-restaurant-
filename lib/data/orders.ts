import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { mockOrders } from "@/lib/mock/data";
import type { OrderWithItems } from "@/lib/database/types";
import { localDateKey, localDayBoundsUtc } from "@/lib/format";

export async function getOrdersForBusiness(businessId: string, limit = 100): Promise<OrderWithItems[]> {
  if (!isSupabaseConfigured()) return mockOrders;
  const supabase = createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("*")
    .eq("business_id", businessId)
    .neq("status", "building") // building = still in progress on a live call, not a real order yet
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const { data: items } = await supabase.from("order_items").select("*").in("order_id", orderIds);
  const itemIds = (items || []).map((i) => i.id);
  const { data: modifiers } = itemIds.length
    ? await supabase.from("order_item_modifiers").select("*").in("order_item_id", itemIds)
    : { data: [] };

  return orders.map((order) => ({
    ...order,
    items: (items || [])
      .filter((i) => i.order_id === order.id)
      .map((i) => ({ ...i, modifiers: (modifiers || []).filter((m) => m.order_item_id === i.id) })),
  }));
}

/**
 * Just enough of each order to total up revenue over a rolling window
 * (Overview's "this week" stats) — not the full items/modifiers
 * getOrdersForBusiness fetches, and not capped at 100 rows the way
 * that is, since a busy week can legitimately have more orders than
 * that and this still needs every one of them to total correctly.
 */
export async function getOrderTotalsSince(
  businessId: string,
  sinceIso: string
): Promise<{ status: string; payment_status: string; total_cents: number }[]> {
  if (!isSupabaseConfigured()) {
    return mockOrders
      .filter((o) => o.created_at >= sinceIso)
      .map((o) => ({ status: o.status, payment_status: o.payment_status, total_cents: o.total_cents }));
  }
  const supabase = createClient();
  const { data } = await supabase
    .from("orders")
    .select("status, payment_status, total_cents")
    .eq("business_id", businessId)
    .neq("status", "building")
    .gte("created_at", sinceIso);
  return data || [];
}

/**
 * All of a business's orders for one calendar day, in the business's
 * own timezone — for an end-of-day report on any past day, not just
 * "today." getOrdersForBusiness above only ever sees its most recent
 * 100 orders, so filtering that in memory silently gives wrong/empty
 * results for a day further back than that — this queries the actual
 * date range in the DB instead, using localDayBoundsUtc to convert
 * the business's local calendar day into the right UTC instant range.
 */
export async function getOrdersForDate(businessId: string, dateKey: string, timezone: string): Promise<OrderWithItems[]> {
  if (!isSupabaseConfigured()) {
    return mockOrders.filter((o) => localDateKey(o.created_at, timezone) === dateKey);
  }

  const supabase = createClient();
  const { startIso, endIso } = localDayBoundsUtc(dateKey, timezone);

  const { data: orders } = await supabase
    .from("orders")
    .select("*")
    .eq("business_id", businessId)
    .neq("status", "building") // building = still in progress on a live call, not a real order yet
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: true });

  if (!orders || orders.length === 0) return [];

  const orderIds = orders.map((o) => o.id);
  const { data: items } = await supabase.from("order_items").select("*").in("order_id", orderIds);
  const itemIds = (items || []).map((i) => i.id);
  const { data: modifiers } = itemIds.length
    ? await supabase.from("order_item_modifiers").select("*").in("order_item_id", itemIds)
    : { data: [] };

  return orders.map((order) => ({
    ...order,
    items: (items || [])
      .filter((i) => i.order_id === order.id)
      .map((i) => ({ ...i, modifiers: (modifiers || []).filter((m) => m.order_item_id === i.id) })),
  }));
}

export async function getOrderWithItems(orderId: string): Promise<OrderWithItems | null> {
  if (!isSupabaseConfigured()) return mockOrders.find((o) => o.id === orderId) || null;
  const supabase = createClient();
  const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).single();
  if (!order) return null;

  const { data: items } = await supabase.from("order_items").select("*").eq("order_id", orderId);
  const itemIds = (items || []).map((i) => i.id);
  const { data: modifiers } = itemIds.length
    ? await supabase.from("order_item_modifiers").select("*").in("order_item_id", itemIds)
    : { data: [] };

  return {
    ...order,
    items: (items || []).map((i) => ({ ...i, modifiers: (modifiers || []).filter((m) => m.order_item_id === i.id) })),
  };
}
