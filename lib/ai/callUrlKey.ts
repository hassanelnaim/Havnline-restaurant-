import { createHash, createHmac, timingSafeEqual } from "crypto";

/**
 * Every webhook URL HavnLine hands Twilio for a call (or an order's text
 * report) carries k=, a short signature of the call's id. Twilio's own
 * signature on each request can only be checked with the restaurant's key,
 * which has to be looked up in the database first; this check needs no
 * database, so junk requests are turned away before costing any database
 * reads. Twilio's signature is still checked after it.
 */
function key(): Buffer {
  const source = process.env.SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.TWILIO_AUTH_TOKEN;
  if (!source) throw new Error("Cannot sign call URLs: no SIGNING_SECRET, SUPABASE_SERVICE_ROLE_KEY or TWILIO_AUTH_TOKEN is configured.");
  return createHash("sha256").update(`havnline-call-url-key:${source}`).digest();
}

export function callUrlKey(id: string): string {
  return createHmac("sha256", key()).update(id).digest("base64url").slice(0, 22);
}

/** Adds &k=... (or ?k=...) for `id` to a URL. */
export function withCallKey(url: string, id: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}k=${callUrlKey(id)}`;
}

/** Whether the request's k= matches `id`. */
export function hasValidCallKey(url: URL, id: string): boolean {
  const given = url.searchParams.get("k");
  if (!given) return false;
  const expected = Buffer.from(callUrlKey(id));
  const got = Buffer.from(given);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
