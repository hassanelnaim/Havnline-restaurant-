import { createAdminClient } from "@/lib/supabase/admin";
import { withCallKey } from "@/lib/ai/callUrlKey";
import { runAfterResponse } from "@/lib/runtime/afterResponse";
import { resolveTwilioVoice } from "@/lib/integrations/telephony/twilioProvider";
import { isElevenLabsConfigured, twilioHostedElevenLabsVoice, chooseSpeechPath } from "@/lib/integrations/telephony/elevenlabsProvider";
import { logTwilioHostedTtsUsage } from "@/lib/usage/tracking";
import { sendPlatformAlert, settleWithin } from "@/lib/monitoring/platformAlert";
import { isGreetingLine } from "@/lib/ai/greeting";
import { FILLER_CATEGORIES, PLACING_ORDER_FILLERS, ACK_FILLER, POST_ORDER_GOODBYE, POST_ORDER_LISTEN_SECONDS, getContextualFiller, CALL_CAP_LINE, ALREADY_ON_LINE_LINE, TURN_RETRY_LINE } from "@/lib/ai/fillers";
import { signTtsParams, sealTtsText } from "@/lib/integrations/telephony/ttsSigning";
import { LIVE_TRANSFER_MARKER, escalationTargetPhone, toDialableNumber } from "@/lib/ai/liveTransfer";
import type { HandleTurnResult } from "@/lib/ai/receptionist";
import type { VoiceId } from "@/lib/database/types";
import { getSiteUrl } from "@/lib/env";
import { isTransientAiError } from "@/lib/ai/errors";
import { toSpeech } from "@/lib/ai/speakable";

const SITE_URL = getSiteUrl();

const MAX_RECOVERED_AI_ERRORS_PER_CALL = 2;

export interface VoiceSelection {
  voiceId: VoiceId | null | undefined;
  providerVoiceRef?: string | null;
  /**
   * True while the shared ElevenLabs circuit breaker is tripped (see
   * lib/integrations/telephony/ttsCircuit.ts) — sayLine then uses
   * Twilio's built-in voice instead of a <Play> that would just fail.
   */
  ttsDegraded?: boolean;
}

export function twiml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    headers: { "Content-Type": "text/xml" },
  });
}

