import { getSiteUrl } from "@/lib/env";

/**
 * Wakes the next two webhooks of a call while the greeting is still playing.
 *
 * Each webhook is its own serverless function, and a function that has been
 * idle is "cold": its first request pays a start-up cost (loading the
 * Anthropic, Stripe and Supabase code) on top of the real work. The greeting
 * takes several seconds to play and the caller then speaks, so the next
 * webhook (/gather) doesn't arrive until well after this one — plenty of time
 * to start it up in the background, so the caller's FIRST question doesn't
 * pay for a cold start. /process (the slow-turn path) is woken too.
 *
 * Fire and forget: the request only needs to leave this server, nothing is
 * read from the response, and a failure changes nothing — the real request
 * just starts the function itself, exactly as before.
 */
export function warmCallRoutes(): void {
  let base: string;
  try {
    base = getSiteUrl();
  } catch {
    return;
  }
  for (const route of ["gather", "process"]) {
    try {
      fetch(`${base}/api/webhooks/twilio/${route}?warm=1`, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      }).catch(() => {});
    } catch {
      // Never let a warm-up problem touch the call.
    }
  }
}

/** The response a webhook gives to a warm-up request (and nothing else). */
export function warmResponse(): Response {
  return new Response("warm", { status: 200, headers: { "Cache-Control": "no-store" } });
}
