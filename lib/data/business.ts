import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { mockBusiness, mockBusinessHours } from "@/lib/mock/data";
import type { DbBusiness, DbBusinessClosure, DbBusinessHours } from "@/lib/database/types";

export async function getBusiness(): Promise<DbBusiness> {
  if (!isSupabaseConfigured()) return mockBusiness;
  const businessId = await getCurrentBusinessId();
  if (!businessId) return mockBusiness;

  const supabase = await createClient();
  const { data } = await supabase.from("businesses").select("*").eq("id", businessId).single();
  return data || mockBusiness;
}

/** Upcoming holiday closures (today onward, business's timezone). Empty if the table isn't there yet. */
export async function getUpcomingClosures(timezone: string): Promise<DbBusinessClosure[]> {
  if (!isSupabaseConfigured()) return [];
  const businessId = await getCurrentBusinessId();
  if (!businessId) return [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const supabase = await createClient();
  const { data, error } = await supabase.from("business_closures").select("*").eq("business_id", businessId).gte("closed_on", today).order("closed_on");
  if (error) return [];
  return (data || []) as DbBusinessClosure[];
}

export async function getBusinessHours(): Promise<DbBusinessHours[]> {
  if (!isSupabaseConfigured()) return mockBusinessHours;
  const businessId = await getCurrentBusinessId();
  if (!businessId) return mockBusinessHours;

  const supabase = await createClient();
  const { data } = await supabase.from("business_hours").select("*").eq("business_id", businessId);
  return data || mockBusinessHours;
}

// Menu reads now live in lib/data/menu.ts (getMenuForBusiness) — a
// restaurant's menu has real structure (categories, modifiers) that a
// flat getServices()-style function can't represent.
