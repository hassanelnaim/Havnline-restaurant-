/**
 * The voices restaurants can pick. Only ElevenLabs' standard (default)
 * voices: Twilio speaks ElevenLabs voices from its own account (TTS_MODE
 * twilio) and supports the standard library, not voices added to our
 * ElevenLabs account or cloned, and when a voice isn't supported Twilio
 * skips the line and the caller hears nothing. English only, one of each
 * name. Source: https://elevenlabs.io/docs/voices/default-voices
 * (Charlotte left out: Swedish accent, labelled "seductive").
 */
export interface CatalogVoice {
  voiceId: string;
  name: string;
  gender: "Female" | "Male";
  accent: "American" | "British" | "Australian" | "Transatlantic";
  tone: string;
}

export const VOICE_CATALOG: CatalogVoice[] = [
  { voiceId: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "Female", accent: "American", tone: "Soft" },
  { voiceId: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", gender: "Female", accent: "American", tone: "Friendly" },
  { voiceId: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", gender: "Female", accent: "American", tone: "Upbeat" },
  { voiceId: "cgSgspJ2msm6clMCkdW9", name: "Jessica", gender: "Female", accent: "American", tone: "Expressive" },
  { voiceId: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", gender: "Female", accent: "British", tone: "Warm" },
  { voiceId: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", gender: "Female", accent: "British", tone: "Confident" },
  { voiceId: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", gender: "Male", accent: "American", tone: "Articulate" },
  { voiceId: "cjVigY5qzO86Huf0OWal", name: "Eric", gender: "Male", accent: "American", tone: "Friendly" },
  { voiceId: "bIHbv24MWmeRgasZH58o", name: "Will", gender: "Male", accent: "American", tone: "Friendly" },
  { voiceId: "iP95p4xoKVk53GoZ742B", name: "Chris", gender: "Male", accent: "American", tone: "Casual" },
  { voiceId: "pqHfZKP75CvOlQylNhV4", name: "Bill", gender: "Male", accent: "American", tone: "Trustworthy" },
  { voiceId: "nPczCjzI2devNBz1zQrb", name: "Brian", gender: "Male", accent: "American", tone: "Deep" },
  { voiceId: "JBFqnCBsd6RMkjVDRZzb", name: "George", gender: "Male", accent: "British", tone: "Warm" },
  { voiceId: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", gender: "Male", accent: "British", tone: "Authoritative" },
  { voiceId: "IKne3meq5aSn9XLyUdCD", name: "Charlie", gender: "Male", accent: "Australian", tone: "Natural" },
  { voiceId: "N2lVS1w4EtoT3dr4eOWO", name: "Callum", gender: "Male", accent: "Transatlantic", tone: "Intense" },
];

const BY_ID = new Map(VOICE_CATALOG.map((v) => [v.voiceId, v]));

export function catalogVoice(voiceId: string | null | undefined): CatalogVoice | null {
  return voiceId ? BY_ID.get(voiceId) ?? null : null;
}
