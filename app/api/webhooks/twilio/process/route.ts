import { NextRequest, NextResponse } from "next/server";
import { runPhoneTurn } from "@/lib/ai/turnRunner";
import { loadCallWebhookState } from "@/lib/ai/callWebhook";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { twiml, getRequestUrl, readSeqParam } from "@/lib/ai/twimlHelpers";
import { warmResponse } from "@/lib/ai/warmup";
import { createTimer, shortId } from "@/lib/monitoring/timing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Start-up ping sent from the voice webhook while the greeting plays (see
// lib/ai/warmup.ts). Does no work and returns nothing.
export async function GET() {
  return warmResponse();
}

/**
 * POST /api/webhooks/twilio/process
 *
 * Reached via <Redirect> from /gather, right after the caller has
 * already heard a quick "one moment" acknowledgment (only for the slow
 * turns: placing the order, handing the caller to a person). This is where
 * the actual (slower) work happens: the real Claude call, tool execution,
 * the payment link, etc. — the same handleTurn() Test Receptionist uses.
 */
export async function POST(request: NextRequest) {
  const callId = request.nextUrl.searchParams.get("callId");
  const speechResult = request.nextUrl.searchParams.get("speech");
  if (!callId || !speechResult) return new NextResponse("Missing callId or speech", { status: 400 });

  const timer = createTimer("process", { call: shortId(callId) });
  try {
    const formData = await request.formData();
    const params: Record<string, string> = {};
    formData.forEach((value, key) => (params[key] = String(value)));

    const state = await loadCallWebhookState(callId, "process");
    timer.mark("load_call");
    if (!state) {
      return twiml(`<Response><Say>Sorry, something went wrong. Goodbye.</Say><Hangup/></Response>`);
    }
    const { call, authToken, voice } = state;

    const signature = request.headers.get("x-twilio-signature");
    const fullUrl = getRequestUrl(request);
    if (!validateTwilioSignature(signature, fullUrl, params, authToken)) {
      return new NextResponse("Invalid signature", { status: 403 });
    }

    return await runPhoneTurn({ businessId: call.business_id, callId, speech: speechResult, seq: readSeqParam(request.nextUrl), timer, voice });
  } finally {
    timer.done();
  }
}
