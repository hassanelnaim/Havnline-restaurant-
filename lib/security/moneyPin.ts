import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbErrorResult } from "@/lib/errors";

/**
 * The shared 4-digit PIN a business's staff enters on the paired
 * tablet before any money-moving action (refund, discount — see the
 * printer-app tablet-redesign plan). One PIN per business, set or
 * changed from Dashboard -> Settings; never required to touch item
 * edits (comping, adding items), only actual money movement.
 *
 * Stored hashed+salted in business_money_pins (migration 020), a
 * table the dashboard's own client components never read from — see
 * that migration's comment for why this couldn't just live as columns
 * on businesses. Hashing a 4-digit PIN doesn't make it hard to guess
 * offline (only 10,000 possibilities either way) — what it buys is
 * that a database dump alone doesn't hand over the PIN in the clear.
 * The real protection against guessing is online: verifyMoneyPin is
 * only ever called from a rate-limited endpoint (see
 * app/api/printer-app/verify-pin/route.ts).
 */

const SCRYPT_KEYLEN = 32;
const PIN_PATTERN = /^\d{4}$/;

function hashPin(pin: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, SCRYPT_KEYLEN).toString("hex");
  return { hash, salt };
}

function pinMatches(pin: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(pin, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  // timingSafeEqual throws on mismatched lengths rather than
  // returning false, and a corrupt/foreign-format stored hash should
  // never crash the request — treat that as "doesn't match."
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export interface SetMoneyPinResult {
  success: boolean;
  error?: string;
}

/** Called from the dashboard (an already-authenticated owner session) to set or change the PIN. No "current PIN" is required — logging into the dashboard already grants full control over this business. */
export async function setMoneyPin(businessId: string, pin: string): Promise<SetMoneyPinResult> {
  if (!PIN_PATTERN.test(pin)) return { success: false, error: "PIN must be exactly 4 digits." };

  const admin = createAdminClient();
  const { hash, salt } = hashPin(pin);
  const now = new Date().toISOString();

  const { error } = await admin
    .from("business_money_pins")
    .upsert({ business_id: businessId, pin_hash: hash, pin_salt: salt, set_at: now, updated_at: now }, { onConflict: "business_id" });
  if (error) return dbErrorResult(error, "setMoneyPin", "Could not save that PIN.");

  return { success: true };
}

/** For the Settings page to show "PIN is set" vs "No PIN set yet" without ever reading the hash itself. */
export async function hasMoneyPinSet(businessId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("business_money_pins").select("business_id").eq("business_id", businessId).maybeSingle();
  return !!data;
}

export interface VerifyMoneyPinResult {
  valid: boolean;
  reason?: string;
}

/** Called only from the rate-limited verify-pin API route — never from the dashboard. */
export async function verifyMoneyPin(businessId: string, pin: string): Promise<VerifyMoneyPinResult> {
  if (!PIN_PATTERN.test(pin)) return { valid: false, reason: "Enter the 4-digit PIN." };

  const admin = createAdminClient();
  const { data } = await admin.from("business_money_pins").select("pin_hash, pin_salt").eq("business_id", businessId).maybeSingle();
  if (!data) return { valid: false, reason: "No PIN has been set up for this business yet — set one from the dashboard under Settings." };

  return pinMatches(pin, data.pin_hash, data.pin_salt) ? { valid: true } : { valid: false, reason: "Incorrect PIN." };
}
