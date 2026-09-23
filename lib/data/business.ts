import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { mockBusiness, mockBusinessHours } from "@/lib/mock/data";
import type { DbBusiness, DbBusinessHours } from "@/lib/database/types";

export async function getBusiness(): Promise<DbBusiness> {
  if (!isSupabaseConfigured()) return mockBusiness;
  const businessId = await getCurrentBusinessId();
  if (!businessId) return mockBusiness;

  const supabase = createClient();
  const { data } = await supabase.from("businesses").select("*").eq("id", businessId).single();
  return data || mockBusiness;
}

export async function getBusinessHours(): Promise<DbBusinessHours[]> {
  if (!isSupabaseConfigured()) return mockBusinessHours;
  const businessId = await getCurrentBusinessId();
  if (!businessId) return mockBusinessHours;

  const supabase = createClient();
  const { data } = await supabase.from("business_hours").select("*").eq("business_id", businessId);
  return data || mockBusinessHours;
}

// Menu reads now live in lib/data/menu.ts (getMenuForBusiness) — a
// restaurant's menu has real structure (categories, modifiers) that a
// flat getServices()-style function can't represent.
