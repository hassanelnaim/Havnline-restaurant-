import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateDevice } from "@/lib/integrations/printer-app";
import { dbErrorResult } from "@/lib/errors";
import { effectivePriceCents } from "@/lib/business/pricing";
import { safeTimezone } from "@/lib/business/timezone";
import type { MenuItemWithModifiers } from "@/lib/database/types";

export const dynamic = "force-dynamic";

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/**
 * GET /api/printer-app/menu
 *
 * Read-only menu + modifier data for the tablet's upcoming item-picker
 * UI (adding items to an in-progress order — a later phase). Device-
 * token only, no PIN: this is menu data, not money movement, and every
 * other read endpoint here (GET /api/printer-app/orders) already
 * trusts the device token alone. Mirrors the exact shape
 * lib/ai/context.ts's loadBusinessContext builds for the AI's own
 * system prompt — one-off modifier groups plus shared add-on
 * templates attached via menu_item_modifier_groups, merged into a
 * single list the tablet doesn't need to know the mechanism behind.
 */
export async function GET(request: NextRequest) {
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });

  const admin = createAdminClient();

  const [businessRes, itemsRes, groupsRes, modifiersRes, attachmentsRes] = await Promise.all([
    admin.from("businesses").select("timezone").eq("id", device.businessId).single(),
    admin.from("menu_items").select("*").eq("business_id", device.businessId).eq("is_active", true).order("sort_order"),
    admin.from("modifier_groups").select("*").eq("business_id", device.businessId).order("sort_order"),
    admin.from("modifiers").select("*").eq("business_id", device.businessId).eq("is_active", true).order("sort_order"),
    admin.from("menu_item_modifier_groups").select("*").eq("business_id", device.businessId),
  ]);

  if (itemsRes.error) return NextResponse.json(dbErrorResult(itemsRes.error, "printer-app/menu GET", "Could not fetch the menu."), { status: 500 });

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
      // The tablet needs the price that's actually correct RIGHT NOW
      // (time-based specials included) since it has no scheduling
      // logic of its own — same reasoning as the AI's system prompt.
      price_cents: effectivePriceCents(item, timezone),
      modifier_groups: [...ownGroups, ...attachedTemplates].map((g) => ({ ...g, modifiers: allModifiers.filter((m) => m.modifier_group_id === g.id) })),
    };
  });

  return NextResponse.json({ success: true, menu });
}
