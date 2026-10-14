import { createAdminClient } from "@/lib/supabase/admin";
import { getBusinessTwilioAuthToken } from "@/lib/ai/context";
import { getVoiceSelectionForCall } from "@/lib/ai/voiceSelection";
import type { VoiceSelection } from "@/lib/ai/twimlHelpers";

export interface CallWebhookState {
  call: { business_id: string; outcome: string | null };
  /** The business's Twilio sub-account token, for checking Twilio's signature. */
  authToken: string | null;
  voice: VoiceSelection;
}

/**
 * Everything the per-turn webhooks (gather, process, gather-continue) need
 * before they can do anything: the call row, the Twilio token for the
 * signature check, and the business's voice.
 *
 * The call row has to come first (it says which business this is), but the
 * token and the voice both only need that business id, so they are fetched
 * together instead of one after the other. Each of those is a round trip to
 * the database; the caller is waiting in silence through all of them.
 *
 * Returns null when the call doesn't exist.
 */
export async function loadCallWebhookState(callId: string, caller: string): Promise<CallWebhookState | null> {
  const admin = createAdminClient();
  const { data: call } = await admin.from("calls").select("business_id, outcome").eq("id", callId).single();
  if (!call) return null;

  const [authToken, voice] = await Promise.all([
    getBusinessTwilioAuthToken(call.business_id),
    getVoiceSelectionForCall(call.business_id, caller),
  ]);

  return { call: { business_id: call.business_id, outcome: call.outcome ?? null }, authToken, voice };
}
