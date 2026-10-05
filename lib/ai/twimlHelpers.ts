import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTwilioVoice } from "@/lib/integrations/telephony/twilioProvider";
import { isElevenLabsConfigured, twilioHostedElevenLabsVoice } from "@/lib/integrations/telephony/elevenlabsProvider";
import { isGreetingLine } from "@/lib/ai/greeting";
import { signTtsParams } from "@/lib/integrations/telephony/ttsSigning";
import type { HandleTurnResult } from "@/lib/ai/receptionist";
import type { VoiceId } from "@/lib/database/types";
import { getSiteUrl } from "@/lib/env";
import { isTransientAiError } from "@/lib/ai/errors";

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

export function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Builds the TwiML markup for a single spoken line. If ElevenLabs is
 * configured, uses <Play> pointing at /api/tts for real premium-voice
 * audio. If not configured, falls back to Twilio's own built-in
 * <Say> voice.
 */
export function sayLine(voice: VoiceSelection, text: string, businessId?: string): string {
  if (isElevenLabsConfigured() && !voice.ttsDegraded) {
    const voiceId = voice.voiceId || "alex_professional";
    const providerVoiceRef = voice.providerVoiceRef || undefined;
    const { signature, expiresAt } = signTtsParams({ text, voiceId, providerVoiceRef, businessId });
    const params = new URLSearchParams({ text, voiceId, exp: String(expiresAt), sig: signature });
    if (providerVoiceRef) params.set("providerVoiceRef", providerVoiceRef);
    if (businessId) params.set("businessId", businessId);
    const ttsUrl = `${SITE_URL}/api/tts?${params.toString()}`;
    return `<Play>${escapeXml(ttsUrl)}</Play>`;
  }
  // Overflow / fallback speech. When enabled (see
  // twilioHostedElevenLabsVoice), this is the SAME ElevenLabs voice the
  // caller was already hearing, played by Twilio under Twilio's own
  // ElevenLabs capacity instead of this app's — so a busy moment doesn't
  // change the voice mid-call. Otherwise it's a Polly neural voice.
  const twilioVoice = twilioHostedElevenLabsVoice(voice.voiceId) ?? resolveTwilioVoice(voice.voiceId as any);
  return `<Say voice="${twilioVoice}">${escapeXml(text)}</Say>`;
}

