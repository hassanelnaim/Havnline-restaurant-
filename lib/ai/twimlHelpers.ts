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

const LIKELY_SLOW_KEYWORDS = [
  "order", "menu", "add", "remove", "change my order", "modify",
  "cancel", "substitute", "instead", "allergen", "gluten", "allergy",
  "price", "cost", "how much", "hours", "open", "closed", "delivery",
  "pickup", "takeout", "refund", "talk to", "speak to", "human", "person",
];

export function textLikelyNeedsTool(text: string): boolean {
  const lower = text.toLowerCase();
  return LIKELY_SLOW_KEYWORDS.some((kw) => lower.includes(kw));
}

export { resolveTwilioVoice };
