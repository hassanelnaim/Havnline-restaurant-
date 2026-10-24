import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { mockPromotions } from "@/lib/mock/data";
import type { DbPromotion } from "@/lib/database/types";

export async function getPromotions(): Promise<DbPromotion[]> {
  if (!isSupabaseConfigured()) return mockPromotions;
  const businessId = await getCurrentBusinessId();
  if (!businessId) return mockPromotions;

  const supabase = await createClient();
  const { data } = await supabase.from("promotions").select("*").eq("business_id", businessId).order("start_date", { ascending: false });
  return data || mockPromotions;
}
