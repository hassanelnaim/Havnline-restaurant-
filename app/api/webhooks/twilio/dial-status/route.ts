import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBusinessTwilioAuthToken } from "@/lib/ai/context";
import { getVoiceConfigForCall } from "@/lib/ai/voiceSelection";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { twiml, sayLine, getRequestUrl } from "@/lib/ai/twimlHelpers";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/twilio/dial-status
 *
 * Fires after a live transfer attempt (<Dial>) finishes, whether
 * answered, unanswered, busy, or failed. If nobody answered, this
 * converts it into a real logged escalation — same as
 * escalate_to_human — so the caller hears a graceful closing message
 * instead of dead air, and the business still sees it in their
 * dashboard to follow up on.
 */
export async function POST(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get("callId");
  if (!callId) return new NextResponse("Missing callId", { status: 400 });

  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => (params[key] = String(value)));

  const admin = createAdminClient();
  const { data: call } = await admin.from("calls").select("business_id").eq("id", callId).single();

  const authToken = call ? await getBusinessTwilioAuthToken(call.business_id) : null;
  const signature = request.headers.get("x-twilio-signature");
  const fullUrl = getRequestUrl(request);
  if (!validateTwilioSignature(signature, fullUrl, params, authToken)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const dialCallStatus = params.DialCallStatus; // "completed" | "busy" | "no-answer" | "failed" | "canceled"

  if (dialCallStatus === "completed") {
    // The transfer was answered and the human handled it — nothing more to do.
    return twiml(`<Response><Hangup/></Response>`);
  }

  // Nobody answered — log this as a real escalation, same as
  // escalate_to_human, so it shows up in the dashboard for the
  // business to follow up on, instead of the caller just being dropped.
  if (call) {
    await admin
      .from("calls")
      .update({ outcome: "escalated", escalation_reason: "Live transfer attempted but nobody answered." })
      .eq("id", callId);
  }

  const voiceConfig = call ? await getVoiceConfigForCall(call.business_id, "dial-status") : null;
  const voice = { voiceId: voiceConfig?.voice_id as any, providerVoiceRef: voiceConfig?.provider_voice_ref };

  return twiml(`<Response>
  ${sayLine(voice, "Sorry, no one's available to take your call right now, but I've made a note and someone will get back to you soon. Thanks for calling!", call?.business_id)}
  <Hangup/>
</Response>`);
}
