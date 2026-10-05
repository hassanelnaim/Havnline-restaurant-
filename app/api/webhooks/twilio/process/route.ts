import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleTurn } from "@/lib/ai/receptionist";
import { getBusinessTwilioAuthToken } from "@/lib/ai/context";
import { getVoiceSelectionForCall } from "@/lib/ai/voiceSelection";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { twiml, buildTurnResponseTwiml, getRequestUrl, errorFallbackTwiml } from "@/lib/ai/twimlHelpers";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/twilio/process
 *
 * Reached via <Redirect> from /gather, right after the caller has
 * already heard a quick "one moment" acknowledgment (only for turns
 * flagged as likely-slow). This is where the actual (slower) work
 * happens: the real Claude call, tool execution, calendar checks,
 * etc. — the same handleTurn() Test Receptionist uses.
 */
export async function POST(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get("callId");
  const speechResult = request.nextUrl.searchParams.get("speech");
  if (!callId || !speechResult) return new NextResponse("Missing callId or speech", { status: 400 });

  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => (params[key] = String(value)));

  const admin = createAdminClient();
  const { data: call } = await admin.from("calls").select("business_id").eq("id", callId).single();
  if (!call) {
    return twiml(`<Response><Say>Sorry, something went wrong. Goodbye.</Say><Hangup/></Response>`);
  }

  const authToken = await getBusinessTwilioAuthToken(call.business_id);
  const signature = request.headers.get("x-twilio-signature");
  const fullUrl = getRequestUrl(request);
  if (!validateTwilioSignature(signature, fullUrl, params, authToken)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const voice = await getVoiceSelectionForCall(call.business_id, "process");

  try {
    const result = await handleTurn(call.business_id, callId, speechResult, "phone");
    return buildTurnResponseTwiml(call.business_id, callId, result, voice);
  } catch (err) {
    return errorFallbackTwiml(call.business_id, callId, voice, err);
  }
}
