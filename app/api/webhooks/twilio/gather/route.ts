import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleTurn } from "@/lib/ai/receptionist";
import { getBusinessTwilioAuthToken } from "@/lib/ai/context";
import { getVoiceSelectionForCall } from "@/lib/ai/voiceSelection";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { twiml, escapeXml, buildTurnResponseTwiml, lastTurnUsedTool, getContextualFiller, sayLine, getRequestUrl, errorFallbackTwiml } from "@/lib/ai/twimlHelpers";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

const SITE_URL = getSiteUrl();

export async function POST(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get("callId");
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

  const voice = await getVoiceSelectionForCall(call.business_id, "gather");

  const speechResult = params.SpeechResult;
  const gatherAction = `${SITE_URL}/api/webhooks/twilio/gather?callId=${callId}`;

  if (!speechResult) {
    return twiml(`<Response>
  <Gather input="speech" action="${escapeXml(gatherAction)}" method="POST" speechTimeout="auto" speechModel="phone_call" timeout="15">
    ${sayLine(voice, "Sorry, could you say that again?", call.business_id)}
  </Gather>
  ${sayLine(voice, "I'm not able to hear you — please call back. Goodbye.", call.business_id)}
  <Hangup/>
</Response>`);
  }

  const filler = getContextualFiller(speechResult, await lastTurnUsedTool(callId));

  if (!filler) {
    try {
      const result = await handleTurn(call.business_id, callId, speechResult, "phone");
      return buildTurnResponseTwiml(call.business_id, callId, result, voice);
    } catch (err) {
      return errorFallbackTwiml(call.business_id, callId, voice, err);
    }
  }

  const processUrl = `${SITE_URL}/api/webhooks/twilio/process?callId=${callId}&speech=${encodeURIComponent(speechResult)}`;

  // The filler used to be a bare <Say> with no <Gather> around it —
  // Twilio isn't listening for speech at all while a bare <Say> plays,
  // so a customer who kept talking through "sure, one sec" (continuing
  // the same thought, e.g. "...and a coke too") was simply never heard
  // at all, not just delayed. Wrapping it in its own <Gather> means
  // that speech is still captured (barge-in during the filler, plus a
  // short grace window after it finishes) and sent to gather-continue,
  // which stitches it onto the speech that triggered this filler
  // before processing the turn — so a continued order doesn't silently
  // lose its back half. If nothing more is heard, this falls through
  // to the same /process redirect as before. timeout is kept short
  // (1s) since this adds pure wait time to the common case where the
  // customer really is done talking.
  const continueAction = `${SITE_URL}/api/webhooks/twilio/gather-continue?callId=${callId}&original=${encodeURIComponent(speechResult)}`;

  return twiml(`<Response>
  <Gather input="speech" action="${escapeXml(continueAction)}" method="POST" speechTimeout="auto" speechModel="phone_call" timeout="1">
    ${sayLine(voice, filler, call.business_id)}
  </Gather>
  <Redirect method="POST">${escapeXml(processUrl)}</Redirect>
</Response>`);
}