import { isSupabaseConfigured } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { getPauseState, type PauseState } from "@/lib/ai/pause";

/** The signed-in restaurant's pause state (Admin > Pause AI). */
export async function getMyPauseState(): Promise<PauseState> {
  if (!isSupabaseConfigured()) return { active: null, upcoming: null };
  const businessId = await getCurrentBusinessId();
  if (!businessId) return { active: null, upcoming: null };
  return getPauseState(businessId);
}
