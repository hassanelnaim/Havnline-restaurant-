/**
 * What the menu says about a caller's allergy, for the items they ordered.
 * Plain word matching on the restaurant's own menu text (item name,
 * description, chosen add-ons): it never claims an item is safe, it only
 * reports where the menu mentions the allergen or an ingredient that
 * plainly contains it. The launch test: "allergic to tomatoes" with a
 * cheeseburger described "lettuce, tomato, pickles" got no warning,
 * because the AI was left to notice it on its own.
 */

// Allergy word -> ingredients that plainly contain it.
const CONTAINS: Record<string, string[]> = {
  dairy: ["cheese", "milk", "butter", "cream", "yogurt", "ranch", "alfredo", "queso", "whey"],
  milk: ["cheese", "milk", "butter", "cream", "yogurt", "ranch", "alfredo", "queso", "whey"],
  lactose: ["cheese", "milk", "butter", "cream", "yogurt", "ranch", "alfredo", "queso"],
  cheese: ["cheese", "queso", "parmesan", "mozzarella", "cheddar", "feta"],
  egg: ["egg", "mayo", "mayonnaise", "aioli", "omelet", "omelette"],
  gluten: ["bread", "bun", "breaded", "flour", "tortilla", "wrap", "pita", "pasta", "noodle", "batter", "crouton", "toast", "biscuit", "pancake", "waffle"],
  wheat: ["bread", "bun", "breaded", "flour", "tortilla", "wrap", "pita", "pasta", "noodle", "batter", "crouton", "toast", "biscuit", "pancake", "waffle"],
  peanut: ["peanut"],
  nut: ["peanut", "almond", "walnut", "pecan", "cashew", "pistachio", "hazelnut", "nut"],
  "tree nut": ["almond", "walnut", "pecan", "cashew", "pistachio", "hazelnut"],
  shellfish: ["shrimp", "crab", "lobster", "clam", "mussel", "oyster", "scallop", "crawfish"],
  fish: ["fish", "tuna", "salmon", "cod", "tilapia", "anchovy", "whitefish", "perch"],
  soy: ["soy", "tofu", "edamame", "teriyaki"],
  sesame: ["sesame", "tahini", "hummus"],
  pork: ["pork", "bacon", "ham", "sausage", "pepperoni", "chorizo"],
};

