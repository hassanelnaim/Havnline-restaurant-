import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What is on the order being built right now, in the shape the AI reads.
 *
 * Why this exists: the AI's memory of a call is only the words that were
 * spoken — the tool calls it made on earlier turns (and what they returned)
 * are not replayed to it. So on the turn after "a cheeseburger", the model
 * has no record that a cheeseburger is already on the order, and could add
 * it again (the order then reads back as two). It also had to spend an
 * entire extra model pass calling get_current_order just to find out what
 * was on the order before it could read it back.
 *
 * The live order is now handed to the model at the start of every turn, and
 * every add/change/remove result carries the updated order. The model never
 * has to guess what is on the order, and a read-back needs no extra pass.
 * The numbers are the database's, computed here — the model never does the
 * arithmetic.
 */

export interface OrderLine {
  name: string;
  quantity: number;
  modifiers: string[];
  notes: string | null;
  /** Price of this whole line: (unit price + modifiers) x quantity, in dollars. */
  line_total: number;
}

export interface OrderSnapshot {
  items: OrderLine[];
  /** Sum of every line, before tax, in dollars. */
  subtotal: number;
}

export interface OrderItemRow {
  id: string;
  item_name: string;
  quantity: number;
  unit_price_cents: number;
  notes: string | null;
}

export interface OrderModifierRow {
  order_item_id: string;
  modifier_name: string;
  price_delta_cents: number;
}

/** Pure: the order's subtotal in cents — the figure that is charged. */
export function orderSubtotalCents(items: OrderItemRow[], modifiers: OrderModifierRow[]): number {
  return items.reduce((sum, item) => {
    const modTotal = modifiers.filter((m) => m.order_item_id === item.id).reduce((s, m) => s + m.price_delta_cents, 0);
    return sum + (item.unit_price_cents + modTotal) * item.quantity;
  }, 0);
}

/** Pure: turns the database rows into the snapshot. */
export function buildOrderSnapshot(items: OrderItemRow[], modifiers: OrderModifierRow[]): OrderSnapshot {
  const lines: OrderLine[] = items.map((item) => {
    const mods = modifiers.filter((m) => m.order_item_id === item.id);
    const modTotal = mods.reduce((sum, m) => sum + m.price_delta_cents, 0);
    return {
      name: item.item_name,
      quantity: item.quantity,
      modifiers: mods.map((m) => m.modifier_name),
      notes: item.notes ?? null,
      line_total: ((item.unit_price_cents + modTotal) * item.quantity) / 100,
    };
  });
  return { items: lines, subtotal: orderSubtotalCents(items, modifiers) / 100 };
}

function money(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

function describeLine(line: OrderLine): string {
  const extras = [...line.modifiers, ...(line.notes ? [`note: ${line.notes}`] : [])];
  return `- ${line.quantity} x ${line.name}${extras.length ? ` (${extras.join(", ")})` : ""} — ${money(line.line_total)}`;
}

export type CurrentOrder =
  | { status: "ok"; order: OrderSnapshot }
  | { status: "none" }
  | { status: "error" };

/**
 * The text block shown to the model: the live order, or a clear statement
 * that it is empty / could not be loaded. A failed load must never read as
 * "empty" — the model would then happily add everything a second time.
 */
export function formatOrderStateBlock(current: CurrentOrder): string {
  if (current.status === "error") {
    return "CURRENT ORDER: it could not be loaded this turn. Call get_current_order to see what is on the order before you say anything about it or add anything to it.";
  }
  if (current.status === "none" || current.order.items.length === 0) {
    return "CURRENT ORDER (read live from the database): no order is being built right now, so there is nothing on it. (An order placed earlier in this call is no longer here — it can't be changed from this conversation.)";
  }
  const lines = current.order.items.map(describeLine).join("\n");
  return `CURRENT ORDER (read live from the database — this is exactly what is on the order right now, with the real quantities):
${lines}
Order subtotal so far: ${money(current.order.subtotal)} (before tax).`;
}

/** Shown for the rest of a turn once the order has been placed. */
export const ORDER_PLACED_BLOCK =
  "CURRENT ORDER: the order has just been placed, so no order is being built right now. Describe it to the customer only from what confirm_and_place_order returned.";

/**
 * Reads the order being built on this call. Three small queries (order,
 * its items, their modifiers), the last two only if there is an order.
 */
export async function loadCurrentOrder(callId: string): Promise<CurrentOrder> {
  try {
    const admin = createAdminClient();
    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("id")
      .eq("call_id", callId)
      .eq("status", "building")
      .maybeSingle();
    if (orderError) return { status: "error" };
    if (!order) return { status: "none" };

    const { data: items, error: itemsError } = await admin
      .from("order_items")
      .select("id, item_name, quantity, unit_price_cents, notes")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true });
    if (itemsError) return { status: "error" };

    const ids = (items || []).map((i) => i.id);
    let mods: OrderModifierRow[] = [];
    if (ids.length > 0) {
      const { data, error: modsError } = await admin
        .from("order_item_modifiers")
        .select("order_item_id, modifier_name, price_delta_cents")
        .in("order_item_id", ids);
      if (modsError) return { status: "error" };
      mods = (data || []) as OrderModifierRow[];
    }

    return { status: "ok", order: buildOrderSnapshot((items || []) as OrderItemRow[], mods) };
  } catch (err) {
    console.error(`[orderState] could not load the current order for call ${callId}:`, err);
    return { status: "error" };
  }
}
