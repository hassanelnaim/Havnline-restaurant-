import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBusinessTwilioAuthToken } from "@/lib/ai/context";
import { getVoiceSelectionForCall } from "@/lib/ai/voiceSelection";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { twiml, sayLine, getRequestUrl } from "@/lib/ai/twimlHelpers";
import { sendEscalationEmail } from "@/lib/notifications/escalation-email";
import { settleWithin } from "@/lib/monitoring/platformAlert";

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
  try {
    return await handle(request);
  } catch (err) {
    // Never answer Twilio with a non-TwiML error: the caller would hear
    // an application error. Close politely instead.
    console.error("dial-status failed:", err);
    return twiml(`<Response><Say>Sorry, no one is available right now. Please call back later. Goodbye.</Say><Hangup/></Response>`);
  }
}

async function handle(request: NextRequest) {
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
    // Staff picked up and handled it. If this began as an AI escalation,
    // there is nothing left to follow up on, so stop flagging it.
    if (call) {
      await admin
        .from("calls")
        .update({ outcome: "question_answered", escalation_reason: null })
        .eq("id", callId)
        .eq("outcome", "escalated");
      await admin.from("call_messages").insert({ call_id: callId, role: "system", content: "Live transfer answered by restaurant staff." });
    }
    return twiml(`<Response><Hangup/></Response>`);
  }

  // Nobody answered — keep it as a real escalation, so it shows up in the
  // dashboard for the business to follow up on, and email them (the AI
  // held that email back while the live transfer was being tried). The
  // AI's own reason is kept; the failed attempt is appended to it.
  if (call) {
    const { data: current } = await admin.from("calls").select("escalation_reason").eq("id", callId).single();
    const note = "Live transfer attempted but nobody answered.";
    const reason = current?.escalation_reason ? `${current.escalation_reason} (${note})` : note;
    await admin.from("calls").update({ outcome: "escalated", escalation_reason: reason }).eq("id", callId);
    await admin.from("call_messages").insert({ call_id: callId, role: "system", content: `Live transfer not answered (${dialCallStatus || "unknown"}).` });
    await settleWithin(
      sendEscalationEmail(call.business_id, callId).catch((err) => console.error("Escalation email failed:", err)),
      4000
    );
  }

  const voice = call ? await getVoiceSelectionForCall(call.business_id, "dial-status") : { voiceId: undefined };

  return twiml(`<Response>
  ${sayLine(voice, "Sorry, no one's available to take your call right now, but I've made a note and someone will get back to you soon. Thanks for calling!", call?.business_id)}
  <Hangup/>
</Response>`);
}
