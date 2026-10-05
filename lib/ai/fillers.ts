/**
 * Pure text rules for a live call: which short "one moment" line to play
 * before slow work (and, just as important, when to play none), and
 * whether a caller is just saying goodbye. Kept free of imports so they
 * can be tested directly.
 */

// Originally this only matched turns that triggered a real, slower
// tool round-trip (a DB write, a Stripe Checkout Session, an SMS send)
// because a broader list made the filler play before questions the AI
// answers instantly from the system prompt with no tool call at all —
// menu/hours/recommendation questions, which cost nothing in the
// database but still cost a full Claude round-trip plus fresh TTS
// synthesis of a never-seen-before reply (nothing to cache there,
// unlike these fixed filler lines). That's real, noticeable latency
// too — a caller asking "what do you recommend?" sat through dead air
// with nothing covering it. So this now covers both: real tool-backed
// turns (grouped first, since those are genuinely the slowest) AND the
// common question/conversation shapes that still take a real model
// round-trip, each with a filler that reads as the natural lead-in to
// that *kind* of answer — never the exact answer, since the filler is
// chosen before the model has generated anything.
export const FILLER_CATEGORIES: { keywords: string[]; fillers: string[] }[] = [
  {
    // Customer says they want to order but hasn't named anything yet
    // ("I'd like to order," "can I place an order") — distinct from
    // naming an item directly below. No tool call yet; the AI's own
    // next line is naturally something like "what can I get for you,"
    // so the filler should read as the lead-in to that, not a
    // standalone "got it."
    keywords: [
      "like to order", "want to order", "place an order", "make an order", "start an order",
      "order something", "ready to order", "take my order",
    ],
    fillers: ["I'd love to take your order!", "Sure thing, let's get you set up.", "Happy to help with that."],
  },
  {
    // add_item_to_order on a NEW, already-named item ("I'll have a
    // burger," "can I get fries") — a menu lookup + a DB write, and
    // the single most common thing said on a call.
    keywords: [
      "i want", "i'd like", "i would like", "i'll have", "i will have", "i'll take",
      "i will take", "i'll get", "can i get", "can i have", "could i get", "could i have",
      "give me", "gimme", "get me", "let me get", "let me have", "i need", "i'll do",
    ],
    fillers: ["Sure, adding that now.", "Got it, one sec.", "Okay, putting that in."],
  },
  {
    // add_item_to_order / remove_item_from_order / update_item_quantity
    // / update_item_modifiers on something already in the order — a
    // real DB write per item, plus a menu/modifier lookup.
    keywords: [
      "add", "remove", "instead", "substitute", "change my order", "change that",
      "make that", "make it", "actually", "no onions", "extra", "swap", "cancel that",
      "different", "another one", "one more",
    ],
    fillers: ["Sure, updating that now.", "Got it, one sec.", "Okay, making that change."],
  },
  {
    // confirm_and_place_order — genuinely the slowest path: a Checkout
    // Session with a payment-enabled business, a kitchen print job, and
    // a confirmation text all happen here.
    keywords: [
      "that's it", "that's all", "that's everything", "place my order", "place the order",
      "go ahead and order", "sounds good, order", "yes, place", "checkout", "ready to order",
      "that's my order", "that should do it",
    ],
    fillers: ["Great, placing that order now.", "Perfect, locking that in.", "Okay, sending that through."],
  },
  {
    // lookup_customer / create_customer — asked right after the order
    // is read back, once the customer gives their name and number.
    keywords: [
      "my name is", "my number is", "phone number", "here's my number",
    ],
    fillers: ["Got it, thanks.", "Okay, one sec."],
  },
  {
    // escalate_to_human / transfer_call — a DB write and (for a
    // transfer) a live outbound call setup.
    keywords: [
      "speak to", "talk to", "a real person", "a human", "a manager", "refund",
      "complaint", "already placed", "change my order i already", "cancel my order",
    ],
    fillers: ["Okay, let me get that handled.", "Sure, one moment."],
  },
  {
    // No tool call at all — answered straight from the menu already in
    // the system prompt — but asking for a recommendation specifically
    // deserves its own warmer lead-in rather than the generic
    // "let me check" lines below, which read oddly before an opinion.
    keywords: [
      "recommend", "what's good", "what is good", "what do you suggest", "any suggestions",
      "what should i get", "what should i order", "favorite", "best seller", "most popular",
      "what's your favorite",
    ],
    fillers: ["Ooh, good question — let me think.", "Happy to suggest something.", "Let's see what I'd pick for you."],
  },
  {
    // No tool call — a factual lookup the AI already has (an item, a
    // price, what's in something, an ingredient/allergy question).
    keywords: [
      "how much is", "how much are", "what comes with", "what's in", "what is in", "does it come with",
      "do you have", "is there", "what kind of", "what size", "how big is", "allerg", "gluten", "vegan",
      "vegetarian", "calorie",
    ],
    fillers: ["Good question, let me check.", "Let's see here.", "One sec, let me take a look."],
  },
  {
    // No tool call — hours/location/general business info, already in
    // the system prompt.
    keywords: [
      "what time", "are you open", "when do you open", "when do you close", "how late", "what hours",
      "where are you", "your address", "your location", "do you deliver", "is this pickup only",
    ],
    fillers: ["Let me check that for you.", "One sec, let me look that up."],
  },
  {
    // No tool call — discounts/promos, already in the system prompt.
    keywords: ["discount", "deal", "special", "coupon", "promo", "any offers"],
    fillers: ["Let me see what we've got going on.", "Good question — one sec."],
  },
];

