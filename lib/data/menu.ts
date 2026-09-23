import { createClient } from "@/lib/supabase/server";
import type { DbMenuCategory, MenuItemWithModifiers } from "@/lib/database/types";

export async function getMenuForBusiness(businessId: string): Promise<{ categories: DbMenuCategory[]; items: MenuItemWithModifiers[] }> {
  const supabase = createClient();

  const [categoriesRes, itemsRes, groupsRes, modifiersRes] = await Promise.all([
    supabase.from("menu_categories").select("*").eq("business_id", businessId).order("sort_order"),
    supabase.from("menu_items").select("*").eq("business_id", businessId).order("sort_order"),
    supabase.from("modifier_groups").select("*").eq("business_id", businessId).order("sort_order"),
    supabase.from("modifiers").select("*").eq("business_id", businessId).order("sort_order"),
  ]);

  const groups = groupsRes.data || [];
  const modifiers = modifiersRes.data || [];

  const items: MenuItemWithModifiers[] = (itemsRes.data || []).map((item) => ({
    ...item,
    modifier_groups: groups
      .filter((g) => g.menu_item_id === item.id)
      .map((g) => ({ ...g, modifiers: modifiers.filter((m) => m.modifier_group_id === g.id) })),
  }));

  return { categories: categoriesRes.data || [], items };
}
