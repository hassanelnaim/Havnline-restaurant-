"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { extractMenuItemsFromImage, extractMenuItemsFromText, fetchWebsiteText } from "@/lib/ai/websiteImport";
import type { ExtractedMenuItem } from "@/lib/ai/websiteImport";
import { dbErrorResult } from "@/lib/errors";

// NOTE: rendering a JS-heavy page (with a stealth-proxy retry if the
// first attempt is blocked) can take 20-40+ seconds — well past
// Vercel's default function timeout. A "use server" file can only
// export async functions, so the `maxDuration` route config for this
// has to live on the *page* that calls these actions instead. See
// app/dashboard/menu/page.tsx.

export interface ActionResult {
  success: boolean;
  error?: string;
}

async function requireBusinessId(): Promise<string> {
  const businessId = await getCurrentBusinessId();
  if (!businessId) throw new Error("Not signed in.");
  return businessId;
}

export async function addMenuCategoryAction(name: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const { error } = await admin.from("menu_categories").insert({ business_id: businessId, name });
  if (error) return dbErrorResult(error, "addMenuCategoryAction", "Could not add that category.");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export interface MenuItemInput {
  name: string;
  description: string;
  price: string;
  categoryId: string | null;
}

export async function addMenuItemAction(input: MenuItemInput): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();

  const { error } = await admin.from("menu_items").insert({
    business_id: businessId,
    category_id: input.categoryId,
    name: input.name,
    description: input.description || null,
    price_cents: Math.round((parseFloat(input.price) || 0) * 100),
    source: "manual",
  });
  if (error) return dbErrorResult(error, "addMenuItemAction", "Could not add that item.");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function updateMenuItemAction(itemId: string, input: MenuItemInput): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();

  const { error } = await admin
    .from("menu_items")
    .update({
      category_id: input.categoryId,
      name: input.name,
      description: input.description || null,
      price_cents: Math.round((parseFloat(input.price) || 0) * 100),
    })
    .eq("id", itemId)
    .eq("business_id", businessId); // IDOR-safe: scoped to this business, never trusted from the client alone

  if (error) return dbErrorResult(error, "updateMenuItemAction", "Could not save that item.");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export interface TimePricingInput {
  specialPrice: string; // dollars, e.g. "9.99" — empty/invalid clears time pricing
  startTime: string; // "HH:MM", 24h
  endTime: string; // "HH:MM", 24h
}

/**
 * Sets or clears an item's time-based price (e.g. a Breakfast Special
 * that's $9.99 from 7:00-11:00am and price_cents the rest of the day).
 * All three fields are required together — passing an empty
 * specialPrice (or missing either time) clears time pricing entirely,
 * so the item just goes back to always using price_cents, same as any
 * item that never had this set.
 */
export async function updateMenuItemTimePricingAction(itemId: string, input: TimePricingInput): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();

  const specialPriceCents = input.specialPrice.trim() ? Math.round(parseFloat(input.specialPrice) * 100) : null;
  const hasWindow = specialPriceCents != null && Number.isFinite(specialPriceCents) && input.startTime && input.endTime;

  const { error } = await admin
    .from("menu_items")
    .update({
      special_price_cents: hasWindow ? specialPriceCents : null,
      special_price_start_time: hasWindow ? input.startTime : null,
      special_price_end_time: hasWindow ? input.endTime : null,
    })
    .eq("id", itemId)
    .eq("business_id", businessId);

  if (error) return dbErrorResult(error, "updateMenuItemTimePricingAction", "Could not save that price.");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function toggleMenuItemActiveAction(itemId: string, isActive: boolean): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const { error } = await admin.from("menu_items").update({ is_active: isActive }).eq("id", itemId).eq("business_id", businessId);
  if (error) return dbErrorResult(error, "toggleMenuItemActiveAction", "Could not update that item.");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function deleteMenuItemAction(itemId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const { error } = await admin.from("menu_items").delete().eq("id", itemId).eq("business_id", businessId);
  if (error) return dbErrorResult(error, "deleteMenuItemAction", "Could not delete that item.");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export interface ModifierGroupInput {
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: { name: string; priceDelta: string }[];
}

export async function addModifierGroupAction(menuItemId: string, input: ModifierGroupInput): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();

  // menuItemId isn't trustworthy on its own coming from the client —
  // same check attachAddonTemplateAction already does below.
  const { data: item } = await admin.from("menu_items").select("id").eq("id", menuItemId).eq("business_id", businessId).maybeSingle();
  if (!item) return { success: false, error: "Could not find that item." };

  const { data: group, error: groupError } = await admin
    .from("modifier_groups")
    .insert({ business_id: businessId, menu_item_id: menuItemId, name: input.name, is_required: input.required, min_select: input.minSelect, max_select: input.maxSelect })
    .select("id")
    .single();
  if (groupError || !group) return dbErrorResult(groupError, "addModifierGroupAction", "Could not add that add-on group.");

  const optionRows = input.options.filter((o) => o.name.trim()).map((o) => ({
    business_id: businessId,
    modifier_group_id: group.id,
    name: o.name,
    price_delta_cents: Math.round((parseFloat(o.priceDelta) || 0) * 100),
  }));
  if (optionRows.length > 0) {
    const { error: optionsError } = await admin.from("modifiers").insert(optionRows);
    if (optionsError) return dbErrorResult(optionsError, "addModifierGroupAction:options", "Could not add those options.");
  }

  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function deleteModifierGroupAction(groupId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const { error } = await admin.from("modifier_groups").delete().eq("id", groupId).eq("business_id", businessId);
  if (error) return dbErrorResult(error, "deleteModifierGroupAction", "Could not delete that add-on group.");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

// --------------------------------------------------------------------------
// Shared add-on library. A template is a modifier_groups row with
// menu_item_id: null, is_template: true — same table as the existing
// per-item ("one-off") groups above, just not tied to any single item.
// Attaching one to an item writes a row in menu_item_modifier_groups
// (migration 017) instead of duplicating the group; editing a
// template's name/options here updates it everywhere it's attached.
// --------------------------------------------------------------------------

export async function createAddonTemplateAction(input: ModifierGroupInput): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();

  const { data: group, error: groupError } = await admin
    .from("modifier_groups")
    .insert({ business_id: businessId, menu_item_id: null, is_template: true, name: input.name, is_required: input.required, min_select: input.minSelect, max_select: input.maxSelect })
    .select("id")
    .single();
  if (groupError || !group) return dbErrorResult(groupError, "createAddonTemplateAction", "Could not create that add-on group.");

  const optionRows = input.options.filter((o) => o.name.trim()).map((o) => ({
    business_id: businessId,
    modifier_group_id: group.id,
    name: o.name,
    price_delta_cents: Math.round((parseFloat(o.priceDelta) || 0) * 100),
  }));
  if (optionRows.length > 0) {
    const { error: optionsError } = await admin.from("modifiers").insert(optionRows);
    if (optionsError) return dbErrorResult(optionsError, "createAddonTemplateAction:options", "Could not add those options.");
  }

  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function renameAddonTemplateAction(templateId: string, name: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const { error } = await admin.from("modifier_groups").update({ name }).eq("id", templateId).eq("business_id", businessId).eq("is_template", true);
  if (error) return dbErrorResult(error, "renameAddonTemplateAction", "Could not rename that add-on group.");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function addAddonTemplateOptionAction(templateId: string, name: string, priceDelta: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  if (!name.trim()) return { success: false, error: "Option name is required." };

  // Confirm this template actually belongs to this business before
  // attaching an option to it — modifiers rows aren't otherwise scoped
  // by anything the client passed.
  const { data: template } = await admin.from("modifier_groups").select("id").eq("id", templateId).eq("business_id", businessId).eq("is_template", true).maybeSingle();
  if (!template) return { success: false, error: "That add-on group doesn't exist." };

  const { error } = await admin.from("modifiers").insert({
    business_id: businessId,
    modifier_group_id: templateId,
    name,
    price_delta_cents: Math.round((parseFloat(priceDelta) || 0) * 100),
  });
  if (error) return dbErrorResult(error, "addAddonTemplateOptionAction", "Could not add that option.");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function deleteAddonOptionAction(modifierId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const { error } = await admin.from("modifiers").delete().eq("id", modifierId).eq("business_id", businessId);
  if (error) return dbErrorResult(error, "deleteAddonOptionAction", "Could not delete that option.");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function deleteAddonTemplateAction(templateId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const { error } = await admin.from("modifier_groups").delete().eq("id", templateId).eq("business_id", businessId).eq("is_template", true);
  if (error) return dbErrorResult(error, "deleteAddonTemplateAction", "Could not delete that add-on group.");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function attachAddonTemplateAction(menuItemId: string, templateId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();

  // Both rows must actually belong to this business — neither id is
  // trustworthy on its own coming from the client.
  const [{ data: item }, { data: template }] = await Promise.all([
    admin.from("menu_items").select("id").eq("id", menuItemId).eq("business_id", businessId).maybeSingle(),
    admin.from("modifier_groups").select("id").eq("id", templateId).eq("business_id", businessId).eq("is_template", true).maybeSingle(),
  ]);
  if (!item || !template) return { success: false, error: "Could not find that item or add-on group." };

  const { error } = await admin.from("menu_item_modifier_groups").upsert(
    { business_id: businessId, menu_item_id: menuItemId, modifier_group_id: templateId },
    { onConflict: "menu_item_id,modifier_group_id", ignoreDuplicates: true }
  );
  if (error) return dbErrorResult(error, "attachAddonTemplateAction", "Could not attach that add-on group.");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function detachAddonTemplateAction(menuItemId: string, templateId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const { error } = await admin
    .from("menu_item_modifier_groups")
    .delete()
    .eq("business_id", businessId)
    .eq("menu_item_id", menuItemId)
    .eq("modifier_group_id", templateId);
  if (error) return dbErrorResult(error, "detachAddonTemplateAction", "Could not remove that add-on group.");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

// --------------------------------------------------------------------------
// Menu import — website text or a photo. Both return STAGED items only;
// nothing here writes to menu_items directly. The caller (a client
// component) shows these to the owner to review, edit, and confirm
// before importMenuItemsAction actually creates them — an AI misread
// price served as fact would be a real billing error for a customer.
// --------------------------------------------------------------------------

export async function extractMenuFromWebsiteAction(url: string): Promise<{ success: boolean; items?: ExtractedMenuItem[]; error?: string }> {
  try {
    const businessId = await requireBusinessId();
    const admin = createAdminClient();
    const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();
    const text = await fetchWebsiteText(url);
    console.log(`[menu-import] fetched ${text.length} chars from ${url}. Preview: ${text.slice(0, 500)}`);
    const items = await extractMenuItemsFromText(business?.name || "this restaurant", text);
    console.log(`[menu-import] extraction found ${items.length} items.`);

    // TEMPORARY diagnostic: surfaced directly in the app (not just
    // Vercel's logs) so a "0 items" result shows exactly what was
    // actually read from the page, right on screen. A 200-status
    // render that still finds nothing could mean either (a) the page
    // loaded a gate screen (a location/table confirmation, cookie
    // banner) instead of the real menu, or (b) it got real content but
    // the extraction model didn't recognize it as a menu — this makes
    // that visible without hunting through logs.
    if (items.length === 0) {
      return {
        success: false,
        error: `Fetched ${text.length} characters from that page, but didn't find anything that looked like a menu in it. Here's the start of what was actually read: "${text.slice(0, 300)}"`,
      };
    }

    return { success: true, items };
  } catch (err) {
    console.error(`[menu-import] failed for ${url}:`, err);
    return { success: false, error: err instanceof Error ? err.message : "Could not import from that website." };
  }
}

/**
 * Same extraction as extractMenuFromWebsiteAction, but skips fetching
 * a URL entirely — takes menu text the owner pasted in directly. This
 * is the reliable fallback for any menu page that's a JavaScript app
 * (Toast, ChowNow, Squarespace/Wix sites, and
 * plenty of others): a plain server-side fetch only ever sees the
 * empty page shell before JS renders the real content, so those pages
 * always fail the URL importer with "no items found" — not a bug in
 * the fetch, just a fundamental limitation of fetching without
 * running JavaScript. The owner's own browser *does* run it, so
 * copy-pasting the rendered text (including into individual items for
 * modifiers/addons) sidesteps the problem completely.
 */
export async function extractMenuFromTextAction(rawText: string): Promise<{ success: boolean; items?: ExtractedMenuItem[]; error?: string }> {
  const text = rawText.trim();
  if (text.length < 20) return { success: false, error: "Paste in some menu text first." };

  try {
    const businessId = await requireBusinessId();
    const admin = createAdminClient();
    const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();
    const items = await extractMenuItemsFromText(business?.name || "this restaurant", text.slice(0, 15000));
    return { success: true, items };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Could not read that text." };
  }
}

export async function extractMenuFromImageAction(imageBase64: string, mediaType: "image/jpeg" | "image/png" | "image/webp"): Promise<{ success: boolean; items?: ExtractedMenuItem[]; error?: string }> {
  try {
    const businessId = await requireBusinessId();
    const admin = createAdminClient();
    const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();
    const items = await extractMenuItemsFromImage(business?.name || "this restaurant", imageBase64, mediaType);
    return { success: true, items };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Could not read that image." };
  }
}

// An add-on group's "identity" for deciding whether two items' groups
// are really the same add-on — same name, same required-ness, same
// options (and prices). Order-independent (options are sorted) so it
// doesn't matter what order the extraction model listed them in.
function modifierGroupSignature(group: ExtractedMenuItem["modifierGroups"][number]): string {
  const normalizedOptions = group.options
    .map((o) => `${o.name.trim().toLowerCase()}:${(parseFloat(o.priceDeltaDollars) || 0).toFixed(2)}`)
    .sort()
    .join("|");
  return `${group.name.trim().toLowerCase()}::${group.required}::${normalizedOptions}`;
}

// Called only after the owner has reviewed/edited the staged items in
// the UI — this is the one function that actually writes real,
// orderable menu rows.
//
// An add-on group that comes back byte-for-byte identical (same name,
// same required flag, same options/prices) across 2+ items in this one
// import is almost certainly the same real add-on — most menus reuse
// the same "Size" or "Toppings" choices across many items. Those
// become ONE shared add-ons-library template (see migration 017),
// attached to every item that has it, instead of a separate copy per
// item — so the owner doesn't have to manually rebuild the library
// after every import. A group that only shows up once stays a one-off
// tied directly to that item, exactly as before.
export async function importMenuItemsAction(items: ExtractedMenuItem[]): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const categoryIdByName = new Map<string, string>();

  const signatureCounts = new Map<string, number>();
  for (const item of items) {
    for (const group of item.modifierGroups) {
      if (!group.name.trim()) continue;
      const sig = modifierGroupSignature(group);
      signatureCounts.set(sig, (signatureCounts.get(sig) || 0) + 1);
    }
  }
  const templateIdBySignature = new Map<string, string>();

  for (const item of items) {
    if (!item.name.trim()) continue;

    let categoryId: string | null = null;
    const categoryName = item.category.trim();
    if (categoryName) {
      if (categoryIdByName.has(categoryName)) {
        categoryId = categoryIdByName.get(categoryName)!;
      } else {
        const { data: existing } = await admin.from("menu_categories").select("id").eq("business_id", businessId).eq("name", categoryName).maybeSingle();
        if (existing) {
          categoryId = existing.id;
        } else {
          const { data: created, error } = await admin.from("menu_categories").insert({ business_id: businessId, name: categoryName }).select("id").single();
          if (error) return dbErrorResult(error, "importMenuItemsAction:category", "Could not import the menu.");
          categoryId = created.id;
        }
        categoryIdByName.set(categoryName, categoryId!);
      }
    }

    const { data: menuItem, error: itemError } = await admin
      .from("menu_items")
      .insert({
        business_id: businessId,
        category_id: categoryId,
        name: item.name,
        description: item.description || null,
        price_cents: Math.round((parseFloat(item.priceDollars) || 0) * 100),
        source: "import",
      })
      .select("id")
      .single();
    if (itemError) return dbErrorResult(itemError, "importMenuItemsAction:item", "Could not import the menu.");

    for (const group of item.modifierGroups) {
      if (!group.name.trim()) continue;
      const sig = modifierGroupSignature(group);
      const isShared = (signatureCounts.get(sig) || 0) > 1;

      if (isShared) {
        const existingTemplateId: string | undefined = templateIdBySignature.get(sig);
        let templateId: string;
        if (existingTemplateId) {
          templateId = existingTemplateId;
        } else {
          const { data: templateGroup, error: templateError } = await admin
            .from("modifier_groups")
            .insert({ business_id: businessId, menu_item_id: null, is_template: true, name: group.name, is_required: group.required, min_select: group.required ? 1 : 0, max_select: 1 })
            .select("id")
            .single();
          if (templateError || !templateGroup) return dbErrorResult(templateError, "importMenuItemsAction:template", "Could not create a shared add-on group.");
          templateId = templateGroup.id as string;
          templateIdBySignature.set(sig, templateId);

          const optionRows = group.options.filter((o) => o.name.trim()).map((o) => ({
            business_id: businessId,
            modifier_group_id: templateId,
            name: o.name,
            price_delta_cents: Math.round((parseFloat(o.priceDeltaDollars) || 0) * 100),
          }));
          if (optionRows.length > 0) {
            const { error: optionsError } = await admin.from("modifiers").insert(optionRows);
            if (optionsError) return dbErrorResult(optionsError, "importMenuItemsAction:template-options", "Could not import the menu.");
          }
        }

        const { error: attachError } = await admin.from("menu_item_modifier_groups").upsert(
          { business_id: businessId, menu_item_id: menuItem.id, modifier_group_id: templateId },
          { onConflict: "menu_item_id,modifier_group_id", ignoreDuplicates: true }
        );
        if (attachError) return dbErrorResult(attachError, "importMenuItemsAction:attach", "Could not import the menu.");
        continue;
      }

      const { data: modifierGroup, error: groupError } = await admin
        .from("modifier_groups")
        .insert({ business_id: businessId, menu_item_id: menuItem.id, is_template: false, name: group.name, is_required: group.required, min_select: group.required ? 1 : 0, max_select: 1 })
        .select("id")
        .single();
      if (groupError) return dbErrorResult(groupError, "importMenuItemsAction:group", "Could not import the menu.");

      const optionRows = group.options.filter((o) => o.name.trim()).map((o) => ({
        business_id: businessId,
        modifier_group_id: modifierGroup.id,
        name: o.name,
        price_delta_cents: Math.round((parseFloat(o.priceDeltaDollars) || 0) * 100),
      }));
      if (optionRows.length > 0) {
        const { error: optionsError } = await admin.from("modifiers").insert(optionRows);
        if (optionsError) return dbErrorResult(optionsError, "importMenuItemsAction:options", "Could not import the menu.");
      }
    }
  }

  revalidatePath("/dashboard/menu");
  return { success: true };
}
