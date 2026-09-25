import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveBusinessFromPhoneNumber, loadBusinessContext } from "@/lib/ai/context";
import { startCall } from "@/lib/ai/receptionist";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { OPERATIONAL_SUBSCRIPTION_STATUSES } from "@/lib/billing/stripe";
import { sayLine, getRequestUrl } from "@/lib/ai/twimlHelpers";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

const SITE_URL = getSiteUrl();

function twiml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { headers: { "Content-Type": "text/xml" } });
}
function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => (params[key] = String(value)));

  const dialedNumber = params.To;
  const callerNumber = params.From || "unknown";

  const resolved = await resolveBusinessFromPhoneNumber(dialedNumber);
  if (!resolved) {
    return twiml(`<Response><Say>This number is not currently configured. Goodbye.</Say><Hangup/></Response>`);
  }

  const signature = request.headers.get("x-twilio-signature");
  const fullUrl = getRequestUrl(request);
  if (!validateTwilioSignature(signature, fullUrl, params, resolved.subAccountAuthToken)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const businessId = resolved.businessId;
  const context = await loadBusinessContext(businessId);
  if (!context) {
    return twiml(`<Response><Say>Sorry, this business isn't fully set up yet. Goodbye.</Say><Hangup/></Response>`);
  }

  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("subscription_status").eq("id", businessId).single();
  const isOperational = business && OPERATIONAL_SUBSCRIPTION_STATUSES.includes(business.subscription_status);

  if (!isOperational || context.ai.status !== "online") {
    return twiml(`<Response><Say>Thanks for calling ${escapeXml(context.business.name)}. We're currently unable to take your call — please try again later.</Say><Hangup/></Response>`);
  }

  const callId = await startCall(businessId, callerNumber, dialedNumber);

  await admin.from("call_messages").insert({ call_id: callId, role: "system", content: `Inbound call from ${callerNumber} to ${dialedNumber}` });

  const greeting = `Thanks for calling ${context.business.name}, this is ${context.ai.name}. Please note there may be a few seconds' delay between questions. How can I help?`;
  const gatherAction = `${SITE_URL}/api/webhooks/twilio/gather?callId=${callId}`;
  const voice = { voiceId: context.voice?.voice_id, providerVoiceRef: context.voice?.provider_voice_ref };

  return twiml(`<Response>
  <Gather input="speech" action="${escapeXml(gatherAction)}" method="POST" speechTimeout="auto" speechModel="phone_call" timeout="15">
    ${sayLine(voice, greeting, businessId)}
  </Gather>
  ${sayLine(voice, "Sorry, I didn't catch that. Please call back. Goodbye.", businessId)}
  <Hangup/>
</Response>`);
}