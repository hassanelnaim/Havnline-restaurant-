import type { Metadata } from "next";
import "./globals.css";
import { TawkToWidget } from "@/components/layout/tawk-to-widget";
import { CookieConsentBanner } from "@/components/layout/cookie-consent-banner";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.havnline.com").replace(/\/+$/, "");
const TITLE = "HavnLine — AI Phone Order-Taker for Restaurants";
const DESCRIPTION =
  "HavnLine answers your restaurant's phone, takes real orders off your menu, and sends them to your kitchen — so your staff never has to stop for the phone. 7 days free.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · HavnLine" },
  description: DESCRIPTION,
  applicationName: "HavnLine",
  keywords: ["AI phone ordering", "restaurant phone answering", "AI receptionist for restaurants", "phone order taking", "restaurant phone orders", "HavnLine"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "HavnLine",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  robots: { index: true, follow: true },
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
