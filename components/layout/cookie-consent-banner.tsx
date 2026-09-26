"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getStoredCookieConsent, setStoredCookieConsent } from "@/lib/cookies";

/**
 * Bottom-of-page cookie consent banner. Shows once per browser (until
 * a decision is stored), then never again on that device. "Decline"
 * is a real choice, not decorative — declining keeps the live-chat
 * widget (Tawk.to, which sets its own cookies) turned off; only
 * "Accept" turns it on. Signing in still works either way, since the
 * session cookie that requires is strictly necessary and isn't gated
 * behind this.
 */
export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(getStoredCookieConsent() === null);
  }, []);

  if (!visible) return null;

  function decide(value: "accepted" | "declined") {
    setStoredCookieConsent(value);
    setVisible(false);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card px-4 py-4 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-relaxed text-text">
          We use cookies to keep you signed in, and — only if you accept — to power live chat support. See our{" "}
          <Link href="/privacy" className="font-medium text-brand hover:underline">Privacy Policy</Link> for details.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => decide("declined")}>Decline</Button>
          <Button variant="brand" size="sm" onClick={() => decide("accepted")}>Accept</Button>
        </div>
      </div>
    </div>
  );
}
