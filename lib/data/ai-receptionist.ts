import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { mockAiReceptionist, mockVoiceConfig } from "@/lib/mock/data";
import type { DbAiReceptionist, DbAiVoiceConfig } from "@/lib/database/types";

export async function getAiReceptionist(): Promise<DbAiReceptionist> {
  if (!isSupabaseConfigured()) return mockAiReceptionist;
  const businessId = await getCurrentBusinessId();
  if (!businessId) return mockAiReceptionist;

  const supabase = await createClient();
  const { data } = await supabase.from("ai_receptionists").select("*").eq("business_id", businessId).single();
  return data || mockAiReceptionist;
}

export async function getVoiceConfig(): Promise<DbAiVoiceConfig> {
  if (!isSupabaseConfigured()) return mockVoiceConfig;
  const businessId = await getCurrentBusinessId();
  if (!businessId) return mockVoiceConfig;

  const supabase = await createClient();
  const { data } = await supabase.from("ai_voice_configs").select("*").eq("business_id", businessId).maybeSingle();
  return data || mockVoiceConfig;
}
