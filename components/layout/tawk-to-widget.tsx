"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { COOKIE_CONSENT_EVENT, getStoredCookieConsent, type CookieConsent } from "@/lib/cookies";

/**
 * Live-chat help bubble (bottom-right corner) powered by Tawk.to — free,
 * no backend needed on our side. Renders nothing until both env vars are
 * set, so this is safe to ship before the Tawk.to account exists yet.
 *
 * Also renders nothing until the visitor has accepted cookies — Tawk.to
 * sets its own cookies to run live chat, so loading it before consent
 * would defeat the point of asking. If they accept mid-session (without
 * a page reload), this picks that up live via the consent-changed event
 * instead of requiring a refresh.
 *
 * Setup (one-time, in the Tawk.to dashboard, then Vercel):
 *   1. Sign up free at https://www.tawk.to (no credit card).
 *   2. Create a Property for havnline-restaurant.vercel.app.
 *   3. Admin -> Chat Widget -> your widget -> "..." -> the embed snippet
 *      Tawk gives you is a <script> whose src looks like:
 *        https://embed.tawk.to/<PROPERTY_ID>/<WIDGET_ID>
 *      Copy those two IDs out of that URL.
 *   4. In Vercel -> Settings -> Environment Variables, add:
 *        NEXT_PUBLIC_TAWK_PROPERTY_ID = <PROPERTY_ID>
 *        NEXT_PUBLIC_TAWK_WIDGET_ID   = <WIDGET_ID>
 *   5. Redeploy. The chat bubble appears on every page (marketing site
 *      and dashboard both) once a visitor accepts cookies, and incoming
 *      chats show up in the Tawk.to app/website — reply from your phone
 *      or desktop, live or later.
 *
 * As more integrations beyond SpotOn get added, this is the one place
 * a customer goes for help regardless of which system is giving them
 * trouble — no code changes needed per integration.
 */
export function TawkToWidget() {
  const propertyId = process.env.NEXT_PUBLIC_TAWK_PROPERTY_ID;
  const widgetId = process.env.NEXT_PUBLIC_TAWK_WIDGET_ID;
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    setConsented(getStoredCookieConsent() === "accepted");

    function handleChange(e: Event) {
      setConsented((e as CustomEvent<CookieConsent>).detail === "accepted");
    }
    window.addEventListener(COOKIE_CONSENT_EVENT, handleChange);
    return () => window.removeEventListener(COOKIE_CONSENT_EVENT, handleChange);
  }, []);

  if (!propertyId || !widgetId || !consented) return null;

  return (
    <Script
      id="tawkto-widget"
      strategy="afterInteractive"
      src={`https://embed.tawk.to/${propertyId}/${widgetId}`}
      crossOrigin="anonymous"
    />
  );
}
