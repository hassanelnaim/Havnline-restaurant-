/**
 * Checks on a new sign-up that catch the bot pattern seen in October 2026:
 * accounts with random names ("Hfvljne") and Gmail addresses broken up
 * with dots ("bi.yeh.e.c.o.30.5@gmail.com"). Gmail ignores dots and
 * anything after a "+", so one inbox has thousands of spellings; bots use
 * them to get past "one account per email" and to flood a real person's
 * inbox with our verification emails, which gets HavnLine's emails marked
 * as spam.
 */

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** The one address every spelling of a Gmail inbox delivers to. Other providers are only lowercased. */
export function canonicalEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (!GMAIL_DOMAINS.has(domain)) return e;
  local = local.split("+")[0].replace(/\./g, "");
  return `${local}@gmail.com`;
}

/** A reason to refuse the address, or null. Kept narrow so real people aren't turned away. */
export function emailProblem(email: string): string | null {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return "Enter a valid email address.";
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (GMAIL_DOMAINS.has(domain)) {
    const dots = (local.split("+")[0].match(/\./g) || []).length;
    // Real Gmail addresses rarely have more than two ("first.m.last").
    if (dots >= 3) return "Please enter your Gmail address without the extra dots (Gmail ignores them, so it's the same inbox).";
  }
  return null;
}

/** The hidden field real people never see or fill. */
export const HONEYPOT_FIELD = "company_website";

export function honeypotTripped(formData: FormData): boolean {
  return String(formData.get(HONEYPOT_FIELD) || "").trim().length > 0;
}
