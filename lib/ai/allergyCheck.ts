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

const STOP = new Set(["allergy", "allergic", "allergies", "to", "an", "a", "the", "and", "or", "of", "severe", "mild", "intolerance", "intolerant", "no", "free"]);

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
      const hit = sources.find((s) => terms.some((term) => mentions(s, term)));
      if (hit && !out.some((o) => o.item === item.name && o.allergen === allergen)) out.push({ item: item.name, allergen, menuSays: hit });
    }
  }
  return out;
}
