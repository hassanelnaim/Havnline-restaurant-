import { randomBytes } from "crypto";
import { getSiteUrl } from "@/lib/env";

/**
 * HavnLine's own payment page (app/pay/[token]): the link texted to a
 * caller, or shown as a QR code on the kitchen tablet. It replaced Stripe
 * Checkout so customers aren't asked for an email.
 *
 * The token is the only thing in the link: 24 random characters, so one
 * customer's link can't be guessed from another's. Card details never
 * touch HavnLine: they go from Stripe's card form straight to Stripe.
 */

/** How long a payment link works. The texts and the AI say 30 minutes. */
export const PAY_LINK_MINUTES = 30;

export function newPayToken(): string {
  return randomBytes(18).toString("base64url");
}

export function payUrl(token: string): string {
  return `${getSiteUrl()}/pay/${token}`;
}

export function payLinkExpiry(from = Date.now()): string {
  return new Date(from + PAY_LINK_MINUTES * 60 * 1000).toISOString();
}

/** Tokens are 24 URL-safe characters; anything else is refused before touching the database. */
export function looksLikePayToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{24}$/.test(token);
}
