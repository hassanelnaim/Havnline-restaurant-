import type { VoiceId } from "@/lib/database/types";

const DEFAULT_VOICE_MAP: Record<Exclude<VoiceId, "custom">, string> = {
  alex_professional: process.env.ELEVENLABS_VOICE_ALEX || "pNInz6obpgDQGcFmaJgB",
  sarah_warm: process.env.ELEVENLABS_VOICE_SARAH || "21m00Tcm4TlvDq8ikWAM",
  james_calm: process.env.ELEVENLABS_VOICE_JAMES || "VR6AewLTigWG4xSOukaG",
  emma_friendly: process.env.ELEVENLABS_VOICE_EMMA || "EXAVITQu4vr4xnSDxMaL",
};

export function isElevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export function resolveElevenLabsVoiceId(
  voiceId: VoiceId | null | undefined,
  providerVoiceRef?: string | null
): string {
  if (voiceId === "custom" && providerVoiceRef) return providerVoiceRef;
  if (voiceId && voiceId !== "custom") return DEFAULT_VOICE_MAP[voiceId];
  return DEFAULT_VOICE_MAP.alex_professional;
}

export async function synthesizeSpeech(text: string, elevenVoiceId: string): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured.");
  }

  // optimize_streaming_latency only applies to eleven_turbo_v2_5 /
  // eleven_flash_v2_5 — ElevenLabs rejects it outright (400
  // unsupported_model) when model_id is eleven_v4_turbo, which is
  // what's actually used below. v4 models have their own, different
  // latency behavior and don't take this param at all.
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${elevenVoiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        // eleven_turbo_v2_5 is deprecated (ElevenLabs now treats it as
        // just a slower version of eleven_flash_v2_5). eleven_v4_turbo
        // is the current real-time-appropriate model with noticeably
        // more natural output than either Turbo or Flash — still fast
        // enough for a live phone call (~100ms vs. Flash's ~75ms, a
        // difference a caller won't perceive), so this is a quality
        // upgrade with no real latency tradeoff for this use case.
        model_id: "eleven_v4_turbo",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed: ${response.status} ${errText}`);
  }

  return response.arrayBuffer();
}

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  previewUrl: string | null;
  category: string | null;
  description: string | null;
}

export async function listVoices(): Promise<ElevenLabsVoice[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured.");
  }

  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`ElevenLabs list voices failed: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const voices: any[] = data.voices || [];

  return voices.map((v) => ({
    voiceId: v.voice_id,
    name: v.name,
    previewUrl: v.preview_url || null,
    category: v.category || null,
    description: v.labels?.description || v.labels?.accent || null,
  }));
}
