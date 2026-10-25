"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { fetchWebsiteText, extractKnowledgeFromText } from "@/lib/ai/websiteImport";
import type { ActionResult } from "./business";
import type { KnowledgeCategory } from "@/lib/database/types";
import { dbErrorResult } from "@/lib/errors";
import { runAfterResponse } from "@/lib/runtime/afterResponse";
import { scanInstructions } from "@/lib/compliance/checks";
import { normaliseSchedule, normaliseDiscount } from "@/lib/business/promotionInput";

// NOTE: see app/actions/menu.ts — the maxDuration route config for
// slow renders lives on app/dashboard/knowledge/page.tsx instead,
// since a "use server" file can only export async functions.

async function requireBusinessId(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  const businessId = await getCurrentBusinessId();
  if (!businessId) throw new Error("No business found for this account.");
  return businessId;
}

export async function addKnowledgeItemAction(input: { category: KnowledgeCategory; question?: string; title?: string; content: string }): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("knowledge_items").insert({
    business_id: businessId,
    category: input.category,
    question: input.question || null,
    title: input.title || null,
    content: input.content,
  });

  if (error) return dbErrorResult(error, "addKnowledgeItemAction", "Could not save that.");
  runAfterResponse("compliance scan", scanInstructions(businessId));
  revalidatePath("/dashboard/knowledge");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function updateKnowledgeItemAction(id: string, input: { title?: string; content: string }): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  if (!input.content.trim()) return { success: false, error: "Content can't be empty." };

  const admin = createAdminClient();
  // Scoped to this business's own ID, same as delete — a knowledge
  // item ID from another business should never be editable from here.
  const { error } = await admin
    .from("knowledge_items")
    .update({ title: input.title || null, content: input.content })
    .eq("id", id)
    .eq("business_id", businessId);

  if (error) return dbErrorResult(error, "updateKnowledgeItemAction", "Could not save that.");
  runAfterResponse("compliance scan", scanInstructions(businessId));
  revalidatePath("/dashboard/knowledge");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function deleteKnowledgeItemAction(id: string): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("knowledge_items").delete().eq("id", id).eq("business_id", businessId);

  if (error) return dbErrorResult(error, "deleteKnowledgeItemAction", "Could not delete that.");
  revalidatePath("/dashboard/knowledge");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export interface ImportWebsiteResult extends ActionResult {
  itemsAdded?: number;
}

export async function importWebsiteKnowledgeAction(url: string): Promise<ImportWebsiteResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();

  let websiteText: string;
  try {
    websiteText = await fetchWebsiteText(url);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Could not load that website." };
  }

  let items;
  try {
    items = await extractKnowledgeFromText(business?.name || "this business", websiteText);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Could not process that website." };
  }

  if (items.length === 0) return { success: false, error: "Couldn't find any useful content on that page." };

  const rows = items.map((item) => ({ business_id: businessId, category: item.category, question: item.question || null, title: item.title || null, content: item.content }));
  const { error } = await admin.from("knowledge_items").insert(rows);
  if (error) return dbErrorResult(error, "importWebsiteKnowledgeAction", "Could not save the imported items.");
  runAfterResponse("compliance scan", scanInstructions(businessId));

  revalidatePath("/dashboard/knowledge");
  revalidatePath("/dashboard/menu");
  return { success: true, itemsAdded: items.length };
}

/**
 * Same extraction as importWebsiteKnowledgeAction, but skips fetching a
 * URL entirely — takes text the owner pasted in directly. Reliable
 * fallback for any page a URL import can't read (JS-rendered sites
 * without page-rendering configured, pages behind a login, PDFs opened
 * and copied from, etc.) — the owner's own browser already rendered it,
 * so pasting sidesteps the problem completely.
 */
