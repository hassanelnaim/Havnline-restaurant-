import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { handleTurn } from "@/lib/ai/receptionist";
import { loadCallWebhookState } from "@/lib/ai/callWebhook";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { twiml, escapeXml, buildTurnResponseTwiml, getLastAiTurn, getContextualFiller, sayLine, getRequestUrl, errorFallbackTwiml, gatherActionUrl, readSeqParam, readMissParam, speechGatherOpen } from "@/lib/ai/twimlHelpers";
import { isFarewell, POST_ORDER_GOODBYE } from "@/lib/ai/fillers";
import { warmResponse } from "@/lib/ai/warmup";
import { createTimer, shortId, type Timer } from "@/lib/monitoring/timing";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

const SITE_URL = getSiteUrl();

// Re-prompts after silence before giving up on the call.
const MAX_MISSED_LISTENS = 2;

// Start-up ping sent from the voice webhook while the greeting plays (see
// lib/ai/warmup.ts). Does no work and returns nothing.
export async function GET() {
  return warmResponse();
}

export async function POST(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get("callId");
  if (!callId) return new NextResponse("Missing callId", { status: 400 });

  const timer = createTimer("gather", { call: shortId(callId) });
  try {
    return await handleGather(request, callId, timer);
  } finally {
    timer.done();
  }
}

async function handleGather(request: NextRequest, callId: string, timer: Timer) {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => (params[key] = String(value)));

  // The call row (which tells us the business, then the token and voice) and
  // the assistant's last reply (for the filler decision) don't depend on
  // each other, so they load side by side.
  const [state, lastAiTurn] = await Promise.all([loadCallWebhookState(callId, "gather"), getLastAiTurn(callId)]);
  timer.mark("load_call");
  if (!state) return twiml(`<Response><Say>Sorry, something went wrong. Goodbye.</Say><Hangup/></Response>`);

  const { call, authToken, voice } = state;
  const admin = createAdminClient();

  const signature = request.headers.get("x-twilio-signature");
  const fullUrl = getRequestUrl(request);
  if (!validateTwilioSignature(signature, fullUrl, params, authToken)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const speechResult = params.SpeechResult;
  // How many things the caller had said when this request's TwiML was issued
  // (see gatherActionUrl). Carried forward unchanged when nothing new has
  // been recorded yet: the re-prompt below and the filler path both lead to
  // the same point in the conversation.
  const seq = readSeqParam(request.nextUrl);
  const gatherAction = gatherActionUrl(callId, seq);

  if (!speechResult) {
    // Nothing was heard (Twilio now asks us instead of moving straight on to
    // "goodbye" — see speechGatherOpen). Ask again, up to twice in a row,
    // so a short "yes" the recogniser missed doesn't end the call.
    const missed = readMissParam(request.nextUrl);
    timer.set("path", "no_speech");
    if (missed >= MAX_MISSED_LISTENS) {
      return twiml(`<Response>
  ${sayLine(voice, "I'm not able to hear you — please call back. Goodbye.", call.business_id)}
  <Hangup/>
</Response>`);
    }
    return twiml(`<Response>
  ${speechGatherOpen(gatherActionUrl(callId, seq, missed + 1), 15, { retryOnSilence: true })}
    ${sayLine(voice, "Sorry, could you say that again?", call.business_id)}
  </Gather>
  ${sayLine(voice, "I'm not able to hear you — please call back. Goodbye.", call.business_id)}
  <Hangup/>
</Response>`);
  }

  // Order already placed and the caller is just saying thanks / goodbye:
  // end the call now. Sending "thanks" through the AI only produces
  // another "you're welcome" and another 15 seconds of waiting. Both
  // sides are still recorded so the transcript shows how the call ended.
  if (call.outcome === "order_placed" && isFarewell(speechResult)) {
    await admin.from("call_messages").insert([
      { call_id: callId, role: "customer", content: speechResult },
      { call_id: callId, role: "ai", content: POST_ORDER_GOODBYE },
    ]);
    timer.set("path", "farewell");
    return twiml(`<Response>
  ${sayLine(voice, POST_ORDER_GOODBYE, call.business_id)}
  <Hangup/>
</Response>`);
  }

  // A filler only plays before the genuinely slow turns (placing the order,
  // handing the caller to a person) — see fillers.ts for why. Everything
  // else goes straight to the real answer in this same request, which also
  // skips the second round trip (and a possible second cold start) that the
  // filler path needs.
  const filler = getContextualFiller(speechResult, lastAiTurn.usedTool, lastAiTurn.content);
  timer.mark("decide");

  if (!filler) {
    timer.set("path", "direct");
    try {
      const result = await handleTurn(call.business_id, callId, speechResult, "phone", { timer, seq });
      return buildTurnResponseTwiml(call.business_id, callId, result, voice);
    } catch (err) {
      return errorFallbackTwiml(call.business_id, callId, voice, err);
    }
  }

  timer.set("path", "filler");
  const seqParam = seq === null ? "" : `&seq=${seq}`;
  const processUrl = `${SITE_URL}/api/webhooks/twilio/process?callId=${callId}&speech=${encodeURIComponent(speechResult)}${seqParam}`;

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
  const continueAction = `${SITE_URL}/api/webhooks/twilio/gather-continue?callId=${callId}&original=${encodeURIComponent(speechResult)}${seqParam}`;

  return twiml(`<Response>
  ${speechGatherOpen(continueAction, 1)}
    ${sayLine(voice, filler, call.business_id)}
  </Gather>
  <Redirect method="POST">${escapeXml(processUrl)}</Redirect>
</Response>`);
}
