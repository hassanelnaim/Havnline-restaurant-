import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleTurn } from "@/lib/ai/receptionist";
import { getBusinessTwilioAuthToken } from "@/lib/ai/context";
import { getVoiceSelectionForCall } from "@/lib/ai/voiceSelection";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { twiml, escapeXml, buildTurnResponseTwiml, sayLine, getRequestUrl, errorFallbackTwiml } from "@/lib/ai/twimlHelpers";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

const SITE_URL = getSiteUrl();

/**
 * POST /api/webhooks/twilio/gather-continue
 *
 * Only reached from the <Gather> now wrapping the filler line in
 * /gather — i.e. the customer kept talking (barge-in during the
 * filler, or within its short grace window right after) instead of
 * falling silent. That's almost always the rest of the SAME thought
 * ("...and a coke too"), not a new, unrelated turn, so this joins it
 * onto the speech that triggered the filler in the first place and
 * processes both together as one turn — otherwise the back half of
 * what the customer said would just be dropped.
 */
export async function POST(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get("callId");
  const original = request.nextUrl.searchParams.get("original") || "";
  if (!callId) return new NextResponse("Missing callId", { status: 400 });

  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => (params[key] = String(value)));

  const admin = createAdminClient();
  const { data: call } = await admin.from("calls").select("business_id").eq("id", callId).single();
  if (!call) return twiml(`<Response><Say>Sorry, something went wrong. Goodbye.</Say><Hangup/></Response>`);

  const authToken = await getBusinessTwilioAuthToken(call.business_id);
  const signature = request.headers.get("x-twilio-signature");
  const fullUrl = getRequestUrl(request);
  if (!validateTwilioSignature(signature, fullUrl, params, authToken)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const voice = await getVoiceSelectionForCall(call.business_id, "gather-continue");

  // Join rather than replace — this branch only exists because the
  // customer kept talking, so both fragments belong to one utterance.
  const combinedSpeech = [original, params.SpeechResult].filter(Boolean).join(" ").trim();

  if (!combinedSpeech) {
    // Not expected in practice (Twilio only calls this action when it
    // actually captured speech), but fail the same safe way /gather's
    // own no-speech case does rather than a dead-end hangup.
    const gatherAction = `${SITE_URL}/api/webhooks/twilio/gather?callId=${callId}`;
    return twiml(`<Response>
  <Gather input="speech" action="${escapeXml(gatherAction)}" method="POST" speechTimeout="auto" speechModel="phone_call" timeout="15">
    ${sayLine(voice, "Sorry, could you say that again?", call.business_id)}
  </Gather>
  ${sayLine(voice, "I'm not able to hear you — please call back. Goodbye.", call.business_id)}
  <Hangup/>
</Response>`);
  }

  try {
    const result = await handleTurn(call.business_id, callId, combinedSpeech, "phone");
    return buildTurnResponseTwiml(call.business_id, callId, result, voice);
  } catch (err) {
    return errorFallbackTwiml(call.business_id, callId, voice, err);
  }
}