export async function importPastedKnowledgeAction(rawText: string): Promise<ImportWebsiteResult> {
  const text = rawText.trim();
  if (text.length < 20) return { success: false, error: "Paste in some text first." };

  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("name").eq("id", businessId).single();

  let items;
  try {
    items = await extractKnowledgeFromText(business?.name || "this business", text.slice(0, 15000));
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Could not read that text." };
  }

  if (items.length === 0) return { success: false, error: "Couldn't find any useful content in that text." };

  const rows = items.map((item) => ({ business_id: businessId, category: item.category, question: item.question || null, title: item.title || null, content: item.content }));
  const { error } = await admin.from("knowledge_items").insert(rows);
  if (error) return dbErrorResult(error, "importPastedKnowledgeAction", "Could not save the imported items.");
  runAfterResponse("compliance scan", scanInstructions(businessId));

  revalidatePath("/dashboard/knowledge");
  revalidatePath("/dashboard/menu");
  return { success: true, itemsAdded: items.length };
}

export interface AddPromotionInput {
  title: string;
  description: string;
  appliesTo: string;
  startDate: string;
  endDate: string;
  /** 0=Sunday..6=Saturday; empty = every day. */
  days?: number[];
  /** "HH:MM"; both or neither. */
  startTime?: string;
  endTime?: string;
  discountType?: "none" | "percent" | "amount";
  /** Percent as a whole number, or dollars (e.g. "2.50"). */
  discountValue?: string;
  /** Items the discount applies to; empty/omitted = every item. */
  menuItemIds?: string[];
}

export async function addPromotionAction(input: AddPromotionInput): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  if (!input.title.trim()) return { success: false, error: "Give the promotion a title." };
  if (!input.startDate || !input.endDate) return { success: false, error: "Choose a start and end date." };
  if (input.endDate < input.startDate) return { success: false, error: "The end date can't be before the start date." };

  const schedule = normaliseSchedule({ days: input.days || [], startTime: input.startTime || "", endTime: input.endTime || "" });
  if (!schedule.ok) return { success: false, error: schedule.error };
  const discount = normaliseDiscount({ type: input.discountType || "none", value: input.discountValue || "" });
  if (!discount.ok) return { success: false, error: discount.error };

  const admin = createAdminClient();

  // Only items that really belong to this business can be targeted.
  let menuItemIds: string[] | null = null;
  if (discount.type && input.menuItemIds && input.menuItemIds.length > 0) {
    const { data: owned, error: ownedError } = await admin.from("menu_items").select("id").eq("business_id", businessId).in("id", input.menuItemIds);
    if (ownedError) return dbErrorResult(ownedError, "addPromotionAction", "Could not add that promotion.");
    menuItemIds = (owned || []).map((r) => r.id);
    if (menuItemIds.length === 0) return { success: false, error: "Those menu items weren't found." };
  }

  const { error } = await admin.from("promotions").insert({
    business_id: businessId,
    title: input.title.trim(),
    description: input.description,
    applies_to: input.appliesTo || null,
    start_date: input.startDate,
    end_date: input.endDate,
    is_active: true,
    days_of_week: schedule.days,
    start_time: schedule.start,
    end_time: schedule.end,
    discount_type: discount.type,
    discount_value: discount.value,
    menu_item_ids: menuItemIds,
  });

  if (error) return dbErrorResult(error, "addPromotionAction", "Could not add that promotion.");
  revalidatePath("/dashboard/knowledge");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function togglePromotionAction(id: string, isActive: boolean): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("promotions").update({ is_active: isActive }).eq("id", id).eq("business_id", businessId);

  if (error) return dbErrorResult(error, "togglePromotionAction", "Could not update that promotion.");
  revalidatePath("/dashboard/knowledge");
  revalidatePath("/dashboard/menu");
  return { success: true };
}

export async function deletePromotionAction(id: string): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("promotions").delete().eq("id", id).eq("business_id", businessId);

  if (error) return dbErrorResult(error, "deletePromotionAction", "Could not delete that promotion.");
  revalidatePath("/dashboard/knowledge");
  revalidatePath("/dashboard/menu");
  return { success: true };
}
