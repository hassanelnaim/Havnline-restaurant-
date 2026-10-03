import { createAdminClient } from "@/lib/supabase/admin";
import type { DbAiVoiceConfig } from "@/lib/database/types";

type VoiceColumns = Pick<DbAiVoiceConfig, "voice_id" | "provider_voice_ref">;

// Every webhook turn in a live call (voice/gather/process/dial-status)
// re-fetches this business's voice config fresh rather than resolving it
// once per call — each one used to destructure only `data` from the
// Supabase response, silently treating a real query error exactly like
// "no voice configured" and falling through to the hardcoded default
// voice (lib/integrations/telephony/elevenlabsProvider.ts). That default
// happens to read as a different gender than most businesses' configured
// voice, so a single transient fetch failure on one turn of a call could
// sound like the voice switching mid-call. This helper checks `error`,
// retries once on a transient failure, and logs clearly when it still
// can't get a real answer, instead of quietly pretending there's no
// voice configured at all.
export async function getVoiceConfigForCall(
  businessId: string,
  context: string
): Promise<VoiceColumns | null> {
  const admin = createAdminClient();
  const columns = "voice_id, provider_voice_ref";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, error } = await admin
      .from("ai_voice_configs")
      .select(columns)
      .eq("business_id", businessId)
      .maybeSingle();

    if (!error) return (data as VoiceColumns | null) ?? null;

    console.error(
      `[getVoiceConfigForCall:${context}] attempt ${attempt} failed for business ${businessId}:`,
      error
    );
  }

  console.error(
    `[getVoiceConfigForCall:${context}] giving up after 2 attempts for business ${businessId} — falling back to default voice.`
  );
  return null;
}
