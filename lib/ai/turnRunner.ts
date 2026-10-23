import { handleTurn } from "@/lib/ai/receptionist";
import { buildTurnResponseTwiml, errorFallbackTwiml, sayLine, twiml, escapeXml, type VoiceSelection } from "@/lib/ai/twimlHelpers";
import { runAfterResponse } from "@/lib/runtime/afterResponse";
import { getSiteUrl } from "@/lib/env";
import type { Timer } from "@/lib/monitoring/timing";

/**
 * Twilio gives each webhook 15 seconds. A turn normally takes 2 to 6, but
 * a slow model reply plus a slow Stripe or database call used to run past
 * 15: Twilio gave up, the caller heard an error, and the turn kept going
 * anyway (it could still place the order), so a caller who called back
 * ordered twice.
 *
 * Now a turn that isn't done after TURN_DEADLINE_MS keeps running in the
 * background (waitUntil), the caller hears "Just a moment", and Twilio is
 * sent to /turn-wait, which picks up the reply as soon as it's saved.
 */
export const TURN_DEADLINE_MS = 11_500;

const SITE_URL = getSiteUrl();

export async function runPhoneTurn(input: {
  businessId: string;
  callId: string;
  speech: string;
  seq: number | null;
  timer: Timer;
  voice: VoiceSelection;
}): Promise<Response> {
  const { businessId, callId, speech, seq, timer, voice } = input;
  const turn = handleTurn(businessId, callId, speech, "phone", { timer, seq });
  // If we answer Twilio before the turn finishes, the turn must still
  // finish (and save its reply) rather than be frozen with the function.
  runAfterResponse("phone turn", turn);

  type Outcome = { kind: "done"; result: Awaited<typeof turn> } | { kind: "error"; err: unknown } | { kind: "slow" };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const outcome: Outcome = await Promise.race([
    turn.then((result) => ({ kind: "done" as const, result }), (err) => ({ kind: "error" as const, err })),
    new Promise<Outcome>((resolve) => {
      timeout = setTimeout(() => resolve({ kind: "slow" }), TURN_DEADLINE_MS);
    }),
  ]);
  if (timeout) clearTimeout(timeout);

  if (outcome.kind === "done") return buildTurnResponseTwiml(businessId, callId, outcome.result, voice);
  if (outcome.kind === "error") return errorFallbackTwiml(businessId, callId, voice, outcome.err);

  // Without a turn number the follow-up can't find this turn's reply; this
  // only happens on paths that predate seq, so fall back to waiting here.
  if (seq === null) {
    try {
      return buildTurnResponseTwiml(businessId, callId, await turn, voice);
    } catch (err) {
      return errorFallbackTwiml(businessId, callId, voice, err);
    }
  }

  timer.set("deadline", "redirected");
  const waitUrl = `${SITE_URL}/api/webhooks/twilio/turn-wait?callId=${callId}&seq=${seq}&n=1`;
  return twiml(`<Response>
  ${sayLine(voice, "Just a moment.", businessId)}
  <Redirect method="POST">${escapeXml(waitUrl)}</Redirect>
</Response>`);
}
