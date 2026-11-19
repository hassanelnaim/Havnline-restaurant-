import { createRequire } from "node:module";
import { APP, one } from "./lib.mjs";
import { newBrowserPage, logIn } from "./journey.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const b = await chromium.launch(); const page = await newBrowserPage(b, "links");
const seen = new Set(), bad = [], queue = ["/", "/login", "/signup", "/terms", "/privacy", "/policies", "/sms-terms", "/review", "/forgot-password"];
async function crawl(limit) {
  while (queue.length && seen.size < limit) {
    const p = queue.shift(); if (seen.has(p)) continue; seen.add(p);
    const r = await page.goto(APP + p).catch(() => null);
    await page.waitForLoadState("networkidle").catch(() => {});
    if (!r || r.status() >= 400) { bad.push(`${p} -> ${r?.status()}`); continue; }
    const links = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
    for (const l of links) {
      if (!l || l.startsWith("#") || l.startsWith("mailto:") || l.startsWith("tel:") || l.startsWith("sms:")) continue;
      if (/^https?:/.test(l)) { if (!l.startsWith(APP)) { externals.add(l); continue; } }
      const path = l.replace(APP, "").split("#")[0];
      if (!seen.has(path) && !path.startsWith("/api/") && !path.startsWith("/auth/")) queue.push(path);
    }
  }
}
const externals = new Set();
await crawl(60);
const u = await one("select u.email from auth.users u join business_members m on m.user_id=u.id where u.email like 'load0%' or u.email like 'owner+%' order by u.created_at desc limit 1");
await logIn(page, u.email);
queue.push("/dashboard"); await crawl(140);
console.log("pages crawled:", seen.size); console.log("broken:", bad); console.log("external links:", [...externals].sort());
console.log(page._problems.slice(0, 10));
await b.close(); process.exit(0);
