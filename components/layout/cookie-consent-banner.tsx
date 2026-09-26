"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getStoredCookieConsent, setStoredCookieConsent } from "@/lib/cookies";

/**
 * Full-screen cookie consent modal — a dimmed backdrop over the entire
 * page with a centered card, not a slim bar someone can miss or scroll
 * past. Deliberately has no "X", no backdrop-click-to-dismiss, and no
 * Escape-to-close: cookie consent is a real legal choice, so this stays
 * up until the visitor actually picks Accept or Decline, not until they
 * find some way to make it go away without deciding. Shows once per
 * browser (until a decision is stored), then never again on that
 * device. "Decline" is a real choice, not decorative — declining keeps
 * the live-chat widget (Tawk.to, which sets its own cookies) turned
 * off; only "Accept" turns it on. Signing in still works either way,
 * since the session cookie that requires is strictly necessary and
 * isn't gated behind this.
 */
export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(getStoredCookieConsent() === null);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [visible]);

  if (!visible) return null;

  function decide(value: "accepted" | "declined") {
    setStoredCookieConsent(value);
    setVisible(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-labelledby="cookie-consent-title">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-popover">
        <h2 id="cookie-consent-title" className="font-display text-[18px] font-semibold text-ink">We use cookies</h2>
        <p className="mt-2.5 text-[14px] leading-relaxed text-text">
          We use a strictly necessary cookie to keep you signed in. If you accept below, we'll also turn on live chat support (Tawk.to), which sets its own cookies — if you decline, live chat stays off and nothing extra is set. See our{" "}
          <Link href="/privacy" className="font-medium text-brand hover:underline">Privacy Policy</Link> for details.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => decide("declined")}>Decline</Button>
          <Button variant="brand" onClick={() => decide("accepted")}>Accept</Button>
        </div>
      </div>
    </div>
  );
}
