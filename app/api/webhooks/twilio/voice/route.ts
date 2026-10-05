import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveBusinessFromPhoneNumber, loadBusinessContext } from "@/lib/ai/context";
import { startCall } from "@/lib/ai/receptionist";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { OPERATIONAL_SUBSCRIPTION_STATUSES } from "@/lib/billing/stripe";
import { sayLine, getRequestUrl } from "@/lib/ai/twimlHelpers";
import { isTtsDegraded } from "@/lib/integrations/telephony/ttsCircuit";
import { buildGreeting } from "@/lib/ai/greeting";
import { getSiteUrl } from "@/lib/env";
import { normalizePhoneDigits } from "@/lib/phone-utils";
import { isTransferLoop, LIVE_TRANSFER_MARKER } from "@/lib/ai/liveTransfer";

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
  const { data: business } = await admin.from("businesses").select("subscription_status, is_suspended").eq("id", businessId).single();
  const isOperational = business && OPERATIONAL_SUBSCRIPTION_STATUSES.includes(business.subscription_status);

  // Defense in depth: suspension is meant to be enforced by flipping
  // ai_receptionists.status to "offline" (see suspendBusinessAction),
  // but that's the same column the business's own dashboard toggle
  // controls — so a suspended business could otherwise just turn
  // itself back "online". Check is_suspended directly here too, since
  // this is the one place that actually decides whether to answer.
  if (!isOperational || business?.is_suspended || context.ai.status !== "online") {
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

  // A live transfer rings the restaurant's main line; if that line
  // forwards to this number, the transfer would arrive here as a new call
  // and could escalate again, forever. Turn it away.
  const restaurantPhone = context.business.phone;
  let recentTransfer = false;
  if (restaurantPhone && normalizePhoneDigits(callerNumber) === normalizePhoneDigits(restaurantPhone)) {
    const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data: recentCalls } = await admin.from("calls").select("id").eq("business_id", businessId).gte("started_at", since);
    const ids = (recentCalls || []).map((c) => c.id);
    if (ids.length > 0) {
      const { data: markers } = await admin
        .from("call_messages")
        .select("id")
        .in("call_id", ids)
        .eq("role", "system")
        .like("content", `${LIVE_TRANSFER_MARKER}%`)
        .limit(1);
      recentTransfer = (markers || []).length > 0;
    }
  }
  if (isTransferLoop({ from: callerNumber, to: dialedNumber, restaurantPhone, recentTransfer })) {
    console.warn(`Rejected looping transfer for business ${businessId}`);
    return twiml(`<Response><Reject reason="busy"/></Response>`);
  }

  const callId = await startCall(businessId, callerNumber, dialedNumber);

  await admin.from("call_messages").insert({ call_id: callId, role: "system", content: `Inbound call from ${callerNumber} to ${dialedNumber}` });

  // No AI name in the greeting on purpose — this is an automated
  // answering service, not a person, and giving it a name only invites
  // "is this a real person?" confusion. Lead with the business name
  // itself, same as a human answering the phone would.
  const greeting = buildGreeting(context.business.name);
  const gatherAction = `${SITE_URL}/api/webhooks/twilio/gather?callId=${callId}`;
  const voice = { voiceId: context.voice?.voice_id, providerVoiceRef: context.voice?.provider_voice_ref, ttsDegraded: await isTtsDegraded() };

  return twiml(`<Response>
  <Gather input="speech" action="${escapeXml(gatherAction)}" method="POST" speechTimeout="auto" speechModel="phone_call" timeout="15">
    ${sayLine(voice, greeting, businessId)}
  </Gather>
  ${sayLine(voice, "Sorry, I didn't catch that. Please call back. Goodbye.", businessId)}
  <Hangup/>
</Response>`);
}