export function getRequestUrl(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  const proto = request.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}${url.pathname}${url.search}`;
}

/**
 * The URL a <Gather> posts the caller's speech to. `seq` is how many things
 * the caller had said when this TwiML was issued; handleTurn uses it to tell
 * a repeated request apart from the caller saying the same word again.
 * Omitted when it isn't known.
 */
export function gatherActionUrl(callId: string, seq?: number | null, missed?: number): string {
  let url = `${SITE_URL}/api/webhooks/twilio/gather?callId=${callId}`;
  if (typeof seq === "number" && Number.isFinite(seq)) url += `&seq=${seq}`;
  if (typeof missed === "number" && missed > 0) url += `&miss=${missed}`;
  return withCallKey(url, callId);
}

/** How many times in a row nothing was heard (see the gather route). */
export function readMissParam(url: URL): number {
  const raw = url.searchParams.get("miss");
  return raw && /^\d{1,2}$/.test(raw) ? parseInt(raw, 10) : 0;
}

/**
 * Words a caller often answers with in one or two syllables. Twilio's speech
 * recognition most often misses short answers, and a "yes" it doesn't catch
 * is heard as silence. Listing them as hints makes them far likelier to be
 * recognised.
 */
const SPEECH_HINTS = [
  "yes", "yeah", "yep", "yes please", "no", "nope", "no thanks", "correct", "that's correct", "that's right",
  "that's it", "that's all", "that's everything", "nothing else", "sounds good", "okay", "sure", "go ahead",
  "place the order", "plain", "one", "two", "three",
].join(", ");

/**
 * The opening <Gather> tag for listening to the caller. One place, so every
 * listen step uses the same recognition settings:
 * - phone_call model with `enhanced` (Twilio's recommended setup for short
 *   answers on phone audio) and the hints above;
 * - `retryOnSilence`: when nothing is heard, still post to the action URL
 *   (actionOnEmptyResult) so the caller is asked again instead of the call
 *   moving on to "goodbye". Off for the filler's short listen (silence there
 *   is normal and continues to the real answer) and after an order is placed.
 * The listening times themselves (timeout, speechTimeout) are unchanged.
 */
/**
 * Speech recognition settings. By default: Twilio's phone_call model with
 * "auto" end-of-speech detection, unchanged.
 *
 * For testing a faster recogniser, set SPEECH_MODEL in Vercel (for example
 * "deepgram_nova-3"; Twilio also offers "deepgram_nova-2" and
 * "googlev2_telephony"). Twilio requires a fixed number of seconds of
 * silence instead of "auto" with these models: SPEECH_END_SECONDS, default
 * 1. Remove SPEECH_MODEL to go back to the default.
 */
function speechRecognitionAttributes(): string {
  const model = (process.env.SPEECH_MODEL || "").trim();
  if (!model || !/^[a-z0-9_.-]+$/i.test(model)) return `speechTimeout="auto" speechModel="phone_call" enhanced="true"`;
  const seconds = Math.min(5, Math.max(1, parseInt(process.env.SPEECH_END_SECONDS || "1", 10) || 1));
  return `speechTimeout="${seconds}" speechModel="${model}"`;
}

export function speechGatherOpen(action: string, timeoutSeconds: number, opts: { retryOnSilence?: boolean } = {}): string {
  return `<Gather input="speech" action="${escapeXml(action)}" method="POST" ${speechRecognitionAttributes()} hints="${escapeXml(SPEECH_HINTS)}" timeout="${timeoutSeconds}"${opts.retryOnSilence ? ' actionOnEmptyResult="true"' : ""}>`;
}

/** Reads `seq` from a request URL; null when absent or not a whole number. */
export function readSeqParam(url: URL): number | null {
  const raw = url.searchParams.get("seq");
  if (raw === null || !/^\d{1,6}$/.test(raw)) return null;
  return parseInt(raw, 10);
}

export function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Builds the TwiML markup for a single spoken line. Which of three paths
 * it takes is decided by chooseSpeechPath (TTS_MODE, provider health):
 * <Play> of audio from /api/tts (this app's ElevenLabs), <Say> with the
 * same ElevenLabs voice hosted by Twilio, or <Say> with a Polly voice.
 */
export function sayLine(voice: VoiceSelection, rawText: string, businessId?: string): string {
  // Spoken form: no "1 x", dashes, "$" or brackets read out literally (see
  // lib/ai/speakable.ts). Plain sentences, including every fixed line and
  // the greeting, come out unchanged, so their cached audio still matches.
  const text = toSpeech(rawText);
  const path = chooseSpeechPath({
    voiceId: voice.voiceId,
    providerVoiceRef: voice.providerVoiceRef,
    ttsDegraded: Boolean(voice.ttsDegraded),
    elevenConfigured: isElevenLabsConfigured(),
  });

  if (path === "play") {
    const voiceId = voice.voiceId || "alex_professional";
    const providerVoiceRef = voice.providerVoiceRef || undefined;
    // The words go in encrypted (t=), not readable (text=): request URLs end
    // up in Twilio's and Vercel's logs. The signature covers the sealed form.
    const sealed = sealTtsText(text);
    const { signature, expiresAt } = signTtsParams({ text: sealed, voiceId, providerVoiceRef, businessId });
    const params = new URLSearchParams({ t: sealed, voiceId, exp: String(expiresAt), sig: signature });
    if (providerVoiceRef) params.set("providerVoiceRef", providerVoiceRef);
    if (businessId) params.set("businessId", businessId);
    const ttsUrl = `${SITE_URL}/api/tts?${params.toString()}`;
    return `<Play>${escapeXml(ttsUrl)}</Play>`;
  }

  if (path === "twilio-hosted") {
    // The same ElevenLabs voice, spoken by Twilio on Twilio's own
    // ElevenLabs capacity (see chooseSpeechPath / TTS_MODE) — so this
    // line never touches this app's ElevenLabs concurrency limit.
    // Nothing else records this speech (the /api/tts route that logs
    // usage for the <Play> path isn't involved), so log it here.
    if (businessId) runAfterResponse("Twilio-hosted voice usage log", logTwilioHostedTtsUsage(businessId, text.length));
    return `<Say voice="${twilioHostedElevenLabsVoice(voice.voiceId, voice.providerVoiceRef)}">${escapeXml(text)}</Say>`;
  }

  return `<Say voice="${resolveTwilioVoice(voice.voiceId as any)}">${escapeXml(text)}</Say>`;
}

export async function buildTurnResponseTwiml(
  businessId: string,
  callId: string,
  result: HandleTurnResult,
  voice: VoiceSelection
): Promise<Response> {
  const transferCall = result.toolCalls.find(
    (tc) =>
      (tc.name === "transfer_call" && (tc.result as any)?.transferring) ||
      (tc.name === "escalate_to_human" && (tc.result as any)?.live_transfer)
  );
  if (transferCall) {
    const admin = createAdminClient();
    const [{ data: business }, { data: twilioIntegration }] = await Promise.all([
      admin.from("businesses").select("phone, escalation_phone").eq("id", businessId).single(),
      admin.from("integrations").select("metadata").eq("business_id", businessId).eq("provider", "twilio").maybeSingle(),
    ]);

    const getMadeNumber = (twilioIntegration?.metadata as Record<string, unknown> | null)?.phone_number as string | undefined;

    // The escalation number when the business set one; otherwise the main
    // phone. Never both: setting a separate number takes escalated calls
    // off the main line.
    const transferTo = toDialableNumber(business ? escalationTargetPhone(business) : null);
    if (transferTo) {
      // Marker: tells the escalation tool a transfer was already tried
      // on this call, and lets the voice webhook spot it coming back.
      await admin.from("call_messages").insert({ call_id: callId, role: "system", content: `${LIVE_TRANSFER_MARKER} ${transferTo}` });
      const callerIdAttr = getMadeNumber ? ` callerId="${escapeXml(getMadeNumber)}"` : "";
      const dialStatusAction = withCallKey(`${SITE_URL}/api/webhooks/twilio/dial-status?callId=${callId}`, callId);
      return twiml(`<Response>
  ${sayLine(voice, "One moment while I connect you.", businessId)}
  <Dial${callerIdAttr} timeout="20" action="${escapeXml(dialStatusAction)}" method="POST">${escapeXml(transferTo)}</Dial>
