// Cookie-consent state, stored in the visitor's own browser (not a
// cookie itself, just localStorage) so the banner only shows once per
// browser and every part of the app agrees on the current decision.
//
// Deliberately excludes strictly-necessary cookies (Supabase's own
// session/auth cookies, which are required for signing in and aren't
// legally something a visitor needs to opt into) — this only gates
// non-essential ones, currently just Tawk.to's live-chat widget.

export const COOKIE_CONSENT_KEY = "havnline_cookie_consent";
export const COOKIE_CONSENT_EVENT = "havnline:cookie-consent-changed";

export type CookieConsent = "accepted" | "declined";

export function getStoredCookieConsent(): CookieConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(COOKIE_CONSENT_KEY);
    return value === "accepted" || value === "declined" ? value : null;
  } catch {
    // Private browsing / blocked storage — treat as "no decision yet"
    // rather than throwing; the banner will just reappear each visit.
    return null;
  }
}

export function setStoredCookieConsent(value: CookieConsent): void {
  try {
    window.localStorage.setItem(COOKIE_CONSENT_KEY, value);
  } catch {
    // Ignore — nothing to persist to, but we still notify listeners
    // below so the rest of the page reacts for the current session.
  }
  window.dispatchEvent(new CustomEvent<CookieConsent>(COOKIE_CONSENT_EVENT, { detail: value }));
}