export async function buildTurnResponseTwiml(
  businessId: string,
  callId: string,
  result: HandleTurnResult,
  voice: VoiceSelection
): Promise<Response> {
  const transferCall = result.toolCalls.find((tc) => tc.name === "transfer_call" && (tc.result as any)?.transferring);
  if (transferCall) {
    const admin = createAdminClient();
    const [{ data: business }, { data: twilioIntegration }] = await Promise.all([
      admin.from("businesses").select("phone").eq("id", businessId).single(),
      admin.from("integrations").select("metadata").eq("business_id", businessId).eq("provider", "twilio").maybeSingle(),
    ]);

    const getMadeNumber = (twilioIntegration?.metadata as Record<string, unknown> | null)?.phone_number as string | undefined;

    if (business?.phone) {
      const callerIdAttr = getMadeNumber ? ` callerId="${escapeXml(getMadeNumber)}"` : "";
      const dialStatusAction = `${SITE_URL}/api/webhooks/twilio/dial-status?callId=${callId}`;
      return twiml(`<Response>
  ${sayLine(voice, "One moment while I connect you.", businessId)}
  <Dial${callerIdAttr} timeout="20" action="${escapeXml(dialStatusAction)}" method="POST">${escapeXml(business.phone)}</Dial>
</Response>`);
    }
  }

  const gatherAction = `${SITE_URL}/api/webhooks/twilio/gather?callId=${callId}`;

  return twiml(`<Response>
  <Gather input="speech" action="${escapeXml(gatherAction)}" method="POST" speechTimeout="auto" speechModel="phone_call" timeout="15">
    ${sayLine(voice, result.reply, businessId)}
  </Gather>
  ${sayLine(voice, "Thanks for calling. Goodbye.", businessId)}
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

  // A temporary capacity blip (the AI provider rate-limiting or timing
  // out during a rush) shouldn't end the call and page the owner — it
  // will very likely work a few seconds later. Ask the caller to repeat
  // themselves and keep listening. Capped at two recoveries per call so
  // a genuinely sustained outage still ends in the escalation path
  // below rather than an endless loop of apologies.
  if (isTransientAiError(err)) {
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

      const gatherAction = `${SITE_URL}/api/webhooks/twilio/gather?callId=${callId}`;
      return twiml(`<Response>
  <Gather input="speech" action="${escapeXml(gatherAction)}" method="POST" speechTimeout="auto" speechModel="phone_call" timeout="15">
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
  sendEscalationEmail(businessId, callId).catch((emailErr) => console.error("Escalation email failed:", emailErr));

  return twiml(`<Response>
  ${sayLine(voice, "Sorry, I'm having some technical trouble right now. I've made a note and someone from the team will follow up with you. Thanks for calling!", businessId)}
  <Hangup/>
</Response>`);
}

export async function lastTurnUsedTool(callId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("call_messages")
    .select("tool_call")
    .eq("call_id", callId)
    .eq("role", "ai")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return Boolean(data?.tool_call);
}

// Originally this only matched turns that triggered a real, slower
// tool round-trip (a DB write, a Stripe Checkout Session, an SMS send)
// because a broader list made the filler play before questions the AI
// answers instantly from the system prompt with no tool call at all —
// menu/hours/recommendation questions, which cost nothing in the
// database but still cost a full Claude round-trip plus fresh TTS
// synthesis of a never-seen-before reply (nothing to cache there,
// unlike these fixed filler lines). That's real, noticeable latency
// too — a caller asking "what do you recommend?" sat through dead air
// with nothing covering it. So this now covers both: real tool-backed
// turns (grouped first, since those are genuinely the slowest) AND the
// common question/conversation shapes that still take a real model
// round-trip, each with a filler that reads as the natural lead-in to
// that *kind* of answer — never the exact answer, since the filler is
// chosen before the model has generated anything.
const FILLER_CATEGORIES: { keywords: string[]; fillers: string[] }[] = [
  {
    // Customer says they want to order but hasn't named anything yet
    // ("I'd like to order," "can I place an order") — distinct from
    // naming an item directly below. No tool call yet; the AI's own
    // next line is naturally something like "what can I get for you,"
    // so the filler should read as the lead-in to that, not a
    // standalone "got it."
    keywords: [
      "like to order", "want to order", "place an order", "make an order", "start an order",
      "order something", "ready to order", "take my order",
    ],
    fillers: ["I'd love to take your order!", "Sure thing, let's get you set up.", "Happy to help with that."],
  },
  {
    // add_item_to_order on a NEW, already-named item ("I'll have a
    // burger," "can I get fries") — a menu lookup + a DB write, and
    // the single most common thing said on a call.
    keywords: [
      "i want", "i'd like", "i would like", "i'll have", "i will have", "i'll take",
      "i will take", "i'll get", "can i get", "can i have", "could i get", "could i have",
      "give me", "gimme", "get me", "let me get", "let me have", "i need", "i'll do",
    ],
    fillers: ["Sure, adding that now.", "Got it, one sec.", "Okay, putting that in."],
  },
  {
    // add_item_to_order / remove_item_from_order / update_item_quantity
    // / update_item_modifiers on something already in the order — a
    // real DB write per item, plus a menu/modifier lookup.
    keywords: [
      "add", "remove", "instead", "substitute", "change my order", "change that",
      "make that", "make it", "actually", "no onions", "extra", "swap", "cancel that",
      "different", "another one", "one more",
    ],
    fillers: ["Sure, updating that now.", "Got it, one sec.", "Okay, making that change."],
  },
  {
    // confirm_and_place_order — genuinely the slowest path: a Checkout
    // Session with a payment-enabled business, a kitchen print job, and
    // a confirmation text all happen here.
    keywords: [
      "that's it", "that's all", "that's everything", "place my order", "place the order",
      "go ahead and order", "sounds good, order", "yes, place", "checkout", "ready to order",
      "that's my order", "that should do it",
    ],
    fillers: ["Great, placing that order now.", "Perfect, locking that in.", "Okay, sending that through."],
  },
  {
    // lookup_customer / create_customer — asked right after the order
    // is read back, once the customer gives their name and number.
    keywords: [
      "my name is", "my number is", "phone number", "here's my number",
    ],
    fillers: ["Got it, thanks.", "Okay, one sec."],
  },
  {
    // escalate_to_human / transfer_call — a DB write and (for a
    // transfer) a live outbound call setup.
    keywords: [
      "speak to", "talk to", "a real person", "a human", "a manager", "refund",
      "complaint", "already placed", "change my order i already", "cancel my order",
    ],
    fillers: ["Okay, let me get that handled.", "Sure, one moment."],
  },
  {
    // No tool call at all — answered straight from the menu already in
    // the system prompt — but asking for a recommendation specifically
    // deserves its own warmer lead-in rather than the generic
    // "let me check" lines below, which read oddly before an opinion.
    keywords: [
      "recommend", "what's good", "what is good", "what do you suggest", "any suggestions",
      "what should i get", "what should i order", "favorite", "best seller", "most popular",
      "what's your favorite",
    ],
    fillers: ["Ooh, good question — let me think.", "Happy to suggest something.", "Let's see what I'd pick for you."],
  },
  {
    // No tool call — a factual lookup the AI already has (an item, a
    // price, what's in something, an ingredient/allergy question).
    keywords: [
      "how much is", "how much are", "what comes with", "what's in", "what is in", "does it come with",
      "do you have", "is there", "what kind of", "what size", "how big is", "allerg", "gluten", "vegan",
      "vegetarian", "calorie",
    ],
    fillers: ["Good question, let me check.", "Let's see here.", "One sec, let me take a look."],
  },
  {
    // No tool call — hours/location/general business info, already in
    // the system prompt.
    keywords: [
      "what time", "are you open", "when do you open", "when do you close", "how late", "what hours",
      "where are you", "your address", "your location", "do you deliver", "is this pickup only",
    ],
    fillers: ["Let me check that for you.", "One sec, let me look that up."],
  },
  {
    // No tool call — discounts/promos, already in the system prompt.
    keywords: ["discount", "deal", "special", "coupon", "promo", "any offers"],
    fillers: ["Let me see what we've got going on.", "Good question — one sec."],
  },
];

// Words that, alone, are too short to tell much from — "yes," "no,"
// "okay," "that's right" — and are genuinely fast (a trivial text
// reply, nothing novel to say). Keeping these filler-free is the one
// deliberate gap left in "basically every turn gets a filler," so the
// AI doesn't add a pause to the one case where it really would feel
// sluggish and repetitive rather than helpful.
const TRIVIAL_REPLY_WORD_LIMIT = 3;

/**
 * Returns a filler line to say before the slower work happens, or null
 * for the rare turn genuinely too short/trivial to need one. Checking
 * whether the *previous* turn used a tool still matters on its own —
 * mid-order-building conversations often continue across several fast
 * back-and-forth turns where only some invoke a tool.
 */
export function getContextualFiller(text: string, previousTurnUsedTool: boolean): string | null {
  const lower = text.toLowerCase();
  for (const category of FILLER_CATEGORIES) {
    if (category.keywords.some((kw) => lower.includes(kw))) {
      return category.fillers[Math.floor(Math.random() * category.fillers.length)];
    }
  }
  if (previousTurnUsedTool) return "Sure, one moment.";

  // Nothing matched a specific category — still almost always worth a
  // generic lead-in, since even a no-tool-call reply costs a full
  // model round trip plus fresh (uncached) speech synthesis. Only skip
  // it for a genuinely trivial, very short reply.
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount <= TRIVIAL_REPLY_WORD_LIMIT) return null;
  return "Let's see.";
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
  "Sure, one moment.",
  "Let's see.",
  "Sorry, could you say that again?",
  "Sorry, I missed that. Could you say it again?",
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
export function isCacheableTtsLine(text: string): boolean {
  return STATIC_TTS_LINES.has(text) || isGreetingLine(text);
}

export { resolveTwilioVoice };
