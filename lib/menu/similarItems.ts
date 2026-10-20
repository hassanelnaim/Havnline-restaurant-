/**
 * Menu items that a caller could easily mean when they name something
 * loosely: "fries" (French Fries, American Fries, Cheese Fries...),
 * "coney" (Coney, Kosher Coney...), "coke" (Coke, Diet Coke...).
 *
 * The AI used to just pick one of these on its own, so "an order of fries"
 * could quietly become American Fries. This module does two things:
 *  - buildSimilarFamilies: groups the live menu so the system prompt can
 *    tell the AI which items sound alike (it must ask which one).
 *  - checkItemChoice: the server-side check in add_item_to_order. An item
 *    from one of these groups is only added if the caller actually named
 *    it, said something only that item has ("kosher", "french"), or picked
 *    it after the AI listed the choices. Otherwise the add is refused and
 *    the AI is told to ask, with the options.
 *
 * Pure functions, no I/O: everything is computed from item names.
 */

// Words that say nothing about WHICH item: joining words and filler.
// Never used as a group key or as proof the caller picked an item.
const FILLER = new Set([
  "a", "an", "the", "and", "with", "w", "of", "or", "on", "in", "to", "for", "my", "me", "i", "some", "please", "order", "orders", "one", "ones",
]);

// Words that do tell items apart ("Coney" vs "Coney Special") but are never
// what an item is mainly called, so they are skipped when picking a name's
// main word: "Coney Special" belongs with the coneys.
const NOT_A_MAIN_WORD = new Set(["special", "specials", "combo", "meal", "plate", "platter", "dinner", "basket", "side", "sides", "deluxe", "supreme", "circle", "jr", "large", "small", "regular"]);

/**
 * Plural-insensitive word: coneys -> coney, burgers -> burger, fries -> frie.
 * Only a trailing "s" is dropped, so "fries" stays apart from "fry" (a stir
 * fry is not what someone means by fries).
 */
function stem(word: string): string {
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** The words that identify an item: stemmed, no filler, no sizes/numbers like "2" or "1/4lb". */
export function itemTokens(name: string): string[] {
  return words(name)
    .filter((w) => !/\d/.test(w) && w.length > 1 && !FILLER.has(w))
    .map(stem);
}

function textTokenSet(texts: string[]): Set<string> {
  return new Set(texts.flatMap((t) => words(t).map(stem)));
}

const sameName = (a: string, b: string) => itemTokens(a).join(" ") === itemTokens(b).join(" ");

export interface SimilarFamily {
  /** The shared word, as people say it ("fries", "coney"). */
  word: string;
  /** Distinct item names in the group, plainest (fewest words) first. */
  names: string[];
}

const familyCache = new WeakMap<readonly { name: string }[], SimilarFamily[]>();

/**
 * Groups of items that share a main word. The main word of an item is the
 * last identifying word of its name ("French Fries" -> fries), and a group
 * is every item with that word anywhere in its name ("Chili Cheese Fries",
 * "American Fries circle"). Only groups with two or more different names.
 */
export function buildSimilarFamilies(menu: readonly { name: string }[]): SimilarFamily[] {
  const cached = familyCache.get(menu);
  if (cached) return cached;

  const keys = new Map<string, string>(); // stemmed key -> how it's spoken
  for (const item of menu) {
    const raw = words(item.name).filter((w) => !/\d/.test(w) && w.length > 1 && !FILLER.has(w) && !NOT_A_MAIN_WORD.has(w));
    const last = raw[raw.length - 1];
    if (last && !keys.has(stem(last))) keys.set(stem(last), last);
  }

  const families: SimilarFamily[] = [];
  for (const [key, spoken] of Array.from(keys)) {
    const names: string[] = [];
    for (const item of menu) {
      if (!itemTokens(item.name).includes(key)) continue;
      if (names.some((n) => sameName(n, item.name))) continue; // same item listed twice in the menu
      names.push(item.name.trim());
    }
    if (names.length < 2) continue;
    names.sort((a, b) => itemTokens(a).length - itemTokens(b).length || a.localeCompare(b));
    families.push({ word: spoken, names });
  }
  families.sort((a, b) => a.word.localeCompare(b.word));
  familyCache.set(menu, families);
  return families;
}

export type ItemChoiceCheck =
  | { ok: true }
  | { ok: false; heardWord: string; options: string[] };

/**
 * Is it clear the caller meant `chosen`, out of the items it sounds like?
 *
 * `customerTexts` are the caller's recent words (this turn first), and
 * `lastAssistant` is what the AI said just before. Clear means one of:
 *  1. Every identifying word of the item was said ("french fries",
 *     "kosher coney", or "coney" for the item called just "Coney").
 *  2. The caller said a word only this item has in its group ("the
 *     kosher one", "french").
 *  3. The AI's last message named this item and at least one of the
 *     others (it offered the choices) and the caller then answered.
 */
export function checkItemChoice(
  menu: readonly { name: string }[],
  chosen: string,
  customerTexts: readonly string[],
  lastAssistant: string | null
): ItemChoiceCheck {
  const chosenTokens = itemTokens(chosen);
  if (chosenTokens.length === 0) return { ok: true };

  const families = buildSimilarFamilies(menu).filter((f) => f.names.some((n) => sameName(n, chosen)));
  if (families.length === 0) return { ok: true };
  const others = Array.from(new Set(families.flatMap((f) => f.names))).filter((n) => !sameName(n, chosen));
  if (others.length === 0) return { ok: true };

  const said = textTokenSet([...customerTexts]);
  const isFullyNamedBy = (name: string, tokens: Set<string>) => itemTokens(name).every((t) => tokens.has(t));

  // The caller named a MORE specific look-alike in full ("kosher coney"),
  // so the plainer item ("Coney") is not what they meant.
  const moreSpecificSaid = others.some((o) => {
    const ot = itemTokens(o);
    return ot.length > chosenTokens.length && chosenTokens.every((t) => ot.includes(t)) && isFullyNamedBy(o, said);
  });

  if (!moreSpecificSaid) {
    // 1. Named in full, word by word ("french fries")...
    if (chosenTokens.every((t) => said.has(t))) return { ok: true };
    // ...or with the speech recogniser splitting or joining words
    // differently ("cheese burger" for Cheeseburger).
    const compact = (xs: Iterable<string>) => Array.from(xs).join("");
    const saidCompact = customerTexts.map((t) => compact(words(t).map(stem))).join("|");
    if (saidCompact.includes(compact(chosenTokens))) return { ok: true };
  }

  // 2. A word that sets it apart from every look-alike.
  const otherTokens = new Set(others.flatMap(itemTokens));
  if (!moreSpecificSaid && chosenTokens.some((t) => !otherTokens.has(t) && said.has(t))) return { ok: true };

  // 3. The AI just offered the choices, including this one.
  if (lastAssistant) {
    const offered = textTokenSet([lastAssistant]);
    const fullyNamed = (n: string) => itemTokens(n).every((t) => offered.has(t));
    if (fullyNamed(chosen) && others.some(fullyNamed)) return { ok: true };
  }

  // The options to offer come from the group of the word the caller used
  // ("fries"), or else the group of the item's own main word.
  const mainWords = chosenTokens.filter((t) => !NOT_A_MAIN_WORD.has(t));
  const headKey = mainWords[mainWords.length - 1];
  const family =
    families.find((f) => stem(f.word) === headKey && said.has(headKey)) ||
    families.find((f) => said.has(stem(f.word))) ||
    families.find((f) => stem(f.word) === headKey) ||
    families[0];
  return { ok: false, heardWord: family.word, options: family.names };
}
