import { NextRequest, NextResponse } from "next/server";
import { ALREADY_ON_LINE_LINE } from "@/lib/ai/fillers";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveBusinessFromPhoneNumber, loadBusinessContext, closedDatesOf } from "@/lib/ai/context";
import { isBusinessOpenNow, nextOpenTimeText, localDateKeyNow } from "@/lib/business/hours";
import { startCall } from "@/lib/ai/receptionist";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { OPERATIONAL_SUBSCRIPTION_STATUSES } from "@/lib/billing/stripe";
import { sayLine, getRequestUrl, gatherActionUrl, speechGatherOpen } from "@/lib/ai/twimlHelpers";
import { sendPlatformAlert, settleWithin } from "@/lib/monitoring/platformAlert";
import { isTtsDegraded } from "@/lib/integrations/telephony/ttsCircuit";
import { buildGreeting } from "@/lib/ai/greeting";
import { getSiteUrl } from "@/lib/env";
import { normalizePhoneDigits } from "@/lib/phone-utils";
import { isTransferLoop, escalationTargetPhone, LIVE_TRANSFER_MARKER } from "@/lib/ai/liveTransfer";
import { createTimer, shortId, type Timer } from "@/lib/monitoring/timing";
import { warmCallRoutes } from "@/lib/ai/warmup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_OPEN_CALLS_PER_CALLER = 2;

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
  const timer = createTimer("voice");
  try {
    return await handleVoice(request, timer);
  } catch (err) {
    // Answer with a real server error on purpose: Twilio then uses the
    // number's fallback URL (voice-fallback), which tells the caller what
    // happened and rings the restaurant. Without this catch the same thing
    // would happen but nothing would record WHY it failed.
    console.error("[twilio-voice] call handler crashed:", err);
    await settleWithin(
      sendPlatformAlert({
        key: "voice-webhook-crashed",
        subject: "HavnLine: the call handler crashed",
        heading: "An incoming call could not be answered by the AI",
        intro: "The main voice webhook threw an error while answering a call. The caller was sent to the fallback path. The detail below is the actual cause.",
        rows: [{ label: "Error", value: (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 400) }],
      }),
      1500
    );
    return new Response("Voice handler error", { status: 500 });
  } finally {
    timer.done();
  }
}

