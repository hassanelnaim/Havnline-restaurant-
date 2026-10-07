import { guardRoute } from "@/lib/api/routeGuard";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authenticateDevice, queueAddendumPrintJob } from "@/lib/integrations/printer-app";
import { loadPricedMenu } from "@/lib/menu/pricedMenu";
import { insertOrderItems, recomputeRealOrderTotals } from "@/lib/billing/orderItemAddition";
import type { PendingAddendumItem } from "@/lib/billing/orderItemAddition";
import { createOrderCheckoutSession } from "@/lib/billing/stripeConnect";
import { getSiteUrl } from "@/lib/env";
import { dbErrorResult } from "@/lib/errors";
import type { DbModifier, MenuItemWithModifiers } from "@/lib/database/types";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

type AddMode = "comp" | "charge";

interface SelectionInput {
  menuItemId: string;
  quantity: number;
  modifierIds: string[];
  notes: string | null;
}

type SelectionResult =
  | { success: true; menuItem: MenuItemWithModifiers; quantity: number; matchedModifiers: DbModifier[]; notes: string | null }
  | { success: false; reason: string };

/**
 * Validates a tablet's item pick against the REAL, live menu — never
 * trusts a name/price the tablet happened to have cached. Mirrors
 * add_item_to_order's required-modifier-group check in lib/ai/tools.ts,
 * matched on modifier id here (the tablet has real ids from its own
 * GET /api/printer-app/menu sync) rather than by name, since there's
 * no ambiguity to resolve the way there is parsing a phone caller's
 * words.
 */
function resolveSelection(menu: MenuItemWithModifiers[], input: SelectionInput): SelectionResult {
  const menuItem = menu.find((m) => m.id === input.menuItemId);
  if (!menuItem) return { success: false, reason: "That item isn't on the current menu." };

  const quantity = Math.max(1, Math.min(20, Math.round(input.quantity) || 1));
  const allModifiers = menuItem.modifier_groups.flatMap((g) => g.modifiers);
  const matchedModifiers = allModifiers.filter((m) => input.modifierIds.includes(m.id));

  const missingRequired = menuItem.modifier_groups.filter((g) => g.is_required && !g.modifiers.some((m) => matchedModifiers.includes(m)));
  if (missingRequired.length > 0) {
    return { success: false, reason: `"${menuItem.name}" requires a choice for: ${missingRequired.map((g) => g.name).join(", ")}.` };
  }

  return { success: true, menuItem, quantity, matchedModifiers, notes: input.notes };
}

// A resolved thing-to-add, whether it came from the real menu or was
// typed in as a one-off "Add a Special" (see resolveSpecial below) —
// the comp/charge branches further down only ever work with this
// common shape, so they don't need to know which path produced it.
interface ResolvedAddition {
  itemName: string;
  menuItemId: string | null;
  quantity: number;
  unitPriceCents: number;
  modifiers: { modifierId: string; modifierName: string; priceDeltaCents: number }[];
  notes: string | null;
  checkoutLabel: string;
}

// Sanity ceiling on a hand-typed special amount — not a real limit on
// what a restaurant could legitimately charge, just a guard against a
// fat-fingered extra zero (e.g. "500" meant as $5.00 cents-confusion)
// going out as a live QR charge before anyone notices.
const MAX_SPECIAL_AMOUNT_CENTS = 100_000; // $1,000.00

interface SpecialInput {
  name: string;
  amountCents: number;
  quantity: number;
  notes: string | null;
}

type SpecialResult = { success: true; resolved: ResolvedAddition } | { success: false; reason: string };

/**
 * "Add a Special" — charging or comping something that isn't on the
 * menu at all (a one-off catering tray, a split bill adjustment, "the
 * manager's special" nobody bothered to add as a real menu item).
 * Deliberately skips loadPricedMenu entirely; staff types the name and
 * the real amount directly rather than picking from the live menu.
 */
function resolveSpecial(input: SpecialInput): SpecialResult {
  const name = input.name.trim().slice(0, 80);
  if (!name) return { success: false, reason: "Enter a name for this special." };

  const amountCents = Math.round(input.amountCents);
  if (!Number.isFinite(amountCents) || amountCents <= 0) return { success: false, reason: "Enter an amount greater than $0." };
  if (amountCents > MAX_SPECIAL_AMOUNT_CENTS) {
    return { success: false, reason: `That's over the $${(MAX_SPECIAL_AMOUNT_CENTS / 100).toFixed(2)} limit for a special — double check the amount.` };
  }

  const quantity = Math.max(1, Math.min(20, Math.round(input.quantity) || 1));

  return {
    success: true,
    resolved: {
      itemName: name,
      menuItemId: null,
      quantity,
      unitPriceCents: amountCents,
      modifiers: [],
      notes: input.notes,
      checkoutLabel: `special — ${name}`,
    },
  };
}

