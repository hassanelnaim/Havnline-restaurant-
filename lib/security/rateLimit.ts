import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

// Deriving "the client's IP" from a header a client can freely set
// themselves is exactly the bug this used to have: X-Forwarded-For is
// a comma-separated chain where each hop APPENDS the peer it saw, so
// the trustworthy value — the one our own platform edge determined,
// not whatever the caller put there — is the LAST entry, never the
// first. Taking the first entry (the previous behavior) trusted
// whatever a caller chose to send, making every IP-based rate limit
// (most importantly the printer-pairing brute-force limiter) trivially
// bypassable by sending a different X-Forwarded-For value each time.
export function getClientIp(): string {
  const h = headers();

  // Vercel's edge sets this to the actual connecting client's IP
  // itself — a single value the platform determines, not one a
  // request header can override — so it's the most trustworthy source
  // when present.
  const realIp = h.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwardedFor = h.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }

  return "unknown";
}

type Admin = ReturnType<typeof createAdminClient>;

/** Migration 034 not run yet: the database functions don't exist. */
function functionMissing(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message || "")));
}

async function legacyCount(admin: Admin, rateKey: string, windowMinutes: number): Promise<number | null> {
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { count, error } = await admin.from("rate_limit_hits").select("*", { count: "exact", head: true }).eq("rate_key", rateKey).gte("created_at", windowStart);
  return error ? null : count || 0;
}

/**
 * Counts one attempt against `rateKey` and says whether it's allowed: at
 * most `maxHits` per `windowMinutes`. Counting and recording happen in one
 * database step (migration 034), so requests sent at the same moment can't
 * all slip under the limit, and blocked attempts aren't recorded, so an
 * attacker can't hold a limit shut forever.
 *
 * Fails CLOSED: if the database can't answer, the attempt is refused.
 */
export async function checkRateLimit(rateKey: string, maxHits: number, windowMinutes: number): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("rate_limit_hit", { p_key: rateKey, p_max: maxHits, p_window_seconds: windowMinutes * 60 });
  if (!error) return data === true;

  if (functionMissing(error)) {
    // Before migration 034: the old two-step count (raceable, but working).
    console.error("[rateLimit] rate_limit_hit is missing; run migration 034. Falling back to the old limiter.");
    const count = await legacyCount(admin, rateKey, windowMinutes);
    if (count === null) return false;
    if (count >= maxHits) return false;
    await admin.from("rate_limit_hits").insert({ rate_key: rateKey });
    return true;
  }
  console.error(`[rateLimit] could not check ${rateKey}, refusing:`, error.message);
  return false;
}

/**
 * Whether `rateKey` has reached `maxHits` in the window, WITHOUT counting
 * this request. Used with recordRateLimitHit for limits on failures only
 * (wrong passwords, wrong PINs), so a person who gets it right isn't
 * counted. Fails closed: unknown counts as limited.
 */
export async function isRateLimited(rateKey: string, maxHits: number, windowMinutes: number): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("rate_limit_count", { p_key: rateKey, p_window_seconds: windowMinutes * 60 });
  if (!error) return Number(data) >= maxHits;
  if (functionMissing(error)) {
    const count = await legacyCount(admin, rateKey, windowMinutes);
    return count === null ? true : count >= maxHits;
  }
  console.error(`[rateLimit] could not count ${rateKey}, treating as limited:`, error.message);
  return true;
}

/** Records one failure against `rateKey` (see isRateLimited). */
export async function recordRateLimitHit(rateKey: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("rate_limit_hits").insert({ rate_key: rateKey });
  if (error) console.error(`[rateLimit] could not record ${rateKey}:`, error.message);
}
