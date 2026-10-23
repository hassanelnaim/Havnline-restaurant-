import { createHmac, createHash, timingSafeEqual, randomBytes, createCipheriv, createDecipheriv } from "crypto";

// Twilio's <Play> verb just fetches a plain URL — no way to attach a
// header or session token the way every other route in this app is
// protected. Without this, /api/tts was reachable by anyone who ever
// saw or guessed the URL: unbounded real ElevenLabs cost on our
// account, and fake usage_records could be injected against ANY
// businessId (see lib/usage/tracking.ts), corrupting that business's
// cost dashboard. This signs the exact params server-side the moment
// the URL is built (sayLine, in twimlHelpers.ts), and the route
// rejects anything that doesn't match or has expired.

// Twilio fetches the audio the moment it reads the reply, so 3 minutes
// covers a slow turn and Twilio's own retry. It used to be 10: a copied URL
// could be replayed for that long, and each uncached fetch costs credits.
const TTS_URL_LIFETIME_MS = 3 * 60 * 1000;

function getSigningKey(): Buffer {
  // Derived from a secret that's already server-only and already
  // required in production — never a new env var to configure —
  // hashed once with a fixed, purpose-specific prefix so this is never
  // the same bytes as the source secret itself.
  // SIGNING_SECRET (optional, any long random string) keeps these signatures
  // independent of the database key: rotating the Supabase service key after
  // a leak no longer breaks voice audio and tablet unlocks mid-use.
  const source = process.env.SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TWILIO_AUTH_TOKEN;
  if (!source) throw new Error("Cannot sign TTS requests: no SUPABASE_SERVICE_ROLE_KEY or TWILIO_AUTH_TOKEN is configured.");
  return createHash("sha256").update(`havnline-tts-signing-key:${source}`).digest();
}

export interface TtsParams {
  text: string;
  voiceId: string;
  providerVoiceRef?: string | null;
  businessId?: string | null;
}

function canonicalize(params: TtsParams, expiresAt: number): string {
  return [
    `text=${params.text}`,
    `voiceId=${params.voiceId}`,
    `providerVoiceRef=${params.providerVoiceRef || ""}`,
    `businessId=${params.businessId || ""}`,
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

/**
 * The words of a spoken line travel to /api/tts inside the audio URL that
 * Twilio fetches, and request URLs are logged (by Twilio and Vercel). A
 * reply like "That's $14.99 for Jane, I'll text 313-555-0100" ended up in
 * those logs. The text is now encrypted (AES-256-GCM) before it goes in the
 * URL; only this server can read it back.
 */
function textKey(): Buffer {
  const source = process.env.SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TWILIO_AUTH_TOKEN;
  if (!source) throw new Error("Cannot encrypt TTS text: no SIGNING_SECRET, SUPABASE_SERVICE_ROLE_KEY or TWILIO_AUTH_TOKEN is configured.");
  return createHash("sha256").update(`havnline-tts-text-key:${source}`).digest();
}

export function sealTtsText(text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", textKey(), iv);
  const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** null if it wasn't sealed by this server (or the key changed). */
export function openTtsText(sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", textKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
