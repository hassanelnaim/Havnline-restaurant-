import { createHmac, createHash, timingSafeEqual } from "crypto";

// Twilio's <Play> verb just fetches a plain URL — no way to attach a
// header or session token the way every other route in this app is
// protected. Without this, /api/tts was reachable by anyone who ever
// saw or guessed the URL: unbounded real ElevenLabs cost on our
// account, and fake usage_records could be injected against ANY
// businessId (see lib/usage/tracking.ts), corrupting that business's
// cost dashboard. This signs the exact params server-side the moment
// the URL is built (sayLine, in twimlHelpers.ts), and the route
// rejects anything that doesn't match or has expired.

const TTS_URL_LIFETIME_MS = 10 * 60 * 1000; // generous for a slow call plus Twilio's own retry

function getSigningKey(): Buffer {
  // Derived from a secret that's already server-only and already
  // required in production — never a new env var to configure —
  // hashed once with a fixed, purpose-specific prefix so this is never
  // the same bytes as the source secret itself.
  const source = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TWILIO_AUTH_TOKEN;
  if (!source) throw new Error("Cannot sign TTS requests: no SUPABASE_SERVICE_ROLE_KEY or TWILIO_AUTH_TOKEN is configured.");
  return createHash("sha256").update(`havnline-tts-signing-key:${source}`).digest();
}

export interface TtsParams {
  text: string;
  voiceId: string;
  providerVoiceRef?: string | null;
  businessId?: string | null;
  speakingRate?: number | null;
}

function canonicalize(params: TtsParams, expiresAt: number): string {
  return [
    `text=${params.text}`,
    `voiceId=${params.voiceId}`,
    `providerVoiceRef=${params.providerVoiceRef || ""}`,
    `businessId=${params.businessId || ""}`,
    `speakingRate=${params.speakingRate ?? ""}`,
    `exp=${expiresAt}`,
  ].join("&");
}

export function signTtsParams(params: TtsParams): { signature: string; expiresAt: number } {
  const expiresAt = Date.now() + TTS_URL_LIFETIME_MS;
  const signature = createHmac("sha256", getSigningKey()).update(canonicalize(params, expiresAt)).digest("base64url");
  return { signature, expiresAt };
}

export function verifyTtsParams(params: TtsParams, expiresAt: number, signature: string | null): boolean {
  if (!signature) return false;
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const expected = createHmac("sha256", getSigningKey()).update(canonicalize(params, expiresAt)).digest("base64url");
  const expectedBuf = Buffer.from(expected);
  const gotBuf = Buffer.from(signature);
  if (expectedBuf.length !== gotBuf.length) return false;
  return timingSafeEqual(expectedBuf, gotBuf);
}
