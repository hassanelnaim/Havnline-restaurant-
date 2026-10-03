import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Persistent cache for synthesized ElevenLabs audio, used ONLY for the
 * fixed set of lines in lib/ai/twimlHelpers.ts's STATIC_TTS_LINES (the
 * AI's filler lines and boilerplate) — never for a dynamic AI reply,
 * which differs on every call and would just be a cache miss anyway
 * while still (unnecessarily) persisting synthesized speech of
 * whatever a customer said their name/number/order was.
 *
 * Every one of these lines gets spoken, unchanged, on a large fraction
 * of calls — "Sure, adding that now," "Thanks for calling. Goodbye,"
 * and the rest. Before this, EVERY one of those was a fresh round trip
 * to ElevenLabs, every single time, on every call, for every business
 * — pure added latency (part of the reported 2-3s per-turn delay) and
 * pure added cost for audio that's byte-for-byte identical to audio
 * already generated moments ago. This makes that a one-time cost per
 * (voice, line) pair instead.
 */

function cacheKey(elevenVoiceId: string, text: string): string {
  return createHash("sha256").update(`${elevenVoiceId}::${text}`).digest("hex");
}

export async function getCachedTts(elevenVoiceId: string, text: string): Promise<ArrayBuffer | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("tts_audio_cache")
      .select("audio_base64")
      .eq("eleven_voice_id", elevenVoiceId)
      .eq("text_hash", cacheKey(elevenVoiceId, text))
      .maybeSingle();

    if (!data?.audio_base64) return null;
    // Buffer.from can slice its result from Node's shared internal
    // pool for small allocations, so `.buffer` alone isn't reliably
    // bounded to just this data — slice explicitly by byteOffset/
    // byteLength rather than risk handing back extra bytes from
    // neighboring pooled allocations.
    const buf = Buffer.from(data.audio_base64, "base64");
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch (err) {
    // A cache read failure should never take down real-time speech —
    // just fall through to synthesizing it fresh, same as a cache miss.
    console.error("TTS cache read failed:", err);
    return null;
  }
}

export async function storeCachedTts(elevenVoiceId: string, text: string, audioBuffer: ArrayBuffer): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("tts_audio_cache").upsert(
      {
        eleven_voice_id: elevenVoiceId,
        text_hash: cacheKey(elevenVoiceId, text),
        audio_base64: Buffer.from(audioBuffer).toString("base64"),
      },
      { onConflict: "eleven_voice_id,text_hash" }
    );
  } catch (err) {
    // Fire-and-forget from the caller's perspective — never let a
    // failed cache WRITE fail or delay the response that's already
    // about to play the audio it's trying to cache.
    console.error("TTS cache write failed:", err);
  }
}
