/**
 * An item's combo option: stored as the item's own optional "Combo" group
 * with one option, "Make it a combo (fries & a drink)", priced at the
 * difference. The item keeps its on-its-own price, so "just the
 * cheeseburger" is $7.99 and the combo adds the rest. The AI already
 * offers any combo/meal add-on (lib/ai/systemPrompt.ts) and never makes
 * up a price that isn't on the menu.
 */
export const COMBO_GROUP_NAME = "Combo";

interface GroupLike {
  name: string;
  is_template?: boolean;
  modifiers: { name: string; price_delta_cents: number; is_active?: boolean }[];
}

export function isComboGroup(g: { name: string; is_template?: boolean }): boolean {
  return !g.is_template && g.name.trim().toLowerCase() === COMBO_GROUP_NAME.toLowerCase();
}

export function comboOptionName(comesWith: string): string {
  const w = comesWith.trim();
  return w ? `Make it a combo (${w})` : "Make it a combo";
}

/** The item's combo, if it has one: the price as a combo and what it comes with. */
export function readCombo(item: { price_cents: number; modifier_groups: GroupLike[] }): { comboPriceCents: number; comesWith: string } | null {
  const group = item.modifier_groups.find(isComboGroup);
  const option = group?.modifiers.find((m) => m.is_active !== false);
  if (!option) return null;
  const m = option.name.match(/\(([^)]*)\)\s*$/);
  return { comboPriceCents: item.price_cents + option.price_delta_cents, comesWith: m ? m[1] : "" };
}
