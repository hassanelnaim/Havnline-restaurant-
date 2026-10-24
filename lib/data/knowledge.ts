import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { mockKnowledgeItems } from "@/lib/mock/data";
import type { DbKnowledgeItem } from "@/lib/database/types";

export async function getKnowledgeItems(): Promise<DbKnowledgeItem[]> {
  if (!isSupabaseConfigured()) return mockKnowledgeItems;
  const businessId = await getCurrentBusinessId();
  if (!businessId) return mockKnowledgeItems;

  const supabase = await createClient();
  const { data } = await supabase.from("knowledge_items").select("*").eq("business_id", businessId).order("created_at", { ascending: false });
  return data || mockKnowledgeItems;
}
