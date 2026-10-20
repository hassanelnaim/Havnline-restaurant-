/**
 * Pure text rules for a live call: which short "one moment" line to play
 * before slow work (and, just as important, when to play none), and
 * whether a caller is just saying goodbye. Kept free of imports so they
 * can be tested directly.
 *
 * WHEN A FILLER PLAYS — and why it is rare now.
 *
 * A filler is not free. The webhook that plays it only answers once the
 * filler is queued; Twilio then plays the whole line, listens for a second
 * in case the caller keeps talking, and only THEN fetches the page that
 * does the real work. The work starts after the filler ends, so a filler
 * never shortens the wait — it adds its own length (plus that one-second
 * listen and a second round trip to the server) on top of it. It was
 * playing before nearly every answer, which is why a simple question took
 * about four seconds of filler plus four seconds of answer.
 *
 * It only earns that cost where the silence would otherwise be long. That
 * is exactly two situations:
 *   1. The turn that places the order (Stripe, the payment text, the
 *      kitchen) — the slowest thing the assistant does.
 *   2. Handing the caller to a person (a database write plus setting up a
 *      live transfer).
 * Everything else — menu questions, hours, adding or changing an item,
 * reading the order back, yes/no answers — gets its real answer straight
 * away with no filler in front of it.
 *
 * Nothing here changes how long the line listens for the caller, so a
 * caller is never cut off mid-sentence because of this.
 */

interface FillerCategory {
  keywords: string[];
  fillers: string[];
}

const NAME_GIVEN: FillerCategory = {
  // The caller is giving their name / number — this is the turn that
  // places the order (lookup/create customer, then
  // confirm_and_place_order). The more reliable signal for the same
  // turn is the assistant's previous question (see
  // asksForCustomerDetails); these phrases catch a caller who volunteers
  // the details on their own.
  keywords: ["my name is", "my number is", "here's my number", "this is my number", "the name is"],
  fillers: ["Got it, thanks.", "Okay, one sec."],
};

const ESCALATION: FillerCategory = {
  // escalate_to_human / transfer_call — a DB write and (for a
  // transfer) a live outbound call setup.
  keywords: [
    "speak to", "talk to", "a real person", "a human", "a manager", "refund",
    // The greeting tells callers they can ask for a person anytime.
    "person", "representative", "operator",
    "complaint", "already placed", "change my order i already", "cancel my order",
  ],
  fillers: ["Okay, let me get that handled.", "Sure, one moment."],
};

// Every fixed filler line, so their audio can be cached (see
// STATIC_TTS_LINES in twimlHelpers.ts).
export const FILLER_CATEGORIES: FillerCategory[] = [NAME_GIVEN, ESCALATION];

// 1. The turn that places the order. Neutral on purpose: the caller may
// have changed their mind in the same breath, so this must not promise that
// the order is going through.
export const PLACING_ORDER_FILLERS: string[] = ["Got it, one moment.", "Okay, give me just a moment."];

// What the assistant says right before the order is placed: it asks for the
// caller's name and/or phone number. Deliberately narrow ("phone number",
// "your name"), so an item called "Number 5 combo" in a read-back can't
// make an ordinary "yes" look like the order-placing turn.
const ASKS_FOR_DETAILS = /\b(your name|name and (a |your |the )?(phone )?number|phone number|best number|callback number|contact number|number to reach|number i can)\b/i;

export function asksForCustomerDetails(assistantReply: string | null | undefined): boolean {
  return Boolean(assistantReply && ASKS_FOR_DETAILS.test(assistantReply));
}

// What an acknowledgement gets when the previous turn did real work. It
// must NOT sound like the start of an answer or a lookup ("let me check
// that") — the caller just said yes or no, there is nothing to look up,
// and a lookup-style line there reads as the assistant misunderstanding.
export const ACK_FILLER = "Got it, one moment.";

function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}

// Keywords are matched as whole words (so "talk to" doesn't fire inside
// some longer word).
const keywordPatternCache = new Map<string, RegExp>();
function keywordMatches(lowerText: string, keyword: string): boolean {
  let re = keywordPatternCache.get(keyword);
  if (!re) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`);
    keywordPatternCache.set(keyword, re);
  }
  return re.test(lowerText);
}

function pick(lines: string[]): string {
  return lines[Math.floor(Math.random() * lines.length)];
}

/**
 * Returns a filler line to say before slow work happens, or null when
 * nothing should be said first — which is almost always. See the comment
 * at the top of this file for the two cases that qualify.
 *
 * `previousReply` is what the assistant said last turn. When that was a
 * request for the caller's name / number, this turn is the one that places
 * the order, whatever words the caller uses to answer.
 *
 * (`_previousTurnUsedTool` is accepted for compatibility with older callers
 * and no longer changes the result.)
 */
export function getContextualFiller(
  text: string,
  _previousTurnUsedTool: boolean = false,
  previousReply: string | null = null
): string | null {
  const lower = text.toLowerCase();

  // A request to reach a person always gets its lead-in, even if the
  // assistant had just asked for a name.
  if (ESCALATION.keywords.some((kw) => keywordMatches(lower, kw))) return pick(ESCALATION.fillers);

  if (asksForCustomerDetails(previousReply)) return pick(PLACING_ORDER_FILLERS);

  if (NAME_GIVEN.keywords.some((kw) => keywordMatches(lower, kw))) return pick(NAME_GIVEN.fillers);

  return null;
}

// After an order is placed, a caller who only says thanks / goodbye is
// ending the call. Matching is deliberately strict — EVERY word must be
// part of a closing vocabulary — so "thanks, and add a drink" is never
// mistaken for a goodbye.
const FAREWELL_WORDS: ReadonlySet<string> = new Set([
  "thanks", "thank", "you", "bye", "goodbye", "okay", "ok", "alright", "great", "perfect", "awesome", "cool",
  "appreciate", "it", "so", "much", "very", "a", "lot", "have", "good", "great", "night", "day", "evening",
  "one", "take", "care", "see", "later", "too", "same", "yes", "yeah", "yep", "no", "nope", "that's", "all",
  "thats", "is", "everything", "nothing", "else", "i'm", "im", "done", "set", "we're", "were", "bye-bye",
]);
const FAREWELL_TRIGGERS: ReadonlySet<string> = new Set(["thanks", "thank", "bye", "goodbye", "appreciate", "care", "later"]);
const MAX_FAREWELL_WORDS = 8;

// What the caller hears when an order has just been placed and they
// have nothing more to say, and how long the line stays open for one
// last word first (the normal wait is 15s, which on a finished order
// is just dead air before a hang-up).
export const POST_ORDER_GOODBYE = "Thanks for ordering. Goodbye!";
export const POST_ORDER_LISTEN_SECONDS = 4;

export function isFarewell(text: string): boolean {
  const words = wordsOf(text);
  if (words.length === 0 || words.length > MAX_FAREWELL_WORDS) return false;
  return words.every((w) => FAREWELL_WORDS.has(w)) && words.some((w) => FAREWELL_TRIGGERS.has(w));
}

