import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DbBusiness, OrderWithItems } from "@/lib/database/types";

/**
 * HavnLine Printer App integration.
 *
 * A tablet running the HavnLine Printer
 * app pairs with a business once, then polls a small API for
 * confirmed orders and prints them directly on the restaurant's own
 * kitchen printer over the local network. HavnLine's backend never
 * talks to the printer itself — only ever to the paired app, which
 * owns the actual print connection. See:
 *   - app/api/printer-app/pair        (code -> device_token exchange)
 *   - app/api/printer-app/printer-ip  (app reports the printer's IP)
 *   - app/api/printer-app/orders      (poll for pending print jobs)
 *   - app/api/printer-app/orders/[id] (app acks printed/failed)
 */

const PAIRING_CODE_TTL_MINUTES = 15;

function randomCode(length = 6): string {
  // Digits only — easiest thing to read off a screen and type on a
  // tablet's on-screen keyboard, and avoids ambiguous letters (0/O, 1/I)
  // a 6-char alphanumeric code would risk.
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => (b % 10).toString()).join("");
}

function randomToken(): string {
  return randomBytes(32).toString("hex");
}

export interface PairingCodeResult {
  code: string;
  expiresAt: string;
}

/**
 * Generates a new pairing code for the Integrations dashboard to show
 * the owner. Clears out this business's older, unclaimed codes first
 * so the dashboard never displays one that's technically still valid
 * but already superseded.
 */
export async function generatePairingCode(businessId: string): Promise<PairingCodeResult> {
  const admin = createAdminClient();
  const code = randomCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60_000).toISOString();

  await admin.from("printer_pairing_codes").delete().eq("business_id", businessId).is("claimed_at", null);

  const { error } = await admin.from("printer_pairing_codes").insert({ business_id: businessId, code, expires_at: expiresAt });
  if (error) throw new Error(error.message);

  return { code, expiresAt };
}

export interface ClaimPairingCodeResult {
  success: boolean;
  deviceToken?: string;
  businessName?: string;
  error?: string;
}

/**
 * Exchanges a pairing code (typed into the tablet app) for a
 * permanent device_token. Re-pairing replaces any existing device for
 * this business rather than erroring — the only real reason to pair
 * again is a factory-reset or replaced tablet, and the old token
 * should stop working the moment a new one is issued.
 */
export async function claimPairingCode(code: string): Promise<ClaimPairingCodeResult> {
  const admin = createAdminClient();
  const { data: pairing } = await admin
    .from("printer_pairing_codes")
    .select("*")
    .eq("code", code.trim())
    .is("claimed_at", null)
    .maybeSingle();

  if (!pairing) return { success: false, error: "That code is invalid or has already been used." };
  if (new Date(pairing.expires_at).getTime() < Date.now()) {
    return { success: false, error: "That code has expired — generate a new one from the dashboard." };
  }

  const deviceToken = randomToken();

  const { error: upsertError } = await admin
    .from("printer_devices")
    .upsert(
      { business_id: pairing.business_id, device_token: deviceToken, paired_at: new Date().toISOString(), last_seen_at: null },
      { onConflict: "business_id" }
    );
  if (upsertError) return { success: false, error: upsertError.message };

  await admin.from("printer_pairing_codes").update({ claimed_at: new Date().toISOString() }).eq("id", pairing.id);
  await admin.from("businesses").update({ printer_app_paired_at: new Date().toISOString() }).eq("id", pairing.business_id);

  const { data: business } = await admin.from("businesses").select("name").eq("id", pairing.business_id).single();

  return { success: true, deviceToken, businessName: business?.name };
}

export interface AuthenticatedDevice {
  businessId: string;
  deviceId: string;
}

/**
 * Verifies a device_token sent by the tablet app on every request and
 * bumps last_seen_at, so the dashboard can show whether a paired
 * device is actually still checking in (versus paired once, long
 * dead) without a separate heartbeat endpoint.
 */
export async function authenticateDevice(deviceToken: string | null | undefined): Promise<AuthenticatedDevice | null> {
  if (!deviceToken) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("printer_devices").select("id, business_id").eq("device_token", deviceToken).maybeSingle();
  if (!data) return null;
  await admin.from("printer_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return { businessId: data.business_id, deviceId: data.id };
}

export async function setPrinterIp(businessId: string, printerIp: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("printer_devices").update({ printer_ip: printerIp.trim() }).eq("business_id", businessId);
}

export async function unpairDevice(businessId: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("printer_devices").delete().eq("business_id", businessId);
  await admin.from("businesses").update({ printer_app_paired_at: null }).eq("id", businessId);
}

/**
 * Formats a confirmed order into the exact plain-text ticket a
 * kitchen printer should print. The tablet app prints this text
 * as-is; it carries no menu knowledge or formatting logic of its own.
 */
export function buildTicketText(order: OrderWithItems, business: Pick<DbBusiness, "name">): string {
  const lines: string[] = [];
  lines.push(business.name.toUpperCase());
  lines.push(`ORDER #${order.id.slice(0, 8).toUpperCase()}`);
  lines.push(order.fulfillment_type.toUpperCase());
  lines.push("--------------------------------");
  for (const item of order.items) {
    lines.push(`${item.quantity}x ${item.item_name}`);
    for (const mod of item.modifiers) {
      lines.push(`   + ${mod.modifier_name}`);
    }
    if (item.notes) lines.push(`   note: ${item.notes}`);
  }
  lines.push("--------------------------------");
  lines.push(`Subtotal: $${(order.subtotal_cents / 100).toFixed(2)}`);
  if (order.tax_cents > 0) lines.push(`Tax: $${(order.tax_cents / 100).toFixed(2)}`);
  lines.push(`Total: $${(order.total_cents / 100).toFixed(2)}`);
  if (order.customer_name) lines.push(`Customer: ${order.customer_name}`);
  if (order.phone) lines.push(`Phone: ${order.phone}`);
  if (order.special_instructions) lines.push(`Notes: ${order.special_instructions}`);
  return lines.join("\n");
}

export interface QueuePrintJobResult {
  success: boolean;
  error?: string;
}

/**
 * Queues a confirmed order for the paired tablet to pick up on its
 * next poll. Called from confirm_and_place_order in lib/ai/tools.ts
 * whenever a business has a paired printer tablet.
 */
export async function queuePrintJob(order: OrderWithItems, business: Pick<DbBusiness, "name">): Promise<QueuePrintJobResult> {
  const admin = createAdminClient();
  const ticketText = buildTicketText(order, business);
  const { error } = await admin
    .from("printer_print_jobs")
    .insert({ business_id: order.business_id, order_id: order.id, ticket_text: ticketText });
  if (error) return { success: false, error: error.message };
  return { success: true };
}