/** "tomatoes" -> "tomato", "onions" -> "onion", "berries" -> "berry". */
function singular(w: string): string {
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(oes|ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
  return w;
}

const STOP = new Set([
  "allergy", "allergic", "allergies", "to", "an", "a", "the", "and", "or", "of", "severe", "mild", "intolerance", "intolerant", "no", "free",
  // Filler a caller wraps around the allergen ("my son has a really bad peanut allergy").
  "my", "son", "daughter", "kid", "wife", "husband", "is", "i", "im", "he", "she", "has", "have", "got", "with", "food", "bad", "really", "very",
  "just", "please", "too", "also", "any", "all", "kind", "like", "um", "uh", "yes", "yeah", "so",
]);

/** The ingredient words to look for, from what the caller said ("tomatoes", "dairy and eggs"). */
export function allergenTerms(allergy: string): { allergen: string; terms: string[] }[] {
  const words = allergy.toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
  const out: { allergen: string; terms: string[] }[] = [];
  const lower = allergy.toLowerCase();
  if (/tree ?nuts?/.test(lower)) out.push({ allergen: "tree nuts", terms: CONTAINS["tree nut"] });
  for (const raw of words) {
    const w = singular(raw);
    if (w === "tree") continue;
    if (out.some((o) => o.allergen === raw || o.allergen === w)) continue;
    out.push({ allergen: raw, terms: [...new Set([w, ...(CONTAINS[w] || [])])] });
  }
  return out;
}

export interface MenuTextItem {
  name: string;
  description?: string | null;
  modifiers?: string[];
}

export interface AllergyMention {
  item: string;
  allergen: string;
  /** The menu's own words that mention it. */
  menuSays: string;
  /** The ingredient word found ("tomato", or "cheese" for a dairy allergy). */
  term: string;
}

function mentions(text: string, term: string): boolean {
  const t = text.toLowerCase();
  const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?\\b`);
  return re.test(t);
}

/** Where the menu text of these items mentions the allergy. Empty when it says nothing either way. */
export function findAllergyMentions(allergy: string, items: MenuTextItem[]): AllergyMention[] {
  const out: AllergyMention[] = [];
  for (const { allergen, terms } of allergenTerms(allergy)) {
    for (const item of items) {
      const sources = [item.name, item.description || "", ...(item.modifiers || [])].filter(Boolean);
      let hit: string | undefined;
      let found = "";
      for (const s of sources) {
        const term = terms.find((t) => mentions(s, t));
        if (term) { hit = s; found = term; break; }
      }
      if (hit && !out.some((o) => o.item === item.name && o.allergen === allergen)) out.push({ item: item.name, allergen, menuSays: hit, term: found });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hearing an allergy in what the caller said, in code. The AI is told to call
// note_allergy, but the launch test showed it can skip that and only say
// "I'll note it", so HavnLine also listens for it itself.

const NOT_AN_ALLERGEN = new Set(["anything", "nothing", "none", "it", "that", "this", "them", "stuff", "things", "everything"]);
const LEAD_FILLER = /^(?:(?:yes|yeah|yep|yup|uh+|um+|so|well|actually|oh|ok|okay|sure|and|but)[\s,]+)+/;
const WHO = /^(?:(?:i'?m|i am|i'?ve got|i have|we'?re|he'?s|she'?s|they'?re|my \w+(?:'s| is| has)|one of us is|someone is)\s+)?(?:(?:really|very|severely|super)\s+)?(?:allergic to\s+)?/;
const LEAD_WORDS = new Set(["the", "any", "all", "some", "just", "a", "an", "have", "has", "got", "with", "bad", "severe", "serious", "really", "very", "super", "my", "kind", "of", "like", "only", "s"]);
const TAIL = /(?:\s+(?:please|too|also|as well|though|thanks|thank you))+$/;

function cleanAllergen(raw: string): string | null {
  let a = raw.toLowerCase().replace(/[^a-z' ,&-]+/g, " ").replace(/\s+/g, " ").trim();
  a = a.replace(LEAD_FILLER, "").replace(TAIL, "").replace(/[ ,&-]+$/, "").trim();
  const all = a.split(" ").filter(Boolean);
  while (all.length && LEAD_WORDS.has(all[0].replace(/,$/, ""))) all.shift();
  a = all.join(" ");
  if (!a || a.length > 60) return null;
  const words = a.split(/[ ,]+/).filter(Boolean);
  if (words.length > 6 || words.every((w) => NOT_AN_ALLERGEN.has(w) || STOP.has(w))) return null;
  return a;
}

/** True when the assistant's line asked about allergies ("Does anyone have a food allergy...?"). */
export function askedAboutAllergy(aiLine: string | null | undefined): boolean {
  // The question itself has to be about allergies: "I've noted your allergy...
  // What can I get you?" is not asking for one.
  return (aiLine || "").split(/(?<=[.!?])\s+/).some((s) => /\?\s*$/.test(s) && /allerg/i.test(s));
}

/**
 * The allergen a caller named in one thing they said, or null.
 * "I'm allergic to tomatoes" / "she has a peanut allergy" / "I can't eat dairy",
 * and, right after the AI asked about allergies, a bare answer like "yes, tomatoes".
 */
export function allergyFromSpeech(speech: string, afterAllergyQuestion = false, menuNames: readonly string[] = []): string | null {
  const t = ` ${speech.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim()} `;
  const stop = "(?=$|[.!?;]|,?\\s(?:but|so|and (?:i|he|she|we|they|can|could|also|that|then)|can i|could i|i'?d like|i want|please|thanks|thank you)\\b)";

  const to = new RegExp(`\\b(not |n't |never )?(?:allergic|an allergy|allergies) to (.+?)${stop}`).exec(t);
  if (to && !to[1]) { const a = cleanAllergen(to[2]); if (a) return a; }

  const before = /\b((?:[a-z]+ ){0,2}?[a-z]+) allerg(?:y|ies)\b/.exec(t);
  if (before && !/\b(?:no|not|any|food|an|a|the)$/.test(before[1])) {
    const a = cleanAllergen(before[1]);
    if (a && !/^(?:no|any|food)$/.test(a)) return a;
  }

  const cant = new RegExp(`\\b(?:can'?t|cannot|can not|shouldn'?t) (?:eat|have) (?:any )?(.+?)${stop}`).exec(t);
  if (cant) { const a = cleanAllergen(cant[1]); if (a) return a; }

  if (afterAllergyQuestion) {
    const bare = t.trim().replace(/[.!?]+$/, "").replace(LEAD_FILLER, "");
    if (/^(?:no|nope|nah|none|not really|nobody|no one|i don'?t|we don'?t|i'?m good|we'?re good|nothing)\b/.test(bare)) return null;
    if (/\b(?:not|never|isn'?t|aren'?t) allergic\b|\bno allerg/.test(bare)) return null;
    const a = cleanAllergen(bare.replace(WHO, ""));
    // A bare answer that's an item off the menu is an order, not an allergy.
    const isMenuItem = a ? menuNames.some((n) => norm(n) === norm(a) || norm(n) === norm(a).replace(/s$/, "")) : false;
    if (a && !isMenuItem && a.split(/[ ,]+/).length <= 4) return a;
  }
  return null;
}

/** Every allergy the caller has named so far on this call, oldest first, without repeats. */
export function allergiesOnCall(messages: { role: string; content: string }[], menuNames: readonly string[] = []): string[] {
  const out: string[] = [];
  let lastAi: string | null = null;
  for (const m of messages) {
    if (m.role === "ai" || m.role === "assistant") { lastAi = m.content; continue; }
    if (m.role !== "customer" && m.role !== "user") continue;
    const a = allergyFromSpeech(m.content, askedAboutAllergy(lastAi), menuNames);
    if (a && !out.some((o) => o.toLowerCase() === a.toLowerCase())) out.push(a);
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Mentions the reply hasn't already told the caller (it names neither the item with the ingredient). */
export function unsaidMentions(reply: string, mentions: AllergyMention[]): AllergyMention[] {
  const r = ` ${norm(reply)} `;
  return mentions.filter((m) => {
    const item = norm(m.item);
    const saidItem = r.includes(` ${item} `) || item.split(" ").some((w) => w.length > 3 && r.includes(` ${w} `));
    const saidTerm = new RegExp(`\\b(${norm(m.term)}|${norm(m.allergen)})`).test(r);
    return !(saidItem && saidTerm);
  });
}

/** "Heads up, the menu says the Cheeseburger comes with tomato." for each one. */
export function headsUpLine(mentions: AllergyMention[], opts: { ask?: boolean } = {}): string {
  if (!mentions.length) return "";
  const parts = mentions.map((m) => `the ${m.item} comes with ${m.term}`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return opts.ask === false
    ? `Heads up, the menu says ${list}, so I can leave it off or change it if you'd like.`
    : `Heads up, the menu says ${list}. Want me to leave it off or change it?`;
}
