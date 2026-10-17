import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  const site = getSiteUrl();
  const pages = ["", "/signup", "/login", "/review", "/terms", "/privacy", "/sms-terms", "/policies"];
  return pages.map((path) => ({ url: `${site}${path}`, changeFrequency: path === "" ? "weekly" : "monthly", priority: path === "" ? 1 : 0.4 }));
}
