import { menuNameKey } from "@/lib/menu/importDedupe";

/**
 * When the model adds or changes an item, it usually writes what it will
 * say ("Got it, one cheeseburger. Want to make it a combo?") in the same
 * response as the tool call. Normally the tool result goes back to the
 * model for a second pass just to produce that same sentence, which costs
 * about a second of silence on the phone.
 *
 * This decides whether that first-pass sentence can be spoken as is. It is
 * deliberately strict: the order must have changed exactly as asked, and
 * the sentence must not state anything the tool result could contradict
 * (prices, totals, a read-back, other items). Anything else falls back to
 * the normal second pass, so the caller never hears a wrong order.
 */

const ORDER_EDIT_TOOLS = new Set(["add_item_to_order", "update_item_quantity", "update_item_modifiers", "remove_item_from_order"]);

type Call = { name: string; input: unknown; result: unknown };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function changedExactlyAsAsked(call: Call): boolean {
  const r = (call.result || {}) as Record<string, unknown>;
  if (r.success !== true || r.needs_choice) return false;
  const input = (call.input || {}) as Record<string, unknown>;

  if (call.name === "add_item_to_order") {
    const added = (r.added || {}) as Record<string, unknown>;
    if (added.promotion_applied) return false; // worth saying; let the model see it
    const wantedQty = Math.max(1, Number(input.quantity) || 1);
    if (Number(added.quantity) !== wantedQty) return false;
    const asked = ((input.modifier_names as string[] | undefined) || []).map(norm).filter(Boolean);
    const got = ((added.modifiers as string[] | undefined) || []).map(norm);
    // Every option the caller asked for was a real one and went on.
    return asked.length === got.length && asked.every((a) => got.includes(a));
  }
  if (call.name === "update_item_modifiers") {
    const asked = ((input.modifier_names as string[] | undefined) || []).map(norm).filter(Boolean);
    const got = ((r.modifiers as string[] | undefined) || []).map(norm);
    return asked.length === got.length && asked.every((a) => got.includes(a));
  }
  if (call.name === "update_item_quantity") {
    return Number(r.new_quantity) === Math.max(0, Number(input.quantity));
  }
  return call.name === "remove_item_from_order";
}

/** Menu item names mentioned in the text that no tool in this step touched. */
function mentionsOtherItems(text: string, calls: Call[], menuNames: readonly string[]): boolean {
  const spoken = ` ${norm(text)} `;
  const touched = new Set(
    calls.map((c) => menuNameKey(String(((c.result || {}) as { added?: { item?: string } }).added?.item || ((c.input || {}) as { item_name?: string }).item_name || "")))
  );
  return menuNames.some((name) => {
    const n = norm(name);
    if (n.length < 3 || !spoken.includes(` ${n} `)) return false;
    return !touched.has(menuNameKey(name));
  });
}

export function canUseFirstPassReply(text: string, calls: Call[], menuNames: readonly string[]): boolean {
  const t = text.trim();
  if (t.length < 12 || calls.length === 0) return false;
  if (!calls.every((c) => ORDER_EDIT_TOOLS.has(c.name) && changedExactlyAsAsked(c))) return false;
  // Nothing the tool result could contradict: money, totals, a read-back.
  if (/\$|\d+\s*(dollar|cent)|\b(total|subtotal|comes to|that'?s all|so that'?s|your order is|order so far|altogether)\b/i.test(t)) return false;
  // A placeholder ("let me add that") is not an answer.
  if (/\b(let me|i'?ll (add|get|put|update|change|remove)|one (moment|sec)|hold on|adding that)\b/i.test(t)) return false;
  // It should move the conversation on: a question, or a full sentence.
  if (!/[?.!]$/.test(t)) return false;
  if (!countsMatch(t, calls)) return false;
  return !mentionsOtherItems(t, calls, menuNames);
}

const COUNT_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2 };

/** Any count said ("two coneys", "3 cokes") must be a quantity that was actually set. */
function countsMatch(text: string, calls: Call[]): boolean {
  const said: number[] = [];
  for (const w of norm(text).split(" ")) {
    if (COUNT_WORDS[w]) said.push(COUNT_WORDS[w]);
    else if (/^\d{1,2}$/.test(w)) said.push(parseInt(w, 10));
  }
  if (said.length === 0) return true;
  const set = new Set<number>();
  for (const c of calls) {
    const r = (c.result || {}) as { added?: { quantity?: number }; new_quantity?: number };
    if (r.added?.quantity) set.add(Number(r.added.quantity));
    if (typeof r.new_quantity === "number") set.add(r.new_quantity);
  }
  return said.every((n) => n === 1 || set.has(n));
}
