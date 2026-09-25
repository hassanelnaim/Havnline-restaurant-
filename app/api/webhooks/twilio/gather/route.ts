import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleTurn } from "@/lib/ai/receptionist";
import { getBusinessTwilioAuthToken } from "@/lib/ai/context";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { twiml, escapeXml, buildTurnResponseTwiml, lastTurnUsedTool, textLikelyNeedsTool, sayLine, getRequestUrl } from "@/lib/ai/twimlHelpers";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

const SITE_URL = getSiteUrl();

const FILLERS = [
  "Sure, let me check that for you.",
  "Great, one moment.",
  "Okay, let's see here.",
  "Got it, give me a second.",
  "Sure thing, one sec.",
];

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

  const { data: voiceConfig } = await admin.from("ai_voice_configs").select("voice_id, provider_voice_ref").eq("business_id", call.business_id).maybeSingle();
  const voice = { voiceId: voiceConfig?.voice_id as any, providerVoiceRef: voiceConfig?.provider_voice_ref };

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

  const likelySlow = (await lastTurnUsedTool(callId)) || textLikelyNeedsTool(speechResult);

  if (!likelySlow) {
    const result = await handleTurn(call.business_id, callId, speechResult, "phone");
    return buildTurnResponseTwiml(call.business_id, callId, result, voice);
  }

  const filler = FILLERS[Math.floor(Math.random() * FILLERS.length)];
  const processUrl = `${SITE_URL}/api/webhooks/twilio/process?callId=${callId}&speech=${encodeURIComponent(speechResult)}`;

  return twiml(`<Response>
  ${sayLine(voice, filler, call.business_id)}
  <Redirect method="POST">${escapeXml(processUrl)}</Redirect>
</Response>`);
}