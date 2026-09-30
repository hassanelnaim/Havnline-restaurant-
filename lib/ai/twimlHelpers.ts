import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTwilioVoice } from "@/lib/integrations/telephony/twilioProvider";
import { isElevenLabsConfigured } from "@/lib/integrations/telephony/elevenlabsProvider";
import type { HandleTurnResult } from "@/lib/ai/receptionist";
import type { VoiceId } from "@/lib/database/types";
import { getSiteUrl } from "@/lib/env";

const SITE_URL = getSiteUrl();

export interface VoiceSelection {
  voiceId: VoiceId | null | undefined;
  providerVoiceRef?: string | null;
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
  if (isElevenLabsConfigured()) {
    const params = new URLSearchParams({ text, voiceId: voice.voiceId || "alex_professional" });
    if (voice.providerVoiceRef) params.set("providerVoiceRef", voice.providerVoiceRef);
    if (businessId) params.set("businessId", businessId);
    const ttsUrl = `${SITE_URL}/api/tts?${params.toString()}`;
    return `<Play>${escapeXml(ttsUrl)}</Play>`;
  }
  const twilioVoice = resolveTwilioVoice(voice.voiceId as any);
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

// Previously this matched on a very broad keyword list ("menu", "price",
// "hours", "open", "pickup", ...) that fires on almost any food-related
// sentence, even ones the AI answers instantly from the system prompt
// with no tool call at all (the menu and hours are already right there
// in its instructions). That made the filler line play constantly and
// for the wrong reason — the caller hears "let me check that" before a
// question that needed no checking.
//
// This now only matches turns that actually trigger a real, slower tool
// round-trip — a DB write, a Stripe Checkout Session, an SMS send, a
// live transfer — and picks a filler that's actually about what's
// happening, instead of one random generic line every time.
const FILLER_CATEGORIES: { keywords: string[]; fillers: string[] }[] = [
  {
    // add_item_to_order / remove_item_from_order — a real DB write per
    // item, plus a menu/modifier lookup.
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
    // escalate_to_human / transfer_call — a DB write and (for a
    // transfer) a live outbound call setup.
    keywords: [
      "speak to", "talk to", "a real person", "a human", "a manager", "refund",
      "complaint", "already placed", "change my order i already", "cancel my order",
    ],
    fillers: ["Okay, let me get that handled.", "Sure, one moment."],
  },
];

/**
 * Returns a filler line to say before the slower work happens, or null
 * if this turn is likely fast enough to just answer directly. Checking
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
  return previousTurnUsedTool ? "Sure, one moment." : null;
}

export { resolveTwilioVoice };
