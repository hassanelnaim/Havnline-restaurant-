// Shared, defensively-normalized read of NEXT_PUBLIC_SITE_URL.
//
// Every call site that builds a URL from this value does so with
// `${SITE_URL}/some/path` — a single hardcoded slash. If the env var
// itself ever has a trailing slash (e.g. "https://example.com/" instead
// of "https://example.com"), that produces a double slash
// ("https://example.com//some/path"), which 404s. That's exactly what
// broke inbound calls: the TTS <Play> URL in TwiML 404'd because
// NEXT_PUBLIC_SITE_URL had a trailing slash in Vercel, so Twilio
// couldn't fetch the audio and the call died with a generic
// "application error" — silently, since the site's own webhook route
// still returned a normal 200 with valid-looking TwiML.
//
// Stripping any trailing slash here means this class of bug can't
// recur regardless of how the env var happens to be entered.
export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}
