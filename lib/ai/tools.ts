import { createAdminClient } from "@/lib/supabase/admin";
import { smsClient } from "@/lib/integrations/sms";
import { sendEscalationEmail } from "@/lib/notifications/escalation-email";
import { createOrderCheckoutSession } from "@/lib/billing/stripeConnect";
import { queuePrintJob } from "@/lib/integrations/printer-app";
import { getSiteUrl } from "@/lib/env";
import { isBusinessOpenNow } from "@/lib/business/hours";
import { calculateTaxCents } from "@/lib/billing/stripeTax";
import { effectivePriceCents, describeTimePricing } from "@/lib/business/pricing";
import { shouldAttemptLiveTransfer, LIVE_TRANSFER_MARKER } from "./liveTransfer";
import type { BusinessContext } from "./context";
import type { OrderWithItems } from "@/lib/database/types";

export interface ToolContext {
  businessId: string;
  callId: string;
  channel: "test" | "phone";
  context: BusinessContext;
  // The real, Twilio-verified caller ID for this call (calls.phone,
  // set once at call start from Twilio's own From param) — never a
  // phone number the model merely heard/inferred mid-conversation.
  // null for the test channel, which has no real caller.
  callerPhone: string | null;
}

export interface ToolResult {
  [key: string]: unknown;
}

async function get_business_information(_input: unknown, ctx: ToolContext): Promise<ToolResult> {
  const { business, hours } = ctx.context;
  return { name: business.name, description: business.description, address: business.address, phone: business.phone, hours };
}

async function get_menu(_input: unknown, ctx: ToolContext): Promise<ToolResult> {
  return {
    menu: ctx.context.menu.map((item) => {
      const schedule = describeTimePricing(item);
      return {
        name: item.name,
        price: effectivePriceCents(item, ctx.context.business.timezone) / 100,
        // Only present for an item with time-based pricing — tells the
        // AI the full schedule so it can explain why the price is
        // different earlier/later, not just quote the current number.
        ...(schedule ? { price_schedule: schedule } : {}),
        description: item.description,
        modifier_groups: item.modifier_groups.map((g) => ({
          name: g.name,
          required: g.is_required,
          min_select: g.min_select,
          max_select: g.max_select,
          options: g.modifiers.map((m) => ({ name: m.name, price_delta: m.price_delta_cents / 100 })),
        })),
      };
    }),
  };
}

async function lookup_customer(input: { phone: string }, ctx: ToolContext): Promise<ToolResult> {
  const admin = createAdminClient();
  // On a real call, always look up by the verified caller ID Twilio
  // gave us at call start — never the phone number the model just
  // heard/inferred from what the customer said. Otherwise a caller
  // could fish for another customer's name/email/notes simply by
  // asking to look up a number that isn't theirs. The test channel has
  // no real caller ID, so it keeps the free-form lookup for the
  // owner's own testing.
  const phone = ctx.channel === "phone" && ctx.callerPhone ? ctx.callerPhone : input.phone;
  const { data } = await admin.from("customers").select("*").eq("business_id", ctx.businessId).eq("phone", phone).maybeSingle();
  return data ? { found: true, customer: data } : { found: false };
}

async function create_customer(input: { name: string; phone: string }, ctx: ToolContext): Promise<ToolResult> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("customers").select("*").eq("business_id", ctx.businessId).eq("phone", input.phone).maybeSingle();
  if (existing) return { customer: existing };

  const { data, error } = await admin
    .from("customers")
    .insert({ business_id: ctx.businessId, name: input.name, phone: input.phone })
    .select()
    .single();
  if (error) return { error: error.message };
  return { customer: data };
}

// --------------------------------------------------------------------------
// Order building. An order is built up across several tool calls in the
// same phone call (one per item added), then locked in with
// confirm_and_place_order. Everything before that lives at status
// "building" and is invisible to the business's Orders dashboard —
// nothing is real until the customer has actually confirmed it.
// --------------------------------------------------------------------------

async function getOrCreateBuildingOrder(ctx: ToolContext): Promise<string> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("orders")
    .select("id")
    .eq("call_id", ctx.callId)
    .eq("status", "building")
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from("orders")
    .insert({ business_id: ctx.businessId, call_id: ctx.callId, status: "building" })
    .select("id")
    .single();

  if (error || !created) {
    // A genuinely concurrent request (a Twilio retry landing while the
    // original turn is still mid-flight — see handleTurn's dedupe
    // comment) can lose this exact race: both selects above find
    // nothing, then both try to insert. A DB-level constraint
    // (migration 019) makes the loser's insert fail with a unique
    // violation (Postgres 23505) instead of silently succeeding and
    // creating a second order for the same call. Treat that as a win,
    // not an error — re-select the row the other request just created.
    if (error?.code === "23505") {
      const { data: winner } = await admin.from("orders").select("id").eq("call_id", ctx.callId).eq("status", "building").maybeSingle();
      if (winner) return winner.id;
    }
    throw new Error(error?.message || "Could not start an order.");
  }
  return created.id;
}

// Speech-to-text and casual phrasing almost never match a menu name's
// exact punctuation/spacing ("cheese burger" vs "Cheeseburger", a
// trailing period, double spaces) — the model is still the one
// deciding WHICH item was meant, this just stops a real menu item
// from being falsely rejected over formatting alone. Strips everything
// but letters/digits/spaces, collapses whitespace, lowercases.
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Exact normalized match first; if nothing matches, fall back to a
// substring check in either direction (handles the model passing extra
// words like "a cheeseburger" or a shortened "burger" for "Cheeseburger
// Deluxe"). Returns null rather than guessing when more than one item
// would match the fallback, since picking the wrong item silently is
// worse than asking the model to try again.
function findMenuItem<T extends { name: string }>(menu: T[], rawName: string): T | undefined {
  const target = normalizeForMatch(rawName);
  if (!target) return undefined;

  const exact = menu.find((m) => normalizeForMatch(m.name) === target);
  if (exact) return exact;

  const partial = menu.filter((m) => {
    const name = normalizeForMatch(m.name);
    return name.includes(target) || target.includes(name);
  });
  return partial.length === 1 ? partial[0] : undefined;
}

// Writes in this file used to ignore the database's error result, so a
// failed write looked like a success and the AI told the caller their
// change had happened. `must` turns a failed write into a thrown error
// (the tool runner reports it to the AI, which tells the caller there was
// a problem) for steps whose failure leaves the order wrong. `soft` is for
// follow-up bookkeeping after the real work succeeded: failing it must
// not undo or misreport the order, so it only logs. Everything after the
// order has been claimed in confirm_and_place_order uses `soft`: throwing
// there would leave a claimed order behind, and a retry would then be told
// "already placed" for an order the customer was never charged for.
async function must<T extends { error: { message: string } | null }>(label: string, op: PromiseLike<T>): Promise<T> {
  const res = await op;
  if (res.error) throw new Error(`Could not ${label}: ${res.error.message}`);
  return res;
}

async function soft<T extends { error: { message: string } | null }>(label: string, op: PromiseLike<T>): Promise<void> {
  try {
    const res = await op;
    if (res.error) console.error(`[tools] could not ${label}: ${res.error.message}`);
  } catch (err) {
    console.error(`[tools] could not ${label}:`, err);
  }
}

async function recomputeOrderSubtotal(orderId: string): Promise<number> {
  const admin = createAdminClient();
  const { data: items, error: itemsError } = await admin.from("order_items").select("id, unit_price_cents, quantity").eq("order_id", orderId);
  // A failed read must never be treated as "no items": that would write a
  // $0 subtotal, and a $0 order is treated as free (no payment, straight
  // to the kitchen). Throw instead; the tool runner turns it into an
  // error the AI can report, and the stored subtotal is left untouched.
  if (itemsError) throw new Error(`Could not read the order's items: ${itemsError.message}`);
  let subtotal = 0;
  for (const item of items || []) {
    const { data: mods, error: modsError } = await admin.from("order_item_modifiers").select("price_delta_cents").eq("order_item_id", item.id);
    if (modsError) throw new Error(`Could not read an item's modifiers: ${modsError.message}`);
    const modTotal = (mods || []).reduce((sum, m) => sum + m.price_delta_cents, 0);
    subtotal += (item.unit_price_cents + modTotal) * item.quantity;
  }
  const { error: updateError } = await admin.from("orders").update({ subtotal_cents: subtotal, total_cents: subtotal }).eq("id", orderId);
  if (updateError) throw new Error(`Could not save the order total: ${updateError.message}`);
  return subtotal;
}

async function add_item_to_order(
  input: { item_name: string; quantity?: number; modifier_names?: string[]; notes?: string },
  ctx: ToolContext
): Promise<ToolResult> {
  const admin = createAdminClient();

  // Hard server-side cutoff — the AI is also told this in the system
  // prompt, but that's just an instruction it could fail to follow. A
  // closed business cannot have an order built or placed, period,
  // regardless of what the model does or says.
  if (!isBusinessOpenNow(ctx.context.business, ctx.context.hours)) {
    return { success: false, reason: "This business is currently closed and can't accept orders right now. Tell the customer you're closed rather than adding this item." };
  }

  // Never invent a menu item or its price — only match against the real
  // menu loaded for this business. Matched leniently (see
  // normalizeForMatch/findMenuItem) because speech-to-text phrasing
  // ("cheese burger," extra articles, odd punctuation) should never make
  // a real menu item come back as "not on the menu."
  const menuItem = findMenuItem(ctx.context.menu, input.item_name);
  if (!menuItem) {
    return { success: false, reason: `"${input.item_name}" isn't on the menu. Only offer items from get_menu.` };
  }

  const quantity = Math.max(1, input.quantity || 1);
  const requestedModifierNames = (input.modifier_names || []).map((n) => normalizeForMatch(n));
  const allModifiers = menuItem.modifier_groups.flatMap((g) => g.modifiers);
  const matchedModifiers = allModifiers.filter((m) => requestedModifierNames.includes(normalizeForMatch(m.name)));

  // Check required modifier groups actually got a selection.
  const missingRequired = menuItem.modifier_groups.filter(
    (g) => g.is_required && !g.modifiers.some((m) => matchedModifiers.includes(m))
  );
  if (missingRequired.length > 0) {
    return {
      success: false,
      reason: `"${menuItem.name}" requires a choice for: ${missingRequired.map((g) => g.name).join(", ")}. Ask the customer and try again.`,
    };
  }

  const orderId = await getOrCreateBuildingOrder(ctx);

  // Guard against a duplicate call for what's really the same logical
  // item — e.g. the model adds "Cheeseburger" plain the moment the
  // customer names it, then a few seconds later calls this AGAIN with
  // "no onions, no pickles" once it has that detail, instead of using
  // update_item_modifiers. Without this, that pattern silently doubles
  // the quantity (two separate rows) and the modifiers only land on
  // one of them. Only merges when the earlier row is still completely
  // bare (no modifiers, no notes, quantity 1) and this new call is also
  // for a single unit — two people deliberately ordering the same
  // plain item never looks like this, since neither call would be
  // "detailing" an existing bare row within seconds of it being added.
  if (quantity === 1) {
    const recentCutoff = new Date(Date.now() - 15_000).toISOString();
    const { data: recentRows } = await admin
      .from("order_items")
      .select("id, quantity, notes")
      .eq("order_id", orderId)
      .eq("item_name", menuItem.name)
      .gte("created_at", recentCutoff)
      .order("created_at", { ascending: false })
      .limit(1);

    const candidate = recentRows?.[0];
    if (candidate && candidate.quantity === 1 && !candidate.notes) {
      const { data: existingMods } = await admin.from("order_item_modifiers").select("id").eq("order_item_id", candidate.id).limit(1);
      if (!existingMods || existingMods.length === 0) {
        if (input.notes) await must("update order item", admin.from("order_items").update({ notes: input.notes }).eq("id", candidate.id));
        if (matchedModifiers.length > 0) {
          await must("add modifiers", admin.from("order_item_modifiers").insert(
            matchedModifiers.map((m) => ({ order_item_id: candidate.id, modifier_id: m.id, modifier_name: m.name, price_delta_cents: m.price_delta_cents }))
          ));
        }
        const subtotal = await recomputeOrderSubtotal(orderId);
        return {
          success: true,
          added: { item: menuItem.name, quantity: 1, modifiers: matchedModifiers.map((m) => m.name) },
          running_subtotal: subtotal / 100,
        };
      }
    }
  }

  // Charge whatever this item's real price is RIGHT NOW — for most
  // items that's just price_cents, but an item with time-based pricing
  // (e.g. a Breakfast Special) needs the actual current price locked
  // in at the moment it's added, not a stale price from whenever the
  // menu was quoted earlier in the call.
  const unitPriceCents = effectivePriceCents(menuItem, ctx.context.business.timezone);

  const { data: orderItem, error } = await admin
    .from("order_items")
    .insert({
      order_id: orderId,
      menu_item_id: menuItem.id,
      item_name: menuItem.name,
      unit_price_cents: unitPriceCents,
      quantity,
      notes: input.notes || null,
    })
    .select("id")
    .single();

  if (error || !orderItem) return { success: false, reason: error?.message || "Could not add item." };

  if (matchedModifiers.length > 0) {
    await must("add modifiers", admin.from("order_item_modifiers").insert(
      matchedModifiers.map((m) => ({
        order_item_id: orderItem.id,
        modifier_id: m.id,
        modifier_name: m.name,
        price_delta_cents: m.price_delta_cents,
      }))
    ));
  }

  const subtotal = await recomputeOrderSubtotal(orderId);

  return {
    success: true,
    added: { item: menuItem.name, quantity, modifiers: matchedModifiers.map((m) => m.name) },
    running_subtotal: subtotal / 100,
  };
}

// A dedicated, single-call fix for "actually make that just 2" / "I only
// want 1" — changing the quantity of an item already on the order.
// Added because the only prior way to do this was remove_item_from_order
// followed by a second add_item_to_order call, which depends on the
// model actually completing BOTH steps; a model that says "I'll fix
// that" and only completes (or only attempts) one of them leaves the
// order silently wrong — exactly the real-world failure this closes.
async function update_item_quantity(input: { item_name: string; quantity: number }, ctx: ToolContext): Promise<ToolResult> {
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id").eq("call_id", ctx.callId).eq("status", "building").maybeSingle();
  if (!order) return { success: false, reason: "No order in progress." };

  const { data: matches } = await admin
    .from("order_items")
    .select("id")
    .eq("order_id", order.id)
    .ilike("item_name", input.item_name)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!matches || matches.length === 0) return { success: false, reason: `"${input.item_name}" isn't in the current order.` };

  const newQuantity = Math.round(input.quantity);
  if (newQuantity <= 0) {
    // Same end state as remove_item_from_order — "change it to 0" means
    // take it off the order entirely.
    await must("remove order item", admin.from("order_items").delete().eq("id", matches[0].id));
  } else {
    await must("update order item", admin.from("order_items").update({ quantity: newQuantity }).eq("id", matches[0].id));
  }

  const subtotal = await recomputeOrderSubtotal(order.id);
  return { success: true, item: input.item_name, new_quantity: newQuantity <= 0 ? 0 : newQuantity, running_subtotal: subtotal / 100 };
}

// A dedicated, single-call fix for correcting an item's toppings/notes
// AFTER it's already on the order ("actually, no onions on that" said
// a beat after the item itself) — the same reasoning as
// update_item_quantity above, for the same failure mode: the previous
// way to do this was remove_item_from_order + add_item_to_order, which
// depends on the model completing both steps, and skipping the removal
// silently doubles the item instead of just fixing its modifiers.
// REPLACES the item's modifiers/notes outright (not additive) — the
// model should pass the item's full, final set of modifiers each time.
async function update_item_modifiers(input: { item_name: string; modifier_names?: string[]; notes?: string }, ctx: ToolContext): Promise<ToolResult> {
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id").eq("call_id", ctx.callId).eq("status", "building").maybeSingle();
  if (!order) return { success: false, reason: "No order in progress." };

  const { data: matches } = await admin
    .from("order_items")
    .select("id, menu_item_id")
    .eq("order_id", order.id)
    .ilike("item_name", input.item_name)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!matches || matches.length === 0) return { success: false, reason: `"${input.item_name}" isn't in the current order.` };

  const orderItemId = matches[0].id;
  const menuItem = ctx.context.menu.find((m) => m.id === matches[0].menu_item_id);

  await must("update order item", admin.from("order_items").update({ notes: input.notes || null }).eq("id", orderItemId));
  await must("clear modifiers", admin.from("order_item_modifiers").delete().eq("order_item_id", orderItemId));

  let matchedModifierNames: string[] = [];
  if (menuItem && input.modifier_names?.length) {
    const requestedModifierNames = input.modifier_names.map((n) => normalizeForMatch(n));
    const allModifiers = menuItem.modifier_groups.flatMap((g) => g.modifiers);
    const matchedModifiers = allModifiers.filter((m) => requestedModifierNames.includes(normalizeForMatch(m.name)));
    if (matchedModifiers.length > 0) {
      await must("add modifiers", admin.from("order_item_modifiers").insert(
        matchedModifiers.map((m) => ({ order_item_id: orderItemId, modifier_id: m.id, modifier_name: m.name, price_delta_cents: m.price_delta_cents }))
      ));
    }
    matchedModifierNames = matchedModifiers.map((m) => m.name);
  }

  const subtotal = await recomputeOrderSubtotal(order.id);
  return { success: true, item: input.item_name, modifiers: matchedModifierNames, notes: input.notes || null, running_subtotal: subtotal / 100 };
}

async function remove_item_from_order(input: { item_name: string }, ctx: ToolContext): Promise<ToolResult> {
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id").eq("call_id", ctx.callId).eq("status", "building").maybeSingle();
  if (!order) return { success: false, reason: "No order in progress." };

  const { data: matches } = await admin
    .from("order_items")
    .select("id")
    .eq("order_id", order.id)
    .ilike("item_name", input.item_name)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!matches || matches.length === 0) return { success: false, reason: `"${input.item_name}" isn't in the current order.` };

  await must("remove order item", admin.from("order_items").delete().eq("id", matches[0].id));
  const subtotal = await recomputeOrderSubtotal(order.id);
  return { success: true, removed: input.item_name, running_subtotal: subtotal / 100 };
}

async function get_current_order(_input: unknown, ctx: ToolContext): Promise<ToolResult> {
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("*").eq("call_id", ctx.callId).eq("status", "building").maybeSingle();
  if (!order) return { items: [], subtotal: 0 };

  const { data: items } = await admin.from("order_items").select("*").eq("order_id", order.id);
  const itemsWithModifiers = [];
  for (const item of items || []) {
    const { data: mods } = await admin.from("order_item_modifiers").select("modifier_name").eq("order_item_id", item.id);
    itemsWithModifiers.push({ name: item.item_name, quantity: item.quantity, modifiers: (mods || []).map((m) => m.modifier_name), notes: item.notes });
  }

  return { items: itemsWithModifiers, subtotal: order.subtotal_cents / 100 };
}

async function confirm_and_place_order(
  input: { customer_name: string; phone: string; special_instructions?: string },
  ctx: ToolContext
): Promise<ToolResult> {
  const admin = createAdminClient();

  // Same hard cutoff as add_item_to_order. Checked again here (not just
  // when items were added) because a call can sit in progress across
  // the exact moment a business's closing time passes.
  if (!isBusinessOpenNow(ctx.context.business, ctx.context.hours)) {
    return { success: false, reason: "This business is currently closed and can't accept orders right now. Tell the customer you're closed rather than placing this order." };
  }

  const { data: order } = await admin.from("orders").select("*").eq("call_id", ctx.callId).eq("status", "building").maybeSingle();
  if (!order) return { success: false, reason: "No order to confirm — add items first." };

  const { data: orderItems } = await admin.from("order_items").select("id").eq("order_id", order.id);
  if (!orderItems || orderItems.length === 0) return { success: false, reason: "The order is empty — add at least one item first." };

  // order.subtotal_cents is already kept current by recomputeOrderSubtotal
  // on every add/remove, so whether this order has anything to collect
  // at all is knowable before claiming it — needed below to decide
  // whether this order actually requires payment. (A $0 subtotal is
  // always a $0 total regardless of tax, so this doesn't need an
  // actual Stripe Tax call — just the subtotal.)
  const business = ctx.context.business;
  // Recomputed from the actual items rather than trusting the stored
  // number: whether an order is "free" decides if payment is skipped, so
  // that decision must not rest on a value that could be stale or wrong.
  const preClaimSubtotal = await recomputeOrderSubtotal(order.id);
  const isFreeOrder = preClaimSubtotal === 0;

  // Phone payments (Stripe Connect) are mandatory for every REAL phone
  // order with an actual cost — there is no pay-at-pickup path for a
  // priced order. Two things are exempt from needing Stripe connected
  // at all: a genuinely free order (nothing to collect, so nothing to
  // gate on payment — and Stripe itself refuses a $0 Checkout Session
  // anyway), and the "test" channel, the dashboard's own preview chat
  // (app/api/ai/chat/route.ts) — the owner talking to their own AI,
  // never an actual customer or a real order.
  if (ctx.channel === "phone" && !isFreeOrder && (!business.stripe_connect_charges_enabled || !business.stripe_connect_account_id)) {
    return {
      success: false,
      reason:
        "This business hasn't finished setting up phone payments yet, so orders can't be taken over the phone right now — tell the customer you're unable to take their order at the moment and offer to escalate a message for the business to call them back.",
    };
  }

  const { data: existingCustomer } = await admin.from("customers").select("id").eq("business_id", ctx.businessId).eq("phone", input.phone).maybeSingle();
  let customerId = existingCustomer?.id;
  if (!customerId) {
    const { data: newCustomer } = await admin.from("customers").insert({ business_id: ctx.businessId, name: input.customer_name, phone: input.phone }).select().single();
    customerId = newCustomer?.id;
  }

  // Conditioned on status still being "building" — an atomic
  // claim, not just a write. If two overlapping requests for the same
  // call both reach this point (the narrower race handleTurn's own
  // dedupe can still miss — see its "fall through" comment), only the
  // first one's update actually matches a row and flips the status;
  // the second gets back no row and must NOT print a second kitchen
  // ticket, start a second Checkout Session, or send a second
  // confirmation text for the same order.
  const { data: claimedOrder } = await admin
    .from("orders")
    .update({
      status: "confirmed",
      customer_id: customerId,
      customer_name: input.customer_name,
      phone: input.phone,
      special_instructions: input.special_instructions || null,
    })
    .eq("id", order.id)
    .eq("status", "building")
    .select("id")
    .maybeSingle();

  if (!claimedOrder) {
    return { success: true, order_id: order.id, already_placed: true };
  }

  await soft("record call outcome", admin.from("calls").update({ outcome: "order_placed" }).eq("id", ctx.callId));

  // Attempt to actually send this to the kitchen printer app. If this
  // fails (not paired, printer offline), the order still exists and
  // shows up on the business's Orders dashboard with the failure
  // reason — the customer still hears their order was placed, and the
  // business follows up manually rather than the customer being told
  // something went wrong mid-call for a problem that isn't theirs to
  // solve.
  const orderWithItemsRes = await admin.from("orders").select("*").eq("id", order.id).single();
  const itemsRes = await admin.from("order_items").select("*").eq("order_id", order.id);
  const itemIds = (itemsRes.data || []).map((i) => i.id);
  const modifiersRes = itemIds.length ? await admin.from("order_item_modifiers").select("*").in("order_item_id", itemIds) : { data: [] };

  const fullOrder: OrderWithItems = {
    ...orderWithItemsRes.data,
    items: (itemsRes.data || []).map((i) => ({ ...i, modifiers: (modifiersRes.data || []).filter((m) => m.order_item_id === i.id) })),
  };

  // Real sales tax, calculated live via Stripe Tax from the business's
  // own address (lib/billing/stripeTax.ts) — not a manually-entered
  // percentage. Works the same whether or not a printer tablet is
  // paired: the AI always quotes and records the real total, and the
  // order shows up on the dashboard with the right tax/total even if
  // it just sits at "confirmed" for the owner to ring in manually.
  const taxCents = await calculateTaxCents(business, fullOrder.subtotal_cents);
  const totalCents = fullOrder.subtotal_cents + taxCents;
  fullOrder.tax_cents = taxCents;
  fullOrder.total_cents = totalCents;
  await soft("save order tax", admin.from("orders").update({ tax_cents: taxCents, total_cents: totalCents }).eq("id", order.id));

  // Test channel: simulate a completed payment instead of touching
  // Stripe or texting a real phone number — this is the owner's own
  // preview chat, not a real order, so there's no payment to actually
  // collect and no real customer number to send anything to. Still
  // queues a real kitchen ticket if a printer's paired, so this is
  // also the easiest way to test the printer without spending anything
  // or having to actually call in. Reply keeps saying a payment link
  // was texted so the preview sounds like a real call, even though
  // nothing was actually sent.
  if (ctx.channel === "test") {
    await soft("mark order paid", admin.from("orders").update({ payment_status: "paid" }).eq("id", order.id));
    if (business.printer_app_paired_at) {
      const queued = await queuePrintJob(fullOrder, business);
      if (queued.success) {
        await soft("mark order submitted", admin.from("orders").update({ status: "submitted", submitted_at: new Date().toISOString() }).eq("id", order.id));
      } else {
        await soft("record print error", admin.from("orders").update({ submit_error: queued.error }).eq("id", order.id));
      }
    }
    return { success: true, order_id: order.id, total: totalCents / 100, payment_link_sent: true, test_mode: true };
  }

  // A genuinely free order (comped, 100%-off promo, a $0 item used to
  // test the flow) — nothing to collect, so it's placed immediately
  // with no Checkout Session and no payment link. This also covers
  // testing the printer on a real call without Stripe connected or
  // spending anything: price a menu item at $0 and call in.
  if (totalCents === 0) {
    await soft("mark order paid", admin.from("orders").update({ payment_status: "paid" }).eq("id", order.id));
    if (business.printer_app_paired_at) {
      const queued = await queuePrintJob(fullOrder, business);
      if (queued.success) {
        await soft("mark order submitted", admin.from("orders").update({ status: "submitted", submitted_at: new Date().toISOString() }).eq("id", order.id));
      } else {
        await soft("record print error", admin.from("orders").update({ submit_error: queued.error }).eq("id", order.id));
      }
    }
    const smsBody = `Order confirmed at ${business.name}! Total: $0.00. We'll have it ready for pickup soon. Msg&data rates may apply. Reply HELP for help, STOP to cancel.`;
    await smsClient.send(ctx.businessId, input.phone, smsBody);
    return { success: true, order_id: order.id, total: 0, payment_link_sent: false, free_order: true };
  }

  // Reaching here means channel === "phone" with a real, nonzero total
  // (test and free orders already returned above), where the earlier
  // check already guarantees this is set — this is just satisfying the
  // type checker, not a real runtime path.
  if (!business.stripe_connect_account_id) {
    return { success: false, reason: "This business hasn't finished setting up phone payments yet." };
  }

  // An order never goes to the kitchen on the strength of a phone call
  // alone: it sits at payment_status "awaiting_payment" until the
  // customer actually pays the texted link, and only the Connect
  // webhook (checkout.session.completed) triggers the kitchen print
  // and the "confirmed" text.
  const siteUrl = getSiteUrl();
  const checkout = await createOrderCheckoutSession({
    connectedAccountId: business.stripe_connect_account_id,
    orderId: order.id,
    businessId: ctx.businessId,
    businessName: business.name,
    totalCents,
    platformFeeBps: business.platform_fee_bps,
    customerPhone: input.phone,
    successUrl: `${siteUrl}/order-confirmation?order_id=${order.id}`,
    cancelUrl: `${siteUrl}/order-confirmation?order_id=${order.id}&cancelled=1`,
    // Stable per order — a Twilio retry of this same turn (see
    // handleTurn's dedupe check) must never create a second
    // Checkout Session, which would be a second real charge attempt.
    idempotencyKey: `order-checkout:${order.id}`,
  });

  if (!checkout.url || !checkout.sessionId) {
    // Payment couldn't even be started — do NOT tell the customer
    // their order is placed. Fall back to the honest state: the
    // order exists but is unpaid, and the AI's reply (built from
    // this tool result) should say payment couldn't be started
    // right now, not that the order is confirmed.
    return { success: false, reason: checkout.error || "Could not start payment for this order." };
  }

  await soft("save checkout session", admin
    .from("orders")
    .update({ payment_status: "awaiting_payment", stripe_checkout_session_id: checkout.sessionId })
    .eq("id", order.id));

  const paymentSmsBody = `${business.name}: your order total is $${(totalCents / 100).toFixed(2)}. Pay here to send it to the kitchen: ${checkout.url} (link expires in 30 min). Msg&data rates may apply.`;
  await smsClient.send(ctx.businessId, input.phone, paymentSmsBody);

  return { success: true, order_id: order.id, total: totalCents / 100, payment_link_sent: true };
}

async function escalate_to_human(input: { reason: string; summary: string }, ctx: ToolContext): Promise<ToolResult> {
  const admin = createAdminClient();
  await soft("record escalation", admin.from("calls").update({ outcome: "escalated", escalation_reason: input.reason }).eq("id", ctx.callId));

  // During open hours on a real phone call, ring the restaurant's main
  // phone so a person can pick up now. The escalation email is held
  // back in that case: the dial-status webhook sends it only if nobody
  // answers (if someone does, there is nothing to follow up on).
  let alreadyAttempted = false;
  if (ctx.channel === "phone") {
    const { data: prior } = await admin
      .from("call_messages")
      .select("id")
      .eq("call_id", ctx.callId)
      .eq("role", "system")
      .like("content", `${LIVE_TRANSFER_MARKER}%`)
      .limit(1);
    alreadyAttempted = (prior || []).length > 0;
  }
  const live = shouldAttemptLiveTransfer({
    channel: ctx.channel,
    restaurantPhone: ctx.context.business.phone,
    isOpen: isBusinessOpenNow(ctx.context.business, ctx.context.hours),
    alreadyAttempted,
    callerPhone: ctx.callerPhone,
  });

  if (live) {
    return {
      logged: true,
      live_transfer: true,
      message:
        "Connecting the caller to the restaurant's phone now. Say one short sentence like 'Let me get someone for you.' If nobody picks up, it will be logged for a callback automatically.",
    };
  }

  sendEscalationEmail(ctx.businessId, ctx.callId).catch((err) => console.error("Escalation email failed:", err));
  return { logged: true, message: "This has been logged for the business to follow up on." };
}

async function transfer_call(_input: unknown, _ctx: ToolContext): Promise<ToolResult> {
  return { transferring: true };
}

async function send_sms(input: { phone: string; message: string }, ctx: ToolContext): Promise<ToolResult> {
  // Unlike confirm_and_place_order's own payment/confirmation texts
  // (which are tied to a real order the customer just built and can
  // legitimately go to a number they stated, e.g. ordering for someone
  // else), this is a free-form "send any message to any number" tool
  // with no order behind it — exactly what would let a caller turn the
  // business's own paid Twilio number into an arbitrary SMS relay by
  // just asking the AI to "text this message to this other number."
  // Lock it to the verified caller on a real call; the test channel
  // has no real caller ID to lock to.
  const phone = ctx.channel === "phone" && ctx.callerPhone ? ctx.callerPhone : input.phone;
  const result = await smsClient.send(ctx.businessId, phone, input.message);
  return { sent: result.sent, reason: result.reason };
}

export const TOOL_HANDLERS: Record<string, (input: any, ctx: ToolContext) => Promise<ToolResult>> = {
  get_business_information,
  get_menu,
  lookup_customer,
  create_customer,
  add_item_to_order,
  remove_item_from_order,
  update_item_quantity,
  update_item_modifiers,
  get_current_order,
  confirm_and_place_order,
  escalate_to_human,
  transfer_call,
  send_sms,
};

export const TOOL_DEFINITIONS = [
  { name: "get_business_information", description: "Get the business's address, phone, and hours.", input_schema: { type: "object" as const, properties: {} } },
  { name: "get_menu", description: "Get the full menu with prices and add-ons/modifiers. Call this before taking an order if you need to check an item, price, or available modifiers.", input_schema: { type: "object" as const, properties: {} } },
  { name: "lookup_customer", description: "Look up an existing customer by phone number.", input_schema: { type: "object" as const, properties: { phone: { type: "string" } }, required: ["phone"] } },
  { name: "create_customer", description: "Create a new customer record.", input_schema: { type: "object" as const, properties: { name: { type: "string" }, phone: { type: "string" } }, required: ["name", "phone"] } },
  {
    name: "add_item_to_order",
    description: "Add one menu item to the order currently being built on this call. Only use items and modifiers that actually exist on the menu — never invent one. Call this once per distinct item the customer orders.",
    input_schema: {
      type: "object" as const,
      properties: {
        item_name: { type: "string", description: "Must match a real menu item name exactly." },
        quantity: { type: "number" },
        modifier_names: { type: "array", items: { type: "string" }, description: "Names of any add-ons/modifiers the customer chose, e.g. [\"Large\", \"Extra cheese\"]." },
        notes: { type: "string", description: "Free-text special request for this item, e.g. \"no onions\"." },
      },
      required: ["item_name"],
    },
  },
  { name: "remove_item_from_order", description: "Remove an item the customer changed their mind about ENTIRELY, from the order currently being built. If they just want a different amount of something still on the order, use update_item_quantity instead — don't remove and re-add just to change a number.", input_schema: { type: "object" as const, properties: { item_name: { type: "string" } }, required: ["item_name"] } },
  {
    name: "update_item_quantity",
    description: "Change how many of an item already on the order the customer wants (e.g. they said 2 but meant 1, or want to bump it to 3) — use this instead of remove_item_from_order + add_item_to_order for a quantity-only change. Setting quantity to 0 removes it.",
    input_schema: {
      type: "object" as const,
      properties: {
        item_name: { type: "string", description: "Must match the item's name on the current order exactly." },
        quantity: { type: "number", description: "The new total quantity for this item, not a delta — e.g. 1, not \"-1\"." },
      },
      required: ["item_name", "quantity"],
    },
  },
  {
    name: "update_item_modifiers",
    description: "Change the toppings/add-ons or notes on an item already on the order (e.g. the customer adds \"no onions\" a moment after already ordering the burger) — use this instead of remove_item_from_order + add_item_to_order for a modifiers/notes-only change. This REPLACES the item's full set of modifiers/notes, so pass everything that should apply, not just the new addition. Only use remove_item_from_order + add_item_to_order when the item itself is being swapped for a genuinely different item or size.",
    input_schema: {
      type: "object" as const,
      properties: {
        item_name: { type: "string", description: "Must match the item's name on the current order exactly." },
        modifier_names: { type: "array", items: { type: "string" }, description: "The item's full, final list of add-ons/modifiers — replaces whatever was there before." },
        notes: { type: "string", description: "The item's full, final free-text note, e.g. \"no onions, no pickles\". Omit or leave blank to clear it." },
      },
      required: ["item_name"],
    },
  },
  { name: "get_current_order", description: "Get the full list of items and running subtotal for the order being built on this call. Use this to read the order back to the customer before confirming.", input_schema: { type: "object" as const, properties: {} } },
  {
    name: "confirm_and_place_order",
    description: "Lock in the order. Only call this AFTER reading the full order and total back to the customer out loud and getting their explicit confirmation. For a pay-at-pickup business this actually places the order — never claim it's placed before calling this and getting success back. For a business that collects payment up front, a successful result means a payment link was texted, NOT that the order is placed yet — check the result's payment_link_sent field and respond accordingly.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_name: { type: "string" },
        phone: { type: "string" },
        special_instructions: { type: "string" },
      },
      required: ["customer_name", "phone"],
    },
  },
  { name: "escalate_to_human", description: "Hand this call to the restaurant staff. Use for refunds, complaints, requests to change or cancel an order that was ALREADY placed (it may already be cooking), and anything you can't resolve. While the restaurant is open the system rings its phone live; if closed or nobody answers it is logged for a callback.", input_schema: { type: "object" as const, properties: { reason: { type: "string" }, summary: { type: "string" } }, required: ["reason", "summary"] } },
  { name: "transfer_call", description: "Transfer the caller to a real person live, immediately. ONLY when they explicitly ask to speak to a human.", input_schema: { type: "object" as const, properties: {} } },
  { name: "send_sms", description: "Send a text message to the customer.", input_schema: { type: "object" as const, properties: { phone: { type: "string" }, message: { type: "string" } }, required: ["phone", "message"] } },
];
