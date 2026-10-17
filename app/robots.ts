import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/env";

// Public marketing pages may be indexed; the app itself and its APIs may not.
export default function robots(): MetadataRoute.Robots {
  const site = getSiteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/admin", "/api", "/onboarding", "/order-confirmation", "/order-addendum-confirmation"] }],
    sitemap: `${site}/sitemap.xml`,
  };
}
