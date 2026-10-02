import { createAdminClient } from "@/lib/supabase/admin";
import { effectivePriceCents } from "@/lib/business/pricing";
import { safeTimezone } from "@/lib/business/timezone";
import type { MenuItemWithModifiers } from "@/lib/database/types";

// category_name is resolved here (a join the base DbMenuItem row
// doesn't carry) specifically for the tablet's Add Item category tabs
// (printer-app/src/components/AddItemModal.tsx) — the dashboard's own
// menu management page groups items by category_id directly against
// already-loaded category data, so it never needed this on the type.
export type PricedMenuItem = MenuItemWithModifiers & { category_name: string | null };

export interface PricedMenuResult {
  timezone: string;
  menu: PricedMenuItem[];
}

/**
 * The live menu for a business with every item's price_cents already
 * resolved to what it actually costs RIGHT NOW (time-based specials
 * included — see effectivePriceCents). Shared by GET
 * /api/printer-app/menu (the tablet's own menu sync) and POST
 * /api/printer-app/today-orders/[id]/items (Phase 4's item-add
 * validation, which needs the real current price to charge or comp
 * against) so both agree on exactly what "the menu" means at this
 * moment — pulled out of the menu route rather than duplicated once
 * Phase 4 needed the same query a second time.
 */
export async function loadPricedMenu(businessId: string): Promise<PricedMenuResult> {
  const admin = createAdminClient();

  const [businessRes, itemsRes, groupsRes, modifiersRes, attachmentsRes, categoriesRes] = await Promise.all([
    admin.from("businesses").select("timezone").eq("id", businessId).single(),
    admin.from("menu_items").select("*").eq("business_id", businessId).eq("is_active", true).order("sort_order"),
    admin.from("modifier_groups").select("*").eq("business_id", businessId).order("sort_order"),
    admin.from("modifiers").select("*").eq("business_id", businessId).eq("is_active", true).order("sort_order"),
    admin.from("menu_item_modifier_groups").select("*").eq("business_id", businessId),
    admin.from("menu_categories").select("id, name").eq("business_id", businessId),
  ]);

  const timezone = safeTimezone(businessRes.data?.timezone);
  const groups = groupsRes.data || [];
  const allModifiers = modifiersRes.data || [];
  const attachments = attachmentsRes.data || [];
  const templateGroups = groups.filter((g) => g.is_template);
  const oneOffGroups = groups.filter((g) => !g.is_template);
  const categoryNameById = new Map((categoriesRes.data || []).map((c) => [c.id, c.name]));

  const menu: PricedMenuItem[] = (itemsRes.data || []).map((item) => {
    const ownGroups = oneOffGroups.filter((g) => g.menu_item_id === item.id);
    const attachedTemplateIds = attachments.filter((a) => a.menu_item_id === item.id).map((a) => a.modifier_group_id);
    const attachedTemplates = templateGroups.filter((g) => attachedTemplateIds.includes(g.id));
    return {
      ...item,
      price_cents: effectivePriceCents(item, timezone),
      category_name: (item.category_id && categoryNameById.get(item.category_id)) || null,
      modifier_groups: [...ownGroups, ...attachedTemplates].map((g) => ({ ...g, modifiers: allModifiers.filter((m) => m.modifier_group_id === g.id) })),
    };
  });

  return { timezone, menu };
}
