import { createAdminClient } from "@/lib/supabase/admin";
import { getBusinessTwilioAuthToken } from "@/lib/ai/context";
import { getVoiceSelectionForCall } from "@/lib/ai/voiceSelection";
import { isTtsDegraded } from "@/lib/integrations/telephony/ttsCircuit";
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
// What stays the same for the whole call (which business, its Twilio token,
// its voice) is remembered per call for a few minutes, so every turn after
// the first skips two lookups. The call's outcome is NOT remembered: it
// changes when the order is placed, and the gather route ends the call on
// "thanks" only after that, so it is read fresh on every turn. Per server
// instance; an instance that hasn't seen this call just looks it up.
const STATIC_TTL_MS = 15 * 60_000;
const MAX_REMEMBERED_CALLS = 500;
const remembered = new Map<string, { businessId: string; authToken: string | null; voice: VoiceSelection; at: number }>();

export async function loadCallWebhookState(callId: string, caller: string): Promise<CallWebhookState | null> {
  const admin = createAdminClient();
  const known = remembered.get(callId);
  if (known && Date.now() - known.at < STATIC_TTL_MS) {
    // The voice backup switch (ttsDegraded) can flip mid-call, so it's
    // checked fresh too, at the same time as the outcome.
    const [{ data: call }, ttsDegraded] = await Promise.all([
      admin.from("calls").select("outcome").eq("id", callId).maybeSingle(),
      isTtsDegraded(),
    ]);
    if (!call) return null;
    return { call: { business_id: known.businessId, outcome: call.outcome ?? null }, authToken: known.authToken, voice: { ...known.voice, ttsDegraded } };
  }

  const { data: call } = await admin.from("calls").select("business_id, outcome").eq("id", callId).single();
  if (!call) return null;

  const [authToken, voice] = await Promise.all([
    getBusinessTwilioAuthToken(call.business_id),
    getVoiceSelectionForCall(call.business_id, caller),
  ]);

  if (remembered.size >= MAX_REMEMBERED_CALLS) {
    const oldest = remembered.keys().next().value;
    if (oldest) remembered.delete(oldest);
  }
  remembered.set(callId, { businessId: call.business_id, authToken, voice, at: Date.now() });

  return { call: { business_id: call.business_id, outcome: call.outcome ?? null }, authToken, voice };
}
