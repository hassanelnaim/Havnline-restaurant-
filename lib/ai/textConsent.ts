/**
 * Proof, from the conversation itself, that a caller agreed to be texted
 * the payment link. The AI also has to pass text_consent: true, but a
 * model can set that flag without asking (it did once, in testing); the
 * carriers approved HavnLine's texting on the promise that nothing is
 * sent without a spoken yes. So the order tool checks the actual words:
 *  - the assistant's last line asked to text the link, and
 *  - the caller's reply to it is a yes (and not a no).
 */

const ASKED_TO_TEXT = /\btext\b/i;
const ABOUT_THE_LINK = /\b(link|pay|payment)\b/i;
const IS_A_QUESTION = /\?|\b(is (it|that) (okay|ok|alright|all right|fine)|can i|may i|would (it|that) be|do you mind|want me to)\b/i;

const YES = /\b(yes|yeah|yea|yep|yup|ya|sure|ok|okay|k|go ahead|please( do)?|do it|that'?s fine|thats fine|fine|sounds good|of course|absolutely|correct|alright|all right|definitely|perfect|uh[- ]?huh|mm[- ]?hmm|send it|text me|that works)\b/i;
const NO = /\b(no|nope|nah|don'?t|do not|not okay|rather not|i'?d rather|no thanks|call me|stop)\b/i;

export interface ConsentCheck {
  ok: boolean;
  /** Why not, in words for the AI (and the logs). */
  why?: "not_asked" | "no_yes";
}

export function checkTextConsent(lastAssistant: string | null | undefined, callerReply: string | null | undefined): ConsentCheck {
  const asked = Boolean(lastAssistant && ASKED_TO_TEXT.test(lastAssistant) && ABOUT_THE_LINK.test(lastAssistant) && IS_A_QUESTION.test(lastAssistant));
  if (!asked) return { ok: false, why: "not_asked" };
  const reply = (callerReply || "").trim();
  // "No problem" and "not a problem" mean yes.
  const cleaned = reply.replace(/\b(no|not a) problem\b/gi, "okay");
  if (!YES.test(cleaned) || NO.test(cleaned)) return { ok: false, why: "no_yes" };
  return { ok: true };
}