</Response>`);
    }
  }

  const gatherAction = gatherActionUrl(callId, result.turnCount);

  // The order is in. Waiting the usual 15 seconds of silence before
  // hanging up leaves the caller on a finished call with nothing
  // happening — so after confirming the order, allow a few seconds for
  // one last word, then say goodbye and hang up. (A caller who only
  // says "thanks" is ended immediately by the gather route, without
  // another trip to the AI.)
  const orderPlaced = result.toolCalls.some(
    (tc) => tc.name === "confirm_and_place_order" && tc.result?.success === true && Boolean(tc.result?.order_id)
  );
  const listenSeconds = orderPlaced ? POST_ORDER_LISTEN_SECONDS : 15;
  const closing = orderPlaced ? POST_ORDER_GOODBYE : "Thanks for calling. Goodbye.";

  return twiml(`<Response>
  ${speechGatherOpen(gatherAction, listenSeconds, { retryOnSilence: !orderPlaced })}
    ${sayLine(voice, result.reply, businessId)}
  </Gather>
  ${sayLine(voice, closing, businessId)}
  <Hangup/>
</Response>`);
}

/**
 * Fallback for when the AI turn itself throws — an Anthropic timeout,
 * a 5xx, a network error, or a bug in system-prompt building (e.g. a
 * bad business.timezone value). Without this, the route handler's
 * unhandled exception becomes a non-TwiML 500 response, which Twilio
 * can't parse — the caller gets dead air and the call just drops with
 * no record of what happened. This logs it the same way a failed live
 * transfer does (dial-status/route.ts) — a real escalation, not a
 * silent failure — and gives the caller a graceful, human-sounding
 * close instead of a crash.
 */
export async function errorFallbackTwiml(businessId: string, callId: string, voice: VoiceSelection, err: unknown): Promise<Response> {
  console.error(`AI turn failed for call ${callId}:`, err);
  const admin = createAdminClient();

  // Started now so it runs alongside the database work below; awaited
  // (briefly) before each return so serverless doesn't cut it off.
  const transient = isTransientAiError(err);
  const ownerAlert = sendPlatformAlert({
    key: transient ? "ai-turn-transient" : "ai-turn-error",
    subject: transient ? "HavnLine: AI provider hiccup during a call (recovered)" : "HavnLine: the AI failed mid-call",
    heading: transient ? "The AI provider had a temporary problem" : "The AI failed during a call",
    intro: transient
      ? "Anthropic was slow or rate-limited during a call. The caller was asked to repeat themselves. If this repeats, capacity or the provider is the cause."
      : "An unexpected error stopped the AI mid-call and the call was escalated to the business. This usually points to a bug rather than capacity.",
    rows: [
      { label: "Business", value: businessId },
      { label: "Call", value: callId },
      { label: "Error", value: (err instanceof Error ? err.message : String(err)).slice(0, 300) },
    ],
  });

  // A temporary capacity blip (the AI provider rate-limiting or timing
  // out during a rush) shouldn't end the call and page the owner — it
  // will very likely work a few seconds later. Ask the caller to repeat
  // themselves and keep listening. Capped at two recoveries per call so
  // a genuinely sustained outage still ends in the escalation path
  // below rather than an endless loop of apologies.
  if (transient) {
    const { count } = await admin
      .from("call_messages")
      .select("id", { count: "exact", head: true })
      .eq("call_id", callId)
      .eq("role", "system")
      .like("content", "AI turn error%");

    if ((count ?? 0) < MAX_RECOVERED_AI_ERRORS_PER_CALL) {
      await admin
        .from("call_messages")
        .insert({ call_id: callId, role: "system", content: `AI turn error (recovered by re-prompting): ${err instanceof Error ? err.message : String(err)}` });

      const gatherAction = gatherActionUrl(callId);
      await settleWithin(ownerAlert, 1500);
      return twiml(`<Response>
  ${speechGatherOpen(gatherAction, 15, { retryOnSilence: true })}
    ${sayLine(voice, "Sorry, I missed that. Could you say it again?", businessId)}
  </Gather>
  ${sayLine(voice, "I'm not able to hear you — please call back. Goodbye.", businessId)}
  <Hangup/>