/**
 * POST /api/printer-app/today-orders/[id]/items
 *
 * Phase 4 of the tablet redesign: staff adding an item to an
 * already-placed order, either COMPED (free, inserted immediately) or
 * CHARGED via a QR code the customer scans with their own phone (not
 * texted — a QR works for a walk-in too, with no phone number on file
 * for this specific charge). Device-token only, deliberately NO PIN —
 * unlike refund/discount (Phase 3), nothing already-collected is being
 * moved here: a comp never charges anyone, and a QR charge is new
 * money the customer pays themselves, not money staff pull from the
 * business.
 *
 * A successful addition prints a small "ADDITION TO ORDER" ticket
 * (buildAddendumTicketText), never a full reprint of the original
 * order — see lib/integrations/printer-app.ts.
 *
 * Comped items are inserted with unit_price_cents = 0 and every
 * modifier's price_delta_cents forced to 0, the same "zero price means
 * free" convention used everywhere else in this codebase, rather than
 * a separate "comped but has real value" concept that would complicate
 * subtotal/tax/ticket/dashboard logic for no real benefit.
 *
 * Charged items are NOT inserted here — see order_addendum_charges
 * (migration 022) and the Connect webhook's addendum_id branch. They
 * only become real order_items once Stripe actually confirms payment,
 * the same deferred-until-paid pattern confirm_and_place_order uses
 * for the original order itself.
 */
