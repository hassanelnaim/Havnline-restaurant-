import { NextRequest, NextResponse } from "next/server";
import { synthesizeSpeech, resolveElevenLabsVoiceId, getTtsMode, TtsError } from "@/lib/integrations/telephony/elevenlabsProvider";
import { tripTtsCircuit } from "@/lib/integrations/telephony/ttsCircuit";
import { sendPlatformAlert, settleWithin } from "@/lib/monitoring/platformAlert";
import { logElevenLabsUsage } from "@/lib/usage/tracking";
import { verifyTtsParams } from "@/lib/integrations/telephony/ttsSigning";
import { getCachedTts, storeCachedTts } from "@/lib/integrations/telephony/ttsCache";
import { isCacheableTtsLine } from "@/lib/ai/twimlHelpers";
import type { VoiceId } from "@/lib/database/types";

// Generous for any single spoken line — nothing the AI says on a call
// or in the test chat is anywhere near this long. Exists purely to cap
// worst-case cost if this URL is ever hit directly.
const MAX_TEXT_LENGTH = 2000;

export async function GET(request: NextRequest) {
  const text = request.nextUrl.searchParams.get("text");
  const voiceId = request.nextUrl.searchParams.get("voiceId") as VoiceId | null;
  const providerVoiceRef = request.nextUrl.searchParams.get("providerVoiceRef");
  const businessId = request.nextUrl.searchParams.get("businessId");
  const exp = Number(request.nextUrl.searchParams.get("exp"));
  const sig = request.nextUrl.searchParams.get("sig");

  if (!text) return new NextResponse("Missing text", { status: 400 });
  if (text.length > MAX_TEXT_LENGTH) return new NextResponse("Text too long", { status: 400 });

  // Twilio's <Play> can't send an auth header, so this URL is the only
  // thing standing between the public internet and a real ElevenLabs
  // charge — it must have been signed by us, for these exact params,
  // and not have expired. See lib/integrations/telephony/ttsSigning.ts.
  if (!verifyTtsParams({ text, voiceId: voiceId || "", providerVoiceRef, businessId }, exp, sig)) {
    return new NextResponse("Invalid or expired request", { status: 403 });
  }

  try {
    const elevenVoiceId = resolveElevenLabsVoiceId(voiceId, providerVoiceRef);

    // Only the fixed filler/boilerplate lines and the call greeting
    // (business name only) are ever cached — a dynamic AI reply
    // (anything with a name, number, or order detail in it) always
    // falls through to a fresh synthesis below and is never looked up
    // or stored here. See ttsCache.ts.
    const cacheable = isCacheableTtsLine(text);
    if (cacheable) {
      const cached = await getCachedTts(elevenVoiceId, text);
      if (cached) {
        if (businessId) logElevenLabsUsage(businessId, text.length);
        return new NextResponse(cached, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
      }
    }

    const audioBuffer = await synthesizeSpeech(text, elevenVoiceId, {
      // Two 429s in a row means we are at the account's ceiling, not
      // just unlucky. When there is somewhere better than silence to
      // send traffic (Twilio-hosted ElevenLabs, "auto" mode), start
      // sending it there now — short trip, so the app returns to its
      // own ElevenLabs quickly once the burst passes.
      onSaturated: () => {
        if (getTtsMode() === "auto") void tripTtsCircuit("ElevenLabs concurrency limit reached (repeated 429)", 10);
      },
    });

    // Real usage logging, attributed to whichever business this
    // speech was generated for — fire-and-forget, never delays the
    // actual audio response.
    if (businessId) logElevenLabsUsage(businessId, text.length);

    if (cacheable) {
      // Fire-and-forget — the caller (Twilio) is waiting on the audio
      // response below, not on this write ever completing.
      storeCachedTts(elevenVoiceId, text, audioBuffer).catch((err) => console.error("TTS cache store failed:", err));
    }

    return new NextResponse(audioBuffer, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("TTS synthesis failed:", err);
    // Retries inside synthesizeSpeech are already exhausted by the time
    // we're here. If the provider as a whole is what's failing (limit
    // hit, outage, quota), flip the shared breaker so the next turns of
    // every live call switch to Twilio's built-in voice for a few
    // seconds instead of each one also hitting this and playing
    // silence. A request-specific failure (bad voice id) says nothing
    // about the provider's health and deliberately doesn't trip it.
    if (err instanceof TtsError && err.unavailable) {
      await tripTtsCircuit(err.message);
      await settleWithin(
        sendPlatformAlert({
          key: "elevenlabs-tts-unavailable",
          subject: "HavnLine: ElevenLabs could not produce speech",
          heading: "Speech generation is failing",
          intro:
            "HavnLine's own ElevenLabs account could not produce speech after retrying. Callers are being switched to the backup voice for a short time. If this is a concurrency limit, see the speech settings; if it is a quota or key problem, check the ElevenLabs dashboard.",
          rows: [
            { label: "Status", value: err.status === null ? "no response" : String(err.status) },
            { label: "Detail", value: err.message.slice(0, 300) },
          ],
        }),
        1500
      );
    }
    return new NextResponse("TTS failed", { status: 503 });
  }
}
