import { createHmac, createHash, timingSafeEqual } from "crypto";

/**
 * Short-lived proof that a paired tablet recently verified this
 * business's money PIN — unlocks refund/discount actions for a few
 * minutes without re-prompting for the PIN before every single tap.
 *
 * Modeled directly on lib/integrations/telephony/ttsSigning.ts: an
 * HMAC over a canonical string, derived from a secret that's already
 * server-only and already required in production, so there's no new
 * env var to configure and no server-side session state to store or
 * invalidate — the token is only ever checked against its own
 * signature and expiry.
 *
 * Scoped to BOTH businessId and deviceId, not just businessId: a
 * token can only unlock money actions for the exact device that
 * verified the PIN, so it can't be replayed against a different
 * business, or (if this business is ever re-paired to a different
 * tablet) against a different device than the one that earned it.
 */

const MONEY_ACTION_TOKEN_LIFETIME_MS = 5 * 60 * 1000;

function getSigningKey(): Buffer {
  const source = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TWILIO_AUTH_TOKEN;
  if (!source) throw new Error("Cannot sign money-action tokens: no SUPABASE_SERVICE_ROLE_KEY or TWILIO_AUTH_TOKEN is configured.");
  return createHash("sha256").update(`havnline-money-action-signing-key:${source}`).digest();
}

export interface MoneyActionTokenSubject {
  businessId: string;
  deviceId: string;
}

interface MoneyActionTokenPayload extends MoneyActionTokenSubject {
  exp: number;
}

function canonicalize(payload: MoneyActionTokenPayload): string {
  return `businessId=${payload.businessId}&deviceId=${payload.deviceId}&exp=${payload.exp}`;
}

export interface SignedMoneyActionToken {
  token: string;
  expiresAt: number;
}

export function signMoneyActionToken(subject: MoneyActionTokenSubject): SignedMoneyActionToken {
  const expiresAt = Date.now() + MONEY_ACTION_TOKEN_LIFETIME_MS;
  const payload: MoneyActionTokenPayload = { ...subject, exp: expiresAt };
  const signature = createHmac("sha256", getSigningKey()).update(canonicalize(payload)).digest("base64url");
  // The payload itself isn't secret (just IDs and a timestamp), so it
  // rides along base64url-encoded rather than needing a server-side
  // lookup table — only the signature has to be kept unforgeable.
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${encodedPayload}.${signature}`, expiresAt };
}

/**
 * Verifies a token a device presents as proof it already unlocked
 * money actions. Must match the SAME businessId + deviceId the caller
 * is currently authenticated as (via its device_token) — a token
 * signed for one device/business is rejected outright for any other.
 */
export function verifyMoneyActionToken(token: string | null | undefined, subject: MoneyActionTokenSubject): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [encodedPayload, signature] = parts;

  let payload: MoneyActionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return false;
  }

  if (payload.businessId !== subject.businessId || payload.deviceId !== subject.deviceId) return false;
  if (!Number.isFinite(payload.exp) || Date.now() > payload.exp) return false;

  const expected = createHmac("sha256", getSigningKey()).update(canonicalize(payload)).digest("base64url");
  const expectedBuf = Buffer.from(expected);
  const gotBuf = Buffer.from(signature);
  if (expectedBuf.length !== gotBuf.length) return false;
  return timingSafeEqual(expectedBuf, gotBuf);
}
