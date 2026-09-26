"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { fetchWebsiteText, extractKnowledgeFromText } from "@/lib/ai/websiteImport";
import type { ActionResult } from "./business";
import type { KnowledgeCategory } from "@/lib/database/types";

// See app/actions/menu.ts for why this is needed — rendering a
// JS-heavy page (with a stealth-proxy retry if the first attempt is
// blocked) can take well past Vercel's default function timeout.
export const maxDuration = 60;

async function requireBusinessId(): Promise<string> {
  const supabase = createClient();
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

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/knowledge");
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

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/knowledge");
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

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/knowledge");
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
  if (error) return { success: false, error: error.message };

  revalidatePath("/dashboard/knowledge");
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
  if (error) return { success: false, error: error.message };

  revalidatePath("/dashboard/knowledge");
  return { success: true, itemsAdded: items.length };
}

export async function addPromotionAction(input: { title: string; description: string; appliesTo: string; startDate: string; endDate: string }): Promise<ActionResult> {
  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("promotions").insert({
    business_id: businessId,
    title: input.title,
    description: input.description,
    applies_to: input.appliesTo || null,
    start_date: input.startDate,
    end_date: input.endDate,
    is_active: true,
  });

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/knowledge");
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

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/knowledge");
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

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard/knowledge");
  return { success: true };
}
