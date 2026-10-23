import { NextRequest, NextResponse } from "next/server";
import { loadCallWebhookState } from "@/lib/ai/callWebhook";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { twiml, escapeXml, buildTurnResponseTwiml, sayLine, getRequestUrl, errorFallbackTwiml } from "@/lib/ai/twimlHelpers";
import { waitForTurnReply } from "@/lib/ai/turnRecord";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE_URL = getSiteUrl();
const WAIT_PER_REQUEST_MS = 11_000;
const MAX_WAITS = 2;

/**
 * POST /api/webhooks/twilio/turn-wait?callId=...&seq=...&n=...
 *
 * Where Twilio goes when a turn ran past the deadline (lib/ai/turnRunner.ts):
 * the caller has just heard "Just a moment" and the turn is still finishing
 * in the background. This picks up its reply as soon as it's saved. After
 * two waits with nothing, the call is handled like any other AI failure.
 */
export async function POST(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get("callId");
  const seq = Number(request.nextUrl.searchParams.get("seq"));
  const n = Number(request.nextUrl.searchParams.get("n") || "1");
  if (!callId || !Number.isInteger(seq) || seq < 0) return new NextResponse("Missing callId or seq", { status: 400 });

  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => (params[key] = String(value)));

  const state = await loadCallWebhookState(callId, "turn-wait");
  if (!state) return twiml(`<Response><Say>Sorry, something went wrong. Goodbye.</Say><Hangup/></Response>`);
  const { call, authToken, voice } = state;
  if (!validateTwilioSignature(request.headers.get("x-twilio-signature"), getRequestUrl(request), params, authToken)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const stored = await waitForTurnReply(callId, seq, WAIT_PER_REQUEST_MS);
  if (stored) return buildTurnResponseTwiml(call.business_id, callId, stored, voice);

  if (n < MAX_WAITS) {
    const next = `${SITE_URL}/api/webhooks/twilio/turn-wait?callId=${callId}&seq=${seq}&n=${n + 1}`;
    return twiml(`<Response>
  ${sayLine(voice, "Thanks for waiting, almost there.", call.business_id)}
  <Redirect method="POST">${escapeXml(next)}</Redirect>
</Response>`);
  }
  return errorFallbackTwiml(call.business_id, callId, voice, new Error(`Turn ${seq} of call ${callId} produced no reply after the deadline and ${MAX_WAITS} waits.`));
}
