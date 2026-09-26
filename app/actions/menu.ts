"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { extractMenuItemsFromImage, extractMenuItemsFromText, fetchWebsiteText } from "@/lib/ai/websiteImport";
import type { ExtractedMenuItem } from "@/lib/ai/websiteImport";

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
  if (error) return { success: false, error: error.message };
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
  if (error) return { success: false, error: error.message };
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

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function toggleMenuItemActiveAction(itemId: string, isActive: boolean): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const { error } = await admin.from("menu_items").update({ is_active: isActive }).eq("id", itemId).eq("business_id", businessId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function deleteMenuItemAction(itemId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const { error } = await admin.from("menu_items").delete().eq("id", itemId).eq("business_id", businessId);
  if (error) return { success: false, error: error.message };
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

  const { data: group, error: groupError } = await admin
    .from("modifier_groups")
    .insert({ business_id: businessId, menu_item_id: menuItemId, name: input.name, is_required: input.required, min_select: input.minSelect, max_select: input.maxSelect })
    .select("id")
    .single();
  if (groupError || !group) return { success: false, error: groupError?.message || "Could not add modifier group." };

  const optionRows = input.options.filter((o) => o.name.trim()).map((o) => ({
    business_id: businessId,
    modifier_group_id: group.id,
    name: o.name,
    price_delta_cents: Math.round((parseFloat(o.priceDelta) || 0) * 100),
  }));
  if (optionRows.length > 0) {
    const { error: optionsError } = await admin.from("modifiers").insert(optionRows);
    if (optionsError) return { success: false, error: optionsError.message };
  }

  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function deleteModifierGroupAction(groupId: string): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const { error } = await admin.from("modifier_groups").delete().eq("id", groupId).eq("business_id", businessId);
  if (error) return { success: false, error: error.message };
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
    // TEMPORARY diagnostic logging — visible in Vercel's function logs.
    // A 200-status render that still finds "0 items" could mean either
    // (a) the page loaded a gate screen (a location/table confirmation,
    // cookie banner, etc.) instead of the real menu, or (b) it got real
    // content but the extraction model didn't recognize it as a menu.
    // This line tells us which, instead of guessing.
    console.log(`[menu-import] fetched ${text.length} chars from ${url}. Preview: ${text.slice(0, 500)}`);
    const items = await extractMenuItemsFromText(business?.name || "this restaurant", text);
    console.log(`[menu-import] extraction found ${items.length} items.`);
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
 * (SpotOn online ordering, Toast, ChowNow, Squarespace/Wix sites, and
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

// Called only after the owner has reviewed/edited the staged items in
// the UI — this is the one function that actually writes real,
// orderable menu rows.
export async function importMenuItemsAction(items: ExtractedMenuItem[]): Promise<ActionResult> {
  if (!isSupabaseConfigured()) return { success: false, error: "Not configured." };
  const businessId = await requireBusinessId();
  const admin = createAdminClient();
  const categoryIdByName = new Map<string, string>();

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
          if (error) return { success: false, error: error.message };
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
    if (itemError) return { success: false, error: itemError.message };

    for (const group of item.modifierGroups) {
      if (!group.name.trim()) continue;
      const { data: modifierGroup, error: groupError } = await admin
        .from("modifier_groups")
        .insert({ business_id: businessId, menu_item_id: menuItem.id, name: group.name, is_required: group.required, min_select: group.required ? 1 : 0, max_select: 1 })
        .select("id")
        .single();
      if (groupError) return { success: false, error: groupError.message };

      const optionRows = group.options.filter((o) => o.name.trim()).map((o) => ({
        business_id: businessId,
        modifier_group_id: modifierGroup.id,
        name: o.name,
        price_delta_cents: Math.round((parseFloat(o.priceDeltaDollars) || 0) * 100),
      }));
      if (optionRows.length > 0) {
        const { error: optionsError } = await admin.from("modifiers").insert(optionRows);
        if (optionsError) return { success: false, error: optionsError.message };
      }
    }
  }

  revalidatePath("/dashboard/menu");
  return { success: true };
}
