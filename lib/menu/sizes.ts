/**
 * Item sizes (Small / Large, with a full price for each) are stored the way
 * the AI and the order system already understand: a required, pick-one
 * add-on group called "Size" on that item, whose options carry the price
 * difference from the cheapest size. The item's own price is the cheapest
 * size. So "Small $3.49, Large $4.99" is stored as price $3.49 plus
 * Size: Small (+$0), Large (+$1.50). The AI must ask for a required choice,
 * and the order system refuses the item without one.
 *
 * Client-safe: no server imports.
 */
export const SIZE_GROUP_NAME = "Size";

export interface SizeOption {
  name: string;
  /** Full price of the item in this size, in cents. */
  priceCents: number;
}

export const SIZE_PRESETS: string[][] = [
  ["Small", "Large"],
  ["Small", "Medium", "Large"],
  ["Regular", "Large"],
  ["Small", "Medium", "Large", "Extra Large"],
];

type GroupLike = { name: string; is_template?: boolean; menu_item_id?: string | null; modifiers: { name: string; price_delta_cents: number }[] };

export function isSizeGroup(g: { name: string; is_template?: boolean }): boolean {
  return !g.is_template && g.name.trim().toLowerCase() === SIZE_GROUP_NAME.toLowerCase();
}

/** The item's sizes with full prices, or null if it has none. */
export function readSizes(item: { price_cents: number; modifier_groups: GroupLike[] }): SizeOption[] | null {
  const group = item.modifier_groups.find(isSizeGroup);
  if (!group || group.modifiers.length === 0) return null;
  return group.modifiers.map((m) => ({ name: m.name, priceCents: item.price_cents + m.price_delta_cents }));
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** "$3.49" or "$3.49 – $4.99". */
export function priceRangeText(basePriceCents: number, sizes: SizeOption[] | null): string {
  if (!sizes || sizes.length === 0) return money(basePriceCents);
  const prices = sizes.map((s) => s.priceCents);
  const lo = Math.min(...prices), hi = Math.max(...prices);
  return lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`;
}

/** Checks a size list from a form. Returns cleaned sizes or an error. */
export function validateSizes(input: { name: string; price: string }[]): { ok: true; sizes: SizeOption[] } | { ok: false; error: string } {
  const rows = input.filter((r) => r.name.trim() || r.price.trim());
  if (rows.length === 0) return { ok: true, sizes: [] };
  if (rows.length < 2) return { ok: false, error: "Add at least two sizes, or turn sizes off." };
  if (rows.length > 8) return { ok: false, error: "That's a lot of sizes. Keep it to 8 or fewer." };
  const sizes: SizeOption[] = [];
  for (const r of rows) {
    const name = r.name.trim().slice(0, 40);
    if (!name) return { ok: false, error: "Every size needs a name, like Small or Large." };
    const price = parseFloat(r.price);
    if (!r.price.trim() || !Number.isFinite(price) || price < 0) return { ok: false, error: `Enter a price for ${name}, like 3.49.` };
    if (sizes.some((s) => s.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `"${name}" is listed twice.` };
    sizes.push({ name, priceCents: Math.round(price * 100) });
  }
  return { ok: true, sizes };
}
