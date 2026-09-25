import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { mockOrders } from "@/lib/mock/data";
import type { OrderWithItems } from "@/lib/database/types";

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