</Response>`);
    }
  }

  await admin
    .from("calls")
    .update({ outcome: "escalated", escalation_reason: "The AI ran into a technical problem mid-call and couldn't continue." })
    .eq("id", callId);
  await admin
    .from("call_messages")
    .insert({ call_id: callId, role: "system", content: `AI turn error: ${err instanceof Error ? err.message : String(err)}` });

  const { sendEscalationEmail } = await import("@/lib/notifications/escalation-email");
  runAfterResponse("escalation email", sendEscalationEmail(businessId, callId));
  await settleWithin(ownerAlert, 1500);

  return twiml(`<Response>
  ${sayLine(voice, "Sorry, I'm having some technical trouble right now. I've made a note and someone from the team will follow up with you. Thanks for calling!", businessId)}
  <Hangup/>
</Response>`);
}

/**
 * The assistant's most recent reply on this call, and whether that turn
 * used a tool. One query, used to decide whether the next turn deserves a
 * filler (see fillers.ts: only the turn that follows a request for the
 * caller's name / number does).
 */
export async function getLastAiTurn(callId: string): Promise<{ content: string | null; usedTool: boolean }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("call_messages")
    .select("content, tool_call")
    .eq("call_id", callId)
    .eq("role", "ai")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { content: data?.content ?? null, usedTool: Boolean(data?.tool_call) };
}

export async function lastTurnUsedTool(callId: string): Promise<boolean> {
  return (await getLastAiTurn(callId)).usedTool;
}

// Every line of hard-coded, verbatim-repeated speech in this file and
// its callers — fillers plus the fixed boilerplate lines (goodbye,
// "didn't catch that," the error fallback, the transfer handoff). The
// same handful of lines get spoken, unchanged, on nearly every call,
// in whatever voice a business has picked — so synthesizing them fresh
// through ElevenLabs every single time is pure wasted latency (and
// cost) on top of the one piece of audio per turn that can't be
// avoided: the AI's own dynamic reply. See ttsCache.ts, which this
// backs — only text in this exact set is ever cached, so a customer's
// name, phone number, or order total (always part of a dynamic reply)
// never ends up persisted here.
export const STATIC_TTS_LINES: ReadonlySet<string> = new Set([
  ...FILLER_CATEGORIES.flatMap((c) => c.fillers),
  ...PLACING_ORDER_FILLERS,
  "Sure, one moment.",
  "Let's see.",
  ACK_FILLER,
  POST_ORDER_GOODBYE,
  "Sorry, could you say that again?",
  "Sorry, I missed that. Could you say it again?",
  "Just a moment.",
  "Thanks for waiting, almost there.",
  CALL_CAP_LINE,
  ALREADY_ON_LINE_LINE,
  TURN_RETRY_LINE,
  "I'm not able to hear you — please call back. Goodbye.",
  "One moment while I connect you.",
  "Thanks for calling. Goodbye.",
  "Sorry, I didn't catch that. Please call back. Goodbye.",
  "Sorry, I'm having some technical trouble right now. I've made a note and someone from the team will follow up with you. Thanks for calling!",
]);

/**
 * Whether the audio for this exact line may be stored and replayed:
 * the fixed filler/boilerplate lines, plus the call greeting (which
 * differs only by the business's own name). Anything else is a dynamic
 * AI reply and is never cached.
 */
// sayLine speaks the cleaned-up form of every line, so a fixed line is
// recognised in that form too.
const SPOKEN_STATIC_TTS_LINES: ReadonlySet<string> = new Set(Array.from(STATIC_TTS_LINES).map(toSpeech));

export function isCacheableTtsLine(text: string): boolean {
  return STATIC_TTS_LINES.has(text) || SPOKEN_STATIC_TTS_LINES.has(text) || isGreetingLine(text);
}

export { resolveTwilioVoice, getContextualFiller };
