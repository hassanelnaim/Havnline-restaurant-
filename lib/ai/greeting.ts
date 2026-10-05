/**
 * The line every call opens with. Kept in its own dependency-free module
 * because two places must agree on its exact shape: the voice webhook
 * that builds it, and the TTS route that decides whether the audio for
 * it may be cached.
 *
 * Why it matters for capacity: this line is spoken at the start of EVERY
 * inbound call, unchanged except for the business name, and it used to be
 * synthesized from scratch each time — one ElevenLabs concurrent-request
 * slot spent per call on audio that is identical to the call before it.
 * Cached, it's one synthesis per (business, voice) ever.
 *
 * Caching it is safe in the way the dynamic replies are not: it contains
 * only the business's own public name — no caller name, number or order
 * detail ever appears in it.
 */
export const GREETING_BODY = "There may be a few seconds' delay between answers, so please be patient. How can I help?";

export function buildGreeting(businessName: string): string {
  return `${businessName}. ${GREETING_BODY}`;
}

// The length bound is belt-and-braces: a business name is short, so
// anything much longer than this isn't a greeting we built.
const MAX_GREETING_LENGTH = 300;

export function isGreetingLine(text: string): boolean {
  return text.length <= MAX_GREETING_LENGTH && text.endsWith(`. ${GREETING_BODY}`);
}
