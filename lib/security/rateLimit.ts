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

export async function checkRateLimit(rateKey: string, maxHits: number, windowMinutes: number): Promise<boolean> {
  const admin = createAdminClient();
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const { count } = await admin
    .from("rate_limit_hits")
    .select("*", { count: "exact", head: true })
    .eq("rate_key", rateKey)
    .gte("created_at", windowStart);

  await admin.from("rate_limit_hits").insert({ rate_key: rateKey });

  return (count || 0) < maxHits;
}
