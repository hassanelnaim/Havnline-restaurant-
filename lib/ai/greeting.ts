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
// Says plainly, before the caller says anything, that:
// - they're talking to an AI (Utah and California require that disclosure);
// - the AI is run by HavnLine for the restaurant, and the call is
//   transcribed. Restaurant AI phone vendors have been sued under
//   California's wiretapping law by callers who weren't told an outside
//   company was on the line; telling them up front is the main defense.
// - they can ask for a person at any point, which the assistant handles.
// Kept short: every second here is a second the caller waits to talk.
const GREETING_START = "Thank you for calling ";
export const GREETING_BODY = ". You've reached our automated ordering assistant, provided by HavnLine. Calls are transcribed for accuracy. I can take your order or answer any questions, and you're welcome to ask for a team member at any time. How can I help you today?";

export function buildGreeting(businessName: string): string {
  return `${GREETING_START}${businessName}${GREETING_BODY}`;
}

// The length bound is belt-and-braces: a business name is short, so
// anything much longer than this isn't a greeting we built.
const MAX_GREETING_LENGTH = 400;

export function isGreetingLine(text: string): boolean {
  return text.length <= MAX_GREETING_LENGTH && text.startsWith(GREETING_START) && text.endsWith(GREETING_BODY);
}