async function handlePOST(request: NextRequest, { params }: { params: { id: string } }) {
  const device = await authenticateDevice(bearerToken(request));
  if (!device) return NextResponse.json({ success: false, error: "Not paired." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const mode: AddMode = body?.mode === "charge" ? "charge" : "comp";
  const notes = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 500) : null;
  const quantity = typeof body?.quantity === "number" && Number.isFinite(body.quantity) ? body.quantity : 1;

  // Two ways to arrive at something to add: a real menu item
  // (menuItemId), or "Add a Special" — a hand-typed name + amount for
  // something that isn't on the menu at all (body.special).
  const specialInput = body?.special && typeof body.special === "object" ? body.special : null;
  const menuItemId = typeof body?.menuItemId === "string" ? body.menuItemId : null;
  if (!specialInput && !menuItemId) return NextResponse.json({ success: false, error: "Choose an item." }, { status: 400 });

  const admin = createAdminClient();

  const { data: order } = await admin.from("orders").select("id, status").eq("id", params.id).eq("business_id", device.businessId).maybeSingle();
  if (!order) return NextResponse.json({ success: false, error: "Order not found." }, { status: 404 });
  if (order.status === "cancelled" || order.status === "building") {
    return NextResponse.json({ success: false, error: "This order can no longer be added to." }, { status: 400 });
  }

  const { data: business } = await admin
    .from("businesses")
    .select("name, address_city, address_state, address_zip, printer_app_paired_at, stripe_connect_account_id, stripe_connect_charges_enabled, platform_fee_bps")
    .eq("id", device.businessId)
    .single();
  if (!business) return NextResponse.json({ success: false, error: "Business not found." }, { status: 404 });

  let resolved: ResolvedAddition;
  if (specialInput) {
    const specialResult = resolveSpecial({
      name: typeof specialInput.name === "string" ? specialInput.name : "",
      amountCents: typeof specialInput.amountCents === "number" ? specialInput.amountCents : NaN,
      quantity,
      notes,
    });
    if (!specialResult.success) return NextResponse.json({ success: false, error: specialResult.reason }, { status: 400 });
    resolved = specialResult.resolved;
  } else {
    const modifierIds: string[] = Array.isArray(body?.modifierIds) ? body.modifierIds.filter((x: unknown): x is string => typeof x === "string") : [];
    const { menu } = await loadPricedMenu(device.businessId);
    const selectionResult = resolveSelection(menu, { menuItemId: menuItemId as string, quantity, modifierIds, notes });
    if (!selectionResult.success) return NextResponse.json({ success: false, error: selectionResult.reason }, { status: 400 });

    const { menuItem, quantity: qty, matchedModifiers, notes: cleanNotes } = selectionResult;
    // menuItem.price_cents is already the REAL, current price —
    // loadPricedMenu resolves time-based specials (the menu kind, not
    // the Add-a-Special kind) the same way add_item_to_order does for
    // a phone order.
    const realModifiers = matchedModifiers.map((m) => ({ modifierId: m.id, modifierName: m.name, priceDeltaCents: m.price_delta_cents }));
    resolved = {
      itemName: menuItem.name,
      menuItemId: menuItem.id,
      quantity: qty,
      unitPriceCents: menuItem.price_cents,
      modifiers: realModifiers,
      notes: cleanNotes,
      checkoutLabel: `added item (${menuItem.name})`,
    };
  }

  const realAmountCents = (resolved.unitPriceCents + resolved.modifiers.reduce((sum, m) => sum + m.priceDeltaCents, 0)) * resolved.quantity;

  // A $0 item (or a "charge" on something that's actually free) has
  // nothing to collect — Stripe refuses a $0 Checkout Session anyway —
  // so fall back to the comp path rather than erroring.
  const effectiveMode: AddMode = mode === "charge" && realAmountCents > 0 ? "charge" : "comp";

  if (effectiveMode === "comp") {
    const pendingItem: PendingAddendumItem = {
      menuItemId: resolved.menuItemId,
      itemName: resolved.itemName,
      unitPriceCents: 0,
      quantity: resolved.quantity,
      notes: resolved.notes,
      modifiers: resolved.modifiers.map((m) => ({ ...m, priceDeltaCents: 0 })),
    };

    const inserted = await insertOrderItems(order.id, [pendingItem]);
    if (!inserted.success) return NextResponse.json({ success: false, error: inserted.error || "Could not add item." }, { status: 500 });

    await recomputeRealOrderTotals(order.id, business);

    if (business.printer_app_paired_at) {
      await queueAddendumPrintJob(
        device.businessId,
        order.id,
        business,
        [{ item_name: pendingItem.itemName, quantity: pendingItem.quantity, notes: pendingItem.notes, modifiers: pendingItem.modifiers.map((m) => ({ modifier_name: m.modifierName })) }],
        0,
        false
      );
    }

    return NextResponse.json({ success: true, mode: "comp", item: resolved.itemName, quantity: resolved.quantity });
  }

  // Charge path — require Stripe Connect configured, same gate
  // confirm_and_place_order uses for the original order.
  if (!business.stripe_connect_account_id || !business.stripe_connect_charges_enabled) {
    return NextResponse.json({ success: false, error: "Payments aren't set up for this business yet." }, { status: 400 });
  }

  const pendingItem: PendingAddendumItem = {
    menuItemId: resolved.menuItemId,
    itemName: resolved.itemName,
    unitPriceCents: resolved.unitPriceCents,
    quantity: resolved.quantity,
    notes: resolved.notes,
    modifiers: resolved.modifiers,
  };

  const { data: addendum, error: addendumError } = await admin
    .from("order_addendum_charges")
    .insert({
      business_id: device.businessId,
      order_id: order.id,
      device_id: device.deviceId,
      status: "awaiting_payment",
      items: [pendingItem],
      amount_cents: realAmountCents,
    })
    .select("id")
    .single();

  if (addendumError || !addendum) {
    return NextResponse.json(dbErrorResult(addendumError, "printer-app/today-orders/[id]/items POST", "Could not start the charge."), { status: 500 });
  }

  const siteUrl = getSiteUrl();
  const checkout = await createOrderCheckoutSession({
    connectedAccountId: business.stripe_connect_account_id,
    orderId: order.id,
    businessId: device.businessId,
    businessName: business.name,
    totalCents: realAmountCents,
    platformFeeBps: business.platform_fee_bps,
    productName: `${business.name} — ${resolved.checkoutLabel}`,
    successUrl: `${siteUrl}/order-addendum-confirmation?addendum_id=${addendum.id}`,
    cancelUrl: `${siteUrl}/order-addendum-confirmation?addendum_id=${addendum.id}&cancelled=1`,
    // Unique per charge attempt (each addendum row is its own attempt)
    // — a retried items POST creates a fresh addendum + QR rather than
    // risk reusing a stale, possibly-already-scanned one.
    idempotencyKey: `addendum-checkout:${addendum.id}`,
    extraMetadata: { addendum_id: addendum.id },
  });

  if (!checkout.url || !checkout.sessionId) {
    // Nothing was ever charged and nothing real was added to the order
    // — safe to just delete the pending row rather than leave a
    // permanently-dead "awaiting_payment" addendum behind.
    await admin.from("order_addendum_charges").delete().eq("id", addendum.id);
    return NextResponse.json({ success: false, error: checkout.error || "Could not start payment for this item." }, { status: 500 });
  }

  await admin.from("order_addendum_charges").update({ stripe_checkout_session_id: checkout.sessionId }).eq("id", addendum.id);

  const qrDataUrl = await QRCode.toDataURL(checkout.url, { margin: 1, width: 400 });

  return NextResponse.json({
    success: true,
    mode: "charge",
    addendumId: addendum.id,
    amountCents: realAmountCents,
    qrDataUrl,
    checkoutUrl: checkout.url,
  });
}

export const POST = guardRoute("printer-app/today-orders/[id]/items POST", handlePOST);
