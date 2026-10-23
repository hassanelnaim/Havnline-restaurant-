import { NextRequest, NextResponse } from "next/server";
import { readSpeech } from "@/lib/ai/speechHandoff";
import { runPhoneTurn } from "@/lib/ai/turnRunner";
import { loadCallWebhookState } from "@/lib/ai/callWebhook";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { twiml, sayLine, getRequestUrl, gatherActionUrl, readSeqParam, speechGatherOpen } from "@/lib/ai/twimlHelpers";
import { createTimer, shortId, type Timer } from "@/lib/monitoring/timing";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE_URL = getSiteUrl();

/**
 * POST /api/webhooks/twilio/gather-continue
 *
 * Only reached from the <Gather> now wrapping the filler line in
 * /gather — i.e. the customer kept talking (barge-in during the
 * filler, or within its short grace window right after) instead of
 * falling silent. That's almost always the rest of the SAME thought
 * ("...and a coke too"), not a new, unrelated turn, so this joins it
 * onto the speech that triggered the filler in the first place and
 * processes both together as one turn — otherwise the back half of
 * what the customer said would just be dropped.
 */
export async function POST(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get("callId");
  if (!callId) return new NextResponse("Missing callId", { status: 400 });
  const original = (await readSpeech(callId, request.nextUrl.searchParams.get("h"))) ?? request.nextUrl.searchParams.get("original") ?? "";

  const timer = createTimer("gather-continue", { call: shortId(callId) });
  try {
    return await handleContinue(request, callId, original, timer);
  } finally {
    timer.done();
  }
}

async function handleContinue(request: NextRequest, callId: string, original: string, timer: Timer) {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => (params[key] = String(value)));

  const seq = readSeqParam(request.nextUrl);
  const state = await loadCallWebhookState(callId, "gather-continue");
  timer.mark("load_call");
  if (!state) return twiml(`<Response><Say>Sorry, something went wrong. Goodbye.</Say><Hangup/></Response>`);
  const { call, authToken, voice } = state;

  const signature = request.headers.get("x-twilio-signature");
  const fullUrl = getRequestUrl(request);
  if (!validateTwilioSignature(signature, fullUrl, params, authToken)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  // Join rather than replace — this branch only exists because the
  // customer kept talking, so both fragments belong to one utterance.
  const combinedSpeech = [original, params.SpeechResult].filter(Boolean).join(" ").trim();

  if (!combinedSpeech) {
    // Not expected in practice (Twilio only calls this action when it
    // actually captured speech), but fail the same safe way /gather's
    // own no-speech case does rather than a dead-end hangup.
    const gatherAction = gatherActionUrl(callId, seq);
    return twiml(`<Response>
  ${speechGatherOpen(gatherAction, 15, { retryOnSilence: true })}
    ${sayLine(voice, "Sorry, could you say that again?", call.business_id)}
  </Gather>
  ${sayLine(voice, "I'm not able to hear you — please call back. Goodbye.", call.business_id)}
  <Hangup/>
</Response>`);
  }

  return runPhoneTurn({ businessId: call.business_id, callId, speech: combinedSpeech, seq, timer, voice });
}
