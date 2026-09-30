import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { mockMenuItems } from "@/lib/mock/data";
import type { DbMenuCategory, DbModifierGroup, DbModifier, MenuItemWithModifiers } from "@/lib/database/types";

export type AddonTemplate = DbModifierGroup & { modifiers: DbModifier[] };

export interface MenuForBusiness {
  categories: DbMenuCategory[];
  items: MenuItemWithModifiers[];
  // The business's reusable add-on library — groups with is_template:
  // true, not tied to any one item. Attached to items via
  // menu_item_modifier_groups (see migration 017).
  addonTemplates: AddonTemplate[];
}

export async function getMenuForBusiness(businessId: string): Promise<MenuForBusiness> {
  if (!isSupabaseConfigured()) return { categories: [], items: mockMenuItems, addonTemplates: [] };
  const supabase = createClient();

  const [categoriesRes, itemsRes, groupsRes, modifiersRes, attachmentsRes] = await Promise.all([
    supabase.from("menu_categories").select("*").eq("business_id", businessId).order("sort_order"),
    supabase.from("menu_items").select("*").eq("business_id", businessId).order("sort_order"),
    supabase.from("modifier_groups").select("*").eq("business_id", businessId).order("sort_order"),
    supabase.from("modifiers").select("*").eq("business_id", businessId).order("sort_order"),
    supabase.from("menu_item_modifier_groups").select("*").eq("business_id", businessId),
  ]);

  const groups = groupsRes.data || [];
  const modifiers = modifiersRes.data || [];
  const attachments = attachmentsRes.data || [];

  const templateGroups = groups.filter((g) => g.is_template);
  const oneOffGroups = groups.filter((g) => !g.is_template);

  const groupWithModifiers = (g: (typeof groups)[number]) => ({ ...g, modifiers: modifiers.filter((m) => m.modifier_group_id === g.id) });

  const items: MenuItemWithModifiers[] = (itemsRes.data || []).map((item) => {
    const ownGroups = oneOffGroups.filter((g) => g.menu_item_id === item.id);
    const attachedTemplateIds = attachments.filter((a) => a.menu_item_id === item.id).map((a) => a.modifier_group_id);
    const attachedTemplates = templateGroups.filter((g) => attachedTemplateIds.includes(g.id));
    return {
      ...item,
      modifier_groups: [...ownGroups, ...attachedTemplates].map(groupWithModifiers),
    };
  });

  return {
    categories: categoriesRes.data || [],
    items,
    addonTemplates: templateGroups.map(groupWithModifiers),
  };
}
