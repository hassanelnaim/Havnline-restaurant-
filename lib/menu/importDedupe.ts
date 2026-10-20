/**
 * Keeps a menu import from creating duplicates. Photos often show the same
 * item twice (overlapping pictures, an item listed on two pages), and the
 * reader may spell it slightly differently each time: "Cheese Burger" vs
 * "Cheeseburger", "Chicken Strip" vs "Chicken Strips".
 *
 * menuNameKey reduces a name to what identifies it (case, spaces,
 * punctuation and plural "s" don't matter), so both copies get the same key.
 * dedupeImportItems keeps one item per key and remembers when the copies
 * had different prices, so the owner can check which is right.
 *
 * Client-safe and used on the server too (importMenuItemsAction skips any
 * item already on the menu by the same key).
 */
import type { ExtractedMenuItem } from "@/lib/ai/websiteImport";

export function menuNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && w !== "and")
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join("");
}

export interface DedupeResult {
  items: ExtractedMenuItem[];
  /** How many copies were folded into an item already in the list. */
  merged: number;
  /** Items whose copies had different prices: key -> the prices seen. */
  priceConflicts: Record<string, string[]>;
}

const priceOf = (p: string) => {
  const n = parseFloat(p);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : "";
};

export function dedupeImportItems(items: ExtractedMenuItem[]): DedupeResult {
  const byKey = new Map<string, ExtractedMenuItem>();
  const order: string[] = [];
  const prices = new Map<string, Set<string>>();
  let merged = 0;

  for (const raw of items) {
    const key = menuNameKey(raw.name);
    if (!key) continue;
    const price = priceOf(raw.priceDollars);
    if (!prices.has(key)) prices.set(key, new Set());
    if (price) prices.get(key)!.add(price);

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...raw, modifierGroups: [...raw.modifierGroups] });
      order.push(key);
      continue;
    }
    merged++;
    // Fill in whatever the first copy was missing; never overwrite what it had.
    if (!priceOf(existing.priceDollars) && price) existing.priceDollars = price;
    if (raw.description.length > existing.description.length) existing.description = raw.description;
    if (!existing.category && raw.category) existing.category = raw.category;
    for (const g of raw.modifierGroups) {
      if (!existing.modifierGroups.some((e) => e.name.trim().toLowerCase() === g.name.trim().toLowerCase())) existing.modifierGroups.push(g);
    }
  }

  const priceConflicts: Record<string, string[]> = {};
  prices.forEach((set, key) => {
    if (set.size > 1) priceConflicts[key] = Array.from(set).sort((a, b) => parseFloat(a) - parseFloat(b));
  });
  return { items: order.map((k) => byKey.get(k)!), merged, priceConflicts };
}
