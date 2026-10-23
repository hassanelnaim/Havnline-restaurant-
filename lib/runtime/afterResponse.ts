import { waitUntil } from "@vercel/functions";

/**
 * Work that should finish even though the response has already gone back
 * (an email, a usage log, a cache write). A promise merely left running
 * can be frozen mid-way on Vercel once the response is sent, so emails
 * went missing and usage was undercounted. waitUntil keeps the function
 * alive until the promise settles. Errors are logged, never thrown.
 * Outside Vercel (local dev, tests) the promise just runs.
 */
export function runAfterResponse(label: string, work: Promise<unknown> | void): void {
  const settled = Promise.resolve(work).catch((err) => console.error(`[after-response] ${label} failed:`, err));
  try {
    waitUntil(settled);
  } catch {
    // No request context: nothing to extend.
  }
}
