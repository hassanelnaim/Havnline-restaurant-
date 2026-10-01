import { createAdminClient } from "@/lib/supabase/admin";
import { effectivePriceCents } from "@/lib/business/pricing";
import { safeTimezone } from "@/lib/business/timezone";
import type { MenuItemWithModifiers } from "@/lib/database/types";

export interface PricedMenuResult {
  timezone: string;
  menu: MenuItemWithModifiers[];
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

  const [businessRes, itemsRes, groupsRes, modifiersRes, attachmentsRes] = await Promise.all([
    admin.from("businesses").select("timezone").eq("id", businessId).single(),
    admin.from("menu_items").select("*").eq("business_id", businessId).eq("is_active", true).order("sort_order"),
    admin.from("modifier_groups").select("*").eq("business_id", businessId).order("sort_order"),
    admin.from("modifiers").select("*").eq("business_id", businessId).eq("is_active", true).order("sort_order"),
    admin.from("menu_item_modifier_groups").select("*").eq("business_id", businessId),
  ]);

  const timezone = safeTimezone(businessRes.data?.timezone);
  const groups = groupsRes.data || [];
  const allModifiers = modifiersRes.data || [];
  const attachments = attachmentsRes.data || [];
  const templateGroups = groups.filter((g) => g.is_template);
  const oneOffGroups = groups.filter((g) => !g.is_template);

  const menu: MenuItemWithModifiers[] = (itemsRes.data || []).map((item) => {
    const ownGroups = oneOffGroups.filter((g) => g.menu_item_id === item.id);
    const attachedTemplateIds = attachments.filter((a) => a.menu_item_id === item.id).map((a) => a.modifier_group_id);
    const attachedTemplates = templateGroups.filter((g) => attachedTemplateIds.includes(g.id));
    return {
      ...item,
      price_cents: effectivePriceCents(item, timezone),
      modifier_groups: [...ownGroups, ...attachedTemplates].map((g) => ({ ...g, modifiers: allModifiers.filter((m) => m.modifier_group_id === g.id) })),
    };
  });

  return { timezone, menu };
}
