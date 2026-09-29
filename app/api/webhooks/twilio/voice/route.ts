import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveBusinessFromPhoneNumber, loadBusinessContext } from "@/lib/ai/context";
import { startCall } from "@/lib/ai/receptionist";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { OPERATIONAL_SUBSCRIPTION_STATUSES } from "@/lib/billing/stripe";
import { sayLine, getRequestUrl } from "@/lib/ai/twimlHelpers";
import { getSiteUrl } from "@/lib/env";
import { normalizePhoneDigits } from "@/lib/phone-utils";

export const dynamic = "force-dynamic";

const SITE_URL = getSiteUrl();

function twiml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { headers: { "Content-Type": "text/xml" } });
}
function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Reads Twilio's optional spam/fraud Voice Add-ons (Nomorobo Spam Score,
// Marchex Clean Call), attached to the inbound call request as a JSON
// "AddOns" param IF the business has enabled one on their Twilio number
// (Console -> Marketplace -> search "spam"). Nothing to enable yet? This
// just quietly returns false — no add-on means no AddOns param (or an
// empty/errored one), never a false positive.
function isCallFlaggedAsSpam(addOnsRaw: string | undefined): boolean {
  if (!addOnsRaw) return false;
  try {
    const parsed = JSON.parse(addOnsRaw);
    const results = parsed?.results || {};
    if (results.nomorobo_spamscore?.status === "successful" && results.nomorobo_spamscore?.result?.score === 1) return true;
    if (results.marchex_cleancall?.status === "successful" && results.marchex_cleancall?.result?.result?.recommendation === "BLOCK") return true;
    return false;
  } catch {
    return false;
  }
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

  // Silently reject a number this business has blocked (see Callers page)
  // or one Twilio's own spam/fraud add-on flags — no ring, no AI, no
  // record of a real call. Compares last-10-digits (see phone-utils.ts)
  // rather than an exact string match, since the caller ID Twilio gives
  // us here (E.164) rarely matches the free-text phone number format
  // the AI wrote down from a customer saying it out loud mid-order.
  const { data: blockedCustomers } = await admin
    .from("customers")
    .select("phone")
    .eq("business_id", businessId)
    .eq("is_blocked", true);

  const normalizedCallerNumber = normalizePhoneDigits(callerNumber);
  const isBlocked = (blockedCustomers || []).some((c) => normalizePhoneDigits(c.phone) === normalizedCallerNumber);

  if (isBlocked || isCallFlaggedAsSpam(params.AddOns)) {
    return twiml(`<Response><Reject reason="rejected"/></Response>`);
  }

  const callId = await startCall(businessId, callerNumber, dialedNumber);

  await admin.from("call_messages").insert({ call_id: callId, role: "system", content: `Inbound call from ${callerNumber} to ${dialedNumber}` });

  // No AI name in the greeting on purpose — this is an automated
  // answering service, not a person, and giving it a name only invites
  // "is this a real person?" confusion. Lead with the business name
  // itself, same as a human answering the phone would.
  const greeting = `${context.business.name}. There may be a few seconds' delay between answers, so please be patient. How can I help?`;
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