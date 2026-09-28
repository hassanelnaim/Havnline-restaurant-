import { createAdminClient } from "@/lib/supabase/admin";
import { smsClient } from "@/lib/integrations/sms";
import { sendEscalationEmail } from "@/lib/notifications/escalation-email";
import { queuePrintJob } from "@/lib/integrations/printer-app";
import { createOrderCheckoutSession } from "@/lib/billing/stripeConnect";
import { getSiteUrl } from "@/lib/env";
import type { BusinessContext } from "./context";
import type { OrderWithItems } from "@/lib/database/types";

export interface ToolContext {
  businessId: string;
  callId: string;
  channel: "test" | "phone";
  context: BusinessContext;
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
    menu: ctx.context.menu.map((item) => ({
      name: item.name,
      price: item.price_cents / 100,
      description: item.description,
      modifier_groups: item.modifier_groups.map((g) => ({
        name: g.name,
        required: g.is_required,
        min_select: g.min_select,
        max_select: g.max_select,
        options: g.modifiers.map((m) => ({ name: m.name, price_delta: m.price_delta_cents / 100 })),
      })),
    })),
  };
}

async function lookup_customer(input: { phone: string }, ctx: ToolContext): Promise<ToolResult> {
  const admin = createAdminClient();
  const { data } = await admin.from("customers").select("*").eq("business_id", ctx.businessId).eq("phone", input.phone).maybeSingle();
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

  if (error || !created) throw new Error(error?.message || "Could not start an order.");
  return created.id;
}

async function recomputeOrderSubtotal(orderId: string): Promise<number> {
  const admin = createAdminClient();
  const { data: items } = await admin.from("order_items").select("id, unit_price_cents, quantity").eq("order_id", orderId);
  let subtotal = 0;
  for (const item of items || []) {
    const { data: mods } = await admin.from("order_item_modifiers").select("price_delta_cents").eq("order_item_id", item.id);
    const modTotal = (mods || []).reduce((sum, m) => sum + m.price_delta_cents, 0);
    subtotal += (item.unit_price_cents + modTotal) * item.quantity;
  }
  await admin.from("orders").update({ subtotal_cents: subtotal, total_cents: subtotal }).eq("id", orderId);
  return subtotal;
}

async function add_item_to_order(
  input: { item_name: string; quantity?: number; modifier_names?: string[]; notes?: string },
  ctx: ToolContext
): Promise<ToolResult> {
  const admin = createAdminClient();

  // Never invent a menu item or its price — only match against the real
  // menu loaded for this business.
  const menuItem = ctx.context.menu.find((m) => m.name.toLowerCase() === input.item_name.toLowerCase());
  if (!menuItem) {
    return { success: false, reason: `"${input.item_name}" isn't on the menu. Only offer items from get_menu.` };
  }

  const quantity = Math.max(1, input.quantity || 1);
  const requestedModifierNames = (input.modifier_names || []).map((n) => n.toLowerCase());
  const allModifiers = menuItem.modifier_groups.flatMap((g) => g.modifiers);
  const matchedModifiers = allModifiers.filter((m) => requestedModifierNames.includes(m.name.toLowerCase()));

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

  const { data: orderItem, error } = await admin
    .from("order_items")
    .insert({
      order_id: orderId,
      menu_item_id: menuItem.id,
      item_name: menuItem.name,
      unit_price_cents: menuItem.price_cents,
      quantity,
      notes: input.notes || null,
    })
    .select("id")
    .single();

  if (error || !orderItem) return { success: false, reason: error?.message || "Could not add item." };

  if (matchedModifiers.length > 0) {
    await admin.from("order_item_modifiers").insert(
      matchedModifiers.map((m) => ({
        order_item_id: orderItem.id,
        modifier_id: m.id,
        modifier_name: m.name,
        price_delta_cents: m.price_delta_cents,
      }))
    );
  }

  const subtotal = await recomputeOrderSubtotal(orderId);

  return {
    success: true,
    added: { item: menuItem.name, quantity, modifiers: matchedModifiers.map((m) => m.name) },
    running_subtotal: subtotal / 100,
  };
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

  await admin.from("order_items").delete().eq("id", matches[0].id);
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

  const { data: order } = await admin.from("orders").select("*").eq("call_id", ctx.callId).eq("status", "building").maybeSingle();
  if (!order) return { success: false, reason: "No order to confirm — add items first." };

  const { data: orderItems } = await admin.from("order_items").select("id").eq("order_id", order.id);
  if (!orderItems || orderItems.length === 0) return { success: false, reason: "The order is empty — add at least one item first." };

  const { data: existingCustomer } = await admin.from("customers").select("id").eq("business_id", ctx.businessId).eq("phone", input.phone).maybeSingle();
  let customerId = existingCustomer?.id;
  if (!customerId) {
    const { data: newCustomer } = await admin.from("customers").insert({ business_id: ctx.businessId, name: input.customer_name, phone: input.phone }).select().single();
    customerId = newCustomer?.id;
  }

  await admin
    .from("orders")
    .update({
      status: "confirmed",
      customer_id: customerId,
      customer_name: input.customer_name,
      phone: input.phone,
      special_instructions: input.special_instructions || null,
    })
    .eq("id", order.id);

  await admin.from("calls").update({ outcome: "order_placed" }).eq("id", ctx.callId);

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

  // Tax rate lives on the business (basis points — see Settings), so
  // this works the same whether or not a printer tablet is paired: the
  // AI always quotes and records the real total, and the order shows
  // up on the dashboard with the right tax/total even if it just sits
  // at "confirmed" for the owner to ring in manually.
  const taxRateBps = ctx.context.business.tax_rate_bps || 0;
  const taxCents = Math.round((fullOrder.subtotal_cents * taxRateBps) / 10000);
  const totalCents = fullOrder.subtotal_cents + taxCents;
  fullOrder.tax_cents = taxCents;
  fullOrder.total_cents = totalCents;
  await admin.from("orders").update({ tax_cents: taxCents, total_cents: totalCents }).eq("id", order.id);

  // Phone payments (Stripe Connect): if this business has opted in AND
  // is actually ready to accept charges, the order does NOT go to the
  // kitchen yet — it waits at payment_status "awaiting_payment" until
  // the customer actually pays the texted link. The Connect webhook
  // (checkout.session.completed) is what triggers the kitchen print
  // and the "confirmed" text below. This is deliberate: printing a
  // ticket for food nobody's paid for yet wastes real food the moment
  // a customer never completes checkout.
  const business = ctx.context.business;
  if (business.phone_payments_enabled && business.stripe_connect_charges_enabled && business.stripe_connect_account_id) {
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

    await admin
      .from("orders")
      .update({ payment_status: "awaiting_payment", stripe_checkout_session_id: checkout.sessionId })
      .eq("id", order.id);

    const paymentSmsBody = `${business.name}: your order total is $${(totalCents / 100).toFixed(2)}. Pay here to send it to the kitchen: ${checkout.url} (link expires in 30 min). Msg&data rates may apply.`;
    await smsClient.send(ctx.businessId, input.phone, paymentSmsBody);

    return { success: true, order_id: order.id, total: totalCents / 100, payment_link_sent: true };
  }

  if (business.printer_app_paired_at) {
    const queued = await queuePrintJob(fullOrder, business);
    if (queued.success) {
      await admin.from("orders").update({ status: "submitted", submitted_at: new Date().toISOString() }).eq("id", order.id);
    } else {
      await admin.from("orders").update({ submit_error: queued.error }).eq("id", order.id);
    }
  }

  const smsBody = `Order confirmed at ${business.name}! Total: $${(totalCents / 100).toFixed(2)}. We'll have it ready for pickup soon. Msg&data rates may apply. Reply HELP for help, STOP to cancel.`;
  await smsClient.send(ctx.businessId, input.phone, smsBody);

  return { success: true, order_id: order.id, total: totalCents / 100 };
}

async function escalate_to_human(input: { reason: string; summary: string }, ctx: ToolContext): Promise<ToolResult> {
  const admin = createAdminClient();
  await admin.from("calls").update({ outcome: "escalated", escalation_reason: input.reason }).eq("id", ctx.callId);

  sendEscalationEmail(ctx.businessId, ctx.callId).catch((err) => console.error("Escalation email failed:", err));

  return { logged: true, message: "This has been logged for the business to follow up on." };
}

async function transfer_call(_input: unknown, _ctx: ToolContext): Promise<ToolResult> {
  return { transferring: true };
}

async function send_sms(input: { phone: string; message: string }, ctx: ToolContext): Promise<ToolResult> {
  const result = await smsClient.send(ctx.businessId, input.phone, input.message);
  return { sent: result.sent, reason: result.reason };
}

export const TOOL_HANDLERS: Record<string, (input: any, ctx: ToolContext) => Promise<ToolResult>> = {
  get_business_information,
  get_menu,
  lookup_customer,
  create_customer,
  add_item_to_order,
  remove_item_from_order,
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
  { name: "remove_item_from_order", description: "Remove an item the customer changed their mind about, from the order currently being built.", input_schema: { type: "object" as const, properties: { item_name: { type: "string" } }, required: ["item_name"] } },
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
  { name: "escalate_to_human", description: "Log this call for the business owner to follow up on later — like a voicemail. Use for refunds, complaints, requests to change or cancel an order that was ALREADY placed (it may already be cooking), and anything you can't resolve. Does NOT require anyone to be available now.", input_schema: { type: "object" as const, properties: { reason: { type: "string" }, summary: { type: "string" } }, required: ["reason", "summary"] } },
  { name: "transfer_call", description: "Transfer the caller to a real person live, immediately. ONLY when they explicitly ask to speak to a human.", input_schema: { type: "object" as const, properties: {} } },
  { name: "send_sms", description: "Send a text message to the customer.", input_schema: { type: "object" as const, properties: { phone: { type: "string" }, message: { type: "string" } }, required: ["phone", "message"] } },
];
