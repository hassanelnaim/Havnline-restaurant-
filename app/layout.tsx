import type { Metadata } from "next";
import "./globals.css";
import { TawkToWidget } from "@/components/layout/tawk-to-widget";
import { CookieConsentBanner } from "@/components/layout/cookie-consent-banner";

export const metadata: Metadata = {
  title: "HavnLine — AI Phone Order-Taker for Restaurants",
  description: "HavnLine answers your restaurant's phone, takes real orders off your menu, and sends them to your kitchen — so you never miss a call again.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <TawkToWidget />
        <CookieConsentBanner />
      </body>
    </html>
  );
}
