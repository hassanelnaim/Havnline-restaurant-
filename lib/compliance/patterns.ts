/**
 * Text patterns for HavnLine's compliance checks. Kept free of imports so
 * they can be tested on their own. A match is a reason for a person to
 * look, never proof: every finding goes to the admin to judge.
 */

export interface PatternHit {
  rule: string;
  label: string;
  snippet: string;
}

/** Things a caller says when a business may be using their number outside their order. */
const CALLER_COMPLAINTS: { rule: string; label: string; re: RegExp }[] = [
  { rule: "stop_contact", label: "asked them to stop calling or texting", re: /\b(stop|quit) (calling|texting|messaging|contacting) me\b/i },
  { rule: "keep_contacting", label: "said they keep getting calls or texts", re: /\b(keep|keeps|kept) (calling|texting|messaging|contacting) me\b/i },
  { rule: "how_number", label: "asked how the restaurant got their number", re: /\bhow (did|do) (you|y'?all|they) (get|got|find) my (phone )?(number|info|information)\b/i },
  { rule: "not_signed_up", label: "said they never signed up", re: /\b(i )?(didn'?t|did not|never) (sign|signed) up\b/i },
  { rule: "remove_list", label: "asked to be taken off a list", re: /\b(take|remove|get) me off (your|the|this|that) (list|mailing list|texting list)\b|\bunsubscribe\b/i },
  { rule: "why_contacting", label: "asked why they're being called or texted", re: /\bwhy (are|do) (you|y'?all) (keep )?(calling|texting|messaging) me\b/i },
  { rule: "spam", label: "called the calls or texts spam", re: /\b(this is|is this|that'?s|these are|it'?s) (just )?spam\b|\bspam (calls?|texts?|messages?)\b/i },
];

/** Instructions a restaurant gives the AI that break the Terms or put callers at risk. */
const AI_INSTRUCTIONS: { rule: string; label: string; re: RegExp }[] = [
  {
    rule: "allergen_promise",
    label: "tells the AI to promise food is allergen-safe",
    re: /\b(tell|say|assure|promise|guarantee|confirm)\b[^.\n]{0,60}\b(gluten|nut|peanut|tree nut|dairy|lactose|shellfish|soy|egg|allergen|allergy)[- ]?(free|safe)\b/i,
  },
  {
    rule: "card_details",
    label: "tells the AI to collect card details over the phone",
    re: /\b(take|ask for|collect|get|write down|read back|record)\b[^.\n]{0,40}\b(card numbers?|credit cards?|debit cards?|cvv|cvc|security codes?|expiration dates?)\b/i,
  },
  {
    rule: "sensitive_ids",
    label: "tells the AI to ask for sensitive personal details",
    re: /\b(ask for|collect|get|take)\b[^.\n]{0,40}\b(social security|ssn|date of birth|birthday|driver'?s licen[cs]e|home address)\b/i,
  },
  {
    rule: "marketing",
    label: "tells the AI to sign callers up for marketing",
    re: /\b(newsletter|mailing list|email list|marketing (texts?|list|messages?)|promo(tional)? (texts?|list)|sign (them|callers?|customers?|people) up for)\b|\b(ask for|collect|get|take)\b[^.\n]{0,30}\be-?mail( address)?\b/i,
  },
  {
    rule: "hide_ai",
    label: "tells the AI to hide that it's an AI or that calls are transcribed",
    re: /\b(don'?t|do not|never)\b[^.\n]{0,15}\b(say|tell|mention|admit|reveal|disclose)\b[^.\n]{0,40}\b(ai|a\.i\.|robot|bot|automated|artificial|transcri\w*|recorded)\b|\b(pretend|act like|say) (you'?re|you are|to be) (a )?(real )?(human|person|employee|staff member)\b/i,
  },
];

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

function scan(text: string, rules: { rule: string; label: string; re: RegExp }[]): PatternHit[] {
  if (!text) return [];
  const hits: PatternHit[] = [];
  for (const r of rules) {
    const m = r.re.exec(text);
    if (m) hits.push({ rule: r.rule, label: r.label, snippet: snippetAround(text, m.index, m[0].length) });
  }
  return hits;
}

export const findCallerComplaints = (text: string) => scan(text, CALLER_COMPLAINTS);
export const findBadInstructions = (text: string) => scan(text, AI_INSTRUCTIONS);
