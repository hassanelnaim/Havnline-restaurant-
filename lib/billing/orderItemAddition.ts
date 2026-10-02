import { createAdminClient } from "@/lib/supabase/admin";
import { calculateTaxCents, type TaxableBusinessAddress } from "@/lib/billing/stripeTax";

/**
 * Shared mechanics for adding items to an order that's already been
 * placed (Phase 4 of the tablet redesign — "Add Items"). Distinct from
 * getOrCreateBuildingOrder/add_item_to_order in lib/ai/tools.ts, which
 * only ever operate on a "building" order mid-phone-call; by the time
 * either of these run, the order is already real (status confirmed/
 * submitted/failed) and may already have tax applied, so totals are
 * recomputed with tax included rather than left for confirm_and_place_order
 * to add later.
 *
 * Used by both the comp path (inserted immediately,
 * app/api/printer-app/today-orders/[id]/items) and the charge-via-QR
 * path (inserted once Stripe confirms payment, the Connect webhook's
 * addendum_id branch) — same insert/recompute, just triggered at a
 * different moment.
 */

export interface PendingAddendumModifier {
  modifierId: string | null;
  modifierName: string;
  priceDeltaCents: number;
}

export interface PendingAddendumItem {
  menuItemId: string | null;
  itemName: string;
  unitPriceCents: number;
  quantity: number;
  notes: string | null;
  modifiers: PendingAddendumModifier[];
}

export interface InsertOrderItemsResult {
  success: boolean;
  error?: string;
}

/** Inserts one or more already-resolved items (real prices locked in, or forced to 0 for a comp) straight into order_items/order_item_modifiers. */
export async function insertOrderItems(orderId: string, items: PendingAddendumItem[]): Promise<InsertOrderItemsResult> {
  const admin = createAdminClient();

  for (const item of items) {
    const { data: orderItem, error } = await admin
      .from("order_items")
      .insert({
        order_id: orderId,
        menu_item_id: item.menuItemId,
        item_name: item.itemName,
        unit_price_cents: item.unitPriceCents,
        quantity: item.quantity,
        notes: item.notes,
      })
      .select("id")
      .single();

    if (error || !orderItem) return { success: false, error: error?.message || "Could not add item." };

    if (item.modifiers.length > 0) {
      const { error: modError } = await admin.from("order_item_modifiers").insert(
        item.modifiers.map((m) => ({
          order_item_id: orderItem.id,
          modifier_id: m.modifierId,
          modifier_name: m.modifierName,
          price_delta_cents: m.priceDeltaCents,
        }))
      );
      if (modError) return { success: false, error: modError.message };
    }
  }

  return { success: true };
}

export interface RecomputedOrderTotals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

/**
 * Recomputes subtotal/tax/total from scratch across EVERY item
 * currently on the order (original items plus whatever was just
 * added), the same "re-derive, don't incrementally patch" approach
 * confirm_and_place_order uses — safer than adding a delta, since it
 * can't drift from the real line items if this is ever called twice
 * for the same addition (webhook redelivery, see its idempotency
 * guard) or interleaved with another change.
 */
export async function recomputeRealOrderTotals(orderId: string, business: TaxableBusinessAddress): Promise<RecomputedOrderTotals> {
  const admin = createAdminClient();
  const { data: items } = await admin.from("order_items").select("id, unit_price_cents, quantity").eq("order_id", orderId);

  let subtotalCents = 0;
  for (const item of items || []) {
    const { data: mods } = await admin.from("order_item_modifiers").select("price_delta_cents").eq("order_item_id", item.id);
    const modTotal = (mods || []).reduce((sum, m) => sum + m.price_delta_cents, 0);
    subtotalCents += (item.unit_price_cents + modTotal) * item.quantity;
  }

  const taxCents = await calculateTaxCents(business, subtotalCents);
  const totalCents = subtotalCents + taxCents;

  await admin.from("orders").update({ subtotal_cents: subtotalCents, tax_cents: taxCents, total_cents: totalCents }).eq("id", orderId);

  return { subtotalCents, taxCents, totalCents };
}