// Words that, alone, are too short to tell much from — "yes," "no,"
// "okay," "that's right" — are answers or acknowledgements, not requests.
const TRIVIAL_REPLY_WORD_LIMIT = 3;

// A short reply that STARTS like an answer ("yes please", "no that's
// fine", "okay sounds good thanks") is still an answer, however many
// words it has. Anything longer is treated as a real request.
const MAX_ACK_WORDS = 6;
const ACK_FIRST_WORDS: ReadonlySet<string> = new Set([
  "yes", "yeah", "yep", "yup", "yea", "no", "nope", "nah", "okay", "ok", "sure", "correct", "right",
  "exactly", "alright", "thanks", "thank", "perfect", "great", "good", "fine", "please", "mhm", "uh", "um", "sounds",
]);

// What an acknowledgement gets when the previous turn did real work. It
// must NOT sound like the start of an answer or a lookup ("let me check
// that") — the caller just said yes or no, there is nothing to look up,
// and a lookup-style line there reads as the assistant misunderstanding.
export const ACK_FILLER = "Got it, one moment.";

function wordsOf(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}

export function isBareAcknowledgement(text: string): boolean {
  const words = wordsOf(text);
  if (words.length <= TRIVIAL_REPLY_WORD_LIMIT) return true;
  return words.length <= MAX_ACK_WORDS && ACK_FIRST_WORDS.has(words[0]);
}

// Keywords are matched as whole words (so "add" no longer fires inside
// "address" and "deal" no longer fires inside "ideal"), except these
// two, which are deliberate word stems ("allergy", "allergic").
const STEM_KEYWORDS: ReadonlySet<string> = new Set(["allerg", "calorie"]);
const keywordPatternCache = new Map<string, RegExp>();
function keywordMatches(lowerText: string, keyword: string): boolean {
  let re = keywordPatternCache.get(keyword);
  if (!re) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(^|[^a-z0-9])${escaped}${STEM_KEYWORDS.has(keyword) ? "" : "($|[^a-z0-9])"}`);
    keywordPatternCache.set(keyword, re);
  }
  return re.test(lowerText);
}

/**
 * Returns a filler line to say before the slower work happens, or null
 * when nothing should be said first. A specific topic ("I'd like a
 * burger", "that's all") gets a filler that reads as the lead-in to that
 * kind of answer. A bare yes / no / okay never gets a lookup-style
 * filler: at most a neutral "Got it, one moment." when the previous turn
 * did real work and this answer is likely to trigger more of it.
 */
export function getContextualFiller(text: string, previousTurnUsedTool: boolean): string | null {
  const lower = text.toLowerCase();
  for (const category of FILLER_CATEGORIES) {
    if (category.keywords.some((kw) => keywordMatches(lower, kw))) {
      return category.fillers[Math.floor(Math.random() * category.fillers.length)];
    }
  }

  if (isBareAcknowledgement(text)) return previousTurnUsedTool ? ACK_FILLER : null;
  if (previousTurnUsedTool) return "Sure, one moment.";
  return "Let's see.";
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