async function handleVoice(request: NextRequest, timer: Timer) {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => (params[key] = String(value)));

  const dialedNumber = params.To;
  const callerNumber = params.From || "unknown";

  const resolved = await resolveBusinessFromPhoneNumber(dialedNumber);
  timer.mark("resolve_number");
  if (!resolved) {
    return twiml(`<Response><Say>This number is not currently configured. Goodbye.</Say><Hangup/></Response>`);
  }

  const signature = request.headers.get("x-twilio-signature");
  const fullUrl = getRequestUrl(request);
  if (!validateTwilioSignature(signature, fullUrl, params, resolved.subAccountAuthToken)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const businessId = resolved.businessId;
  const admin = createAdminClient();

  // These four lookups don't depend on each other, so they run together
  // instead of one after another — the caller is listening to silence for
  // the whole of this. (The business context itself is ten queries that
  // already run in parallel.)
  const [context, businessRes, blockedRes, ttsDegraded] = await Promise.all([
    loadBusinessContext(businessId),
    admin.from("businesses").select("subscription_status, is_suspended").eq("id", businessId).single(),
    // Silently reject a number this business has blocked (see Callers
    // page) or one Twilio's own spam/fraud add-on flags — no ring, no AI,
    // no record of a real call. Compares last-10-digits (see
    // phone-utils.ts) rather than an exact string match, since the caller
    // ID Twilio gives us here (E.164) rarely matches the free-text phone
    // number format the AI wrote down from a customer saying it out loud
    // mid-order.
    admin.from("customers").select("phone").eq("business_id", businessId).eq("is_blocked", true),
    isTtsDegraded(),
  ]);
  timer.mark("lookups");

  if (!context) {
    return twiml(`<Response><Say>Sorry, this business isn't fully set up yet. Goodbye.</Say><Hangup/></Response>`);
  }

  const business = businessRes.data;
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

  const normalizedCallerNumber = normalizePhoneDigits(callerNumber);
  const isBlocked = (blockedRes.data || []).some((c) => normalizePhoneDigits(c.phone) === normalizedCallerNumber);

  if (isBlocked || isCallFlaggedAsSpam(params.AddOns)) {
    return twiml(`<Response><Reject reason="rejected"/></Response>`);
  }

  // Closed (outside the weekly hours, or a holiday closure): no order can
  // be placed and nobody is there to cook, so the AI doesn't pick up. The
  // caller hears the business's next opening time instead and the call
  // ends, with no AI or speech-recognition cost.
  const closedDates = closedDatesOf(context);
  if (!isBusinessOpenNow(context.business, context.hours, closedDates)) {
    timer.set("path", "closed");
    const todayKey = localDateKeyNow(context.business.timezone);
    const holiday = (context.closures || []).find((c) => c.closed_on === todayKey);
    const reopens = nextOpenTimeText(context.business, context.hours, closedDates);
    const closedLine = `Hi, thanks for calling ${context.business.name}! We're closed right now${holiday?.note ? ` for ${holiday.note}` : ""}.${reopens ? ` We open again ${reopens}.` : ""} Please call back then. Goodbye!`;
    const closedVoice = { voiceId: context.voice?.voice_id, providerVoiceRef: context.voice?.provider_voice_ref, ttsDegraded };
    return twiml(`<Response>
  ${sayLine(closedVoice, closedLine, businessId)}
  <Hangup/>
</Response>`);
  }

  // A live transfer rings the escalation number (or the main line); if that
  // number forwards to this number, the transfer would arrive here as a new call
  // and could escalate again, forever. Turn it away.
  const restaurantPhone = escalationTargetPhone(context.business);
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

  // One caller, at most two calls at once. Without a limit, one number
  // (or a script) could open call after call, each one running the AI and
  // using the speech capacity every restaurant shares. Hidden caller IDs
  // aren't counted together (they all look the same). Only calls from the
  // last 30 minutes count, so a call whose "ended" callback never arrived
  // can't block the caller for good.
  if (normalizedCallerNumber.length >= 10) {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { count: openCalls } = await admin
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("phone", callerNumber)
      .eq("status", "in_progress")
      .gte("started_at", since);
    if ((openCalls ?? 0) >= MAX_OPEN_CALLS_PER_CALLER) {
      timer.set("path", "caller_limit");
      const capVoice = { voiceId: context.voice?.voice_id, providerVoiceRef: context.voice?.provider_voice_ref, ttsDegraded };
      return twiml(`<Response>
  ${sayLine(capVoice, ALREADY_ON_LINE_LINE, businessId)}
  <Hangup/>
</Response>`);
    }
  }

  // The call is going to be answered. Start waking the webhooks the caller
  // will reach next so they're ready by the time the greeting has played
  // (see warmup.ts). Sent before the database writes below so it is on its
  // way while they run.
  warmCallRoutes();

  const callId = await startCall(businessId, callerNumber, dialedNumber);
  timer.mark("start_call");
  timer.set("call", shortId(callId));

  await admin.from("call_messages").insert({ call_id: callId, role: "system", content: `Inbound call from ${callerNumber} to ${dialedNumber}` });
  timer.mark("log_call");

  // No AI name in the greeting on purpose — this is an automated
  // answering service, not a person, and giving it a name only invites
  // "is this a real person?" confusion. Lead with the business name
  // itself, same as a human answering the phone would.
  const greeting = buildGreeting(context.business.name);
  const gatherAction = gatherActionUrl(callId, 0);
  const voice = { voiceId: context.voice?.voice_id, providerVoiceRef: context.voice?.provider_voice_ref, ttsDegraded };

  return twiml(`<Response>
  ${speechGatherOpen(gatherAction, 15, { retryOnSilence: true })}
    ${sayLine(voice, greeting, businessId)}
  </Gather>
  ${sayLine(voice, "Sorry, I didn't catch that. Please call back. Goodbye.", businessId)}
  <Hangup/>
</Response>`);
}
