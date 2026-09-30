import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";
import { promises as dns } from "dns";
import net from "net";
import type { KnowledgeCategory } from "@/lib/database/types";

const MAX_CHARS = 15000;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export interface ExtractedKnowledgeItem {
  category: KnowledgeCategory;
  question?: string;
  title?: string;
  content: string;
}

// --------------------------------------------------------------------------
// Fetching a page's rendered content. A plain fetch() only ever sees the
// raw HTML a server sends — for any site that builds its content with
// JavaScript (Toast, ChowNow, Squarespace, Wix,
// and plenty of others) that's just an empty page shell, no matter how
// the fetch itself is tuned. There's no way to "read" those pages without
// actually running their JavaScript first.
//
// ScrapingBee (https://www.scrapingbee.com) does that for us: it loads
// the URL in a real headless browser on their end and hands back the
// fully rendered HTML, so this then reads exactly what a person would see
// in their own browser. Once SCRAPINGBEE_API_KEY is set, both the
// knowledge importer and the menu importer upgrade automatically — no
// other code changes needed. Without a key, this falls back to the old
// plain fetch, which still works fine for ordinary static sites.
// --------------------------------------------------------------------------

// Ordering platforms known to run bot-detection that trips ScrapingBee's
// plain headless render — the exact thing that made
// https://order.spoton.com/... always fail its first attempt and fall
// through to a slow stealth-proxy retry. Rather than pay for that failed
// first attempt every time (it doesn't just fail fast — a blocked JS-heavy
// page still takes several seconds to "finish loading" before ScrapingBee
// reports the failure), a known-protected host goes straight to the
// stealth proxy, cutting a guaranteed-slow two-call sequence down to one.
// Add a hostname here whenever a platform turns out to need this.
const BOT_PROTECTED_HOSTNAMES = [/(^|\.)spoton\.com$/i, /(^|\.)toasttab\.com$/i, /(^|\.)chownow\.com$/i, /(^|\.)olo\.com$/i];

function isKnownBotProtectedHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return BOT_PROTECTED_HOSTNAMES.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

// SECOND CORRECTION, learned by actually testing against production:
// two earlier versions of this file both tried adding a ScrapingBee
// js_scenario here — first a click on a (nonexistent) "Start order"
// gate, then a wait_for on a real DOM marker
// ([data-testid="menu-item-group"], confirmed present on SpotOn's
// live page). Both failed identically: the exact same ~72-character
// pre-hydration shell every time, byte-for-byte. But the version
// BEFORE any js_scenario existed — plain stealth_proxy, nothing else —
// is on record actually working: it's what fetched the real, full
// menu that later hit the max_tokens truncation bug (see the "Fix
// menu-import truncation" commit) — real "Breakfast Special", "Hungry
// Man's Breakfast" items, not a shell. So js_scenario itself, not the
// specific instruction inside it, is what breaks this call — most
// likely because supplying it changes how/when ScrapingBee decides
// the page is "done" and captures it, overriding the plain `wait`
// governed render-completion behavior that was working. Given that
// evidence, this goes back to exactly the plain stealth_proxy call
// that's actually on record succeeding, with no js_scenario at all.
// If a future menu import comes back empty again, resist the urge to
// reach for js_scenario before checking Vercel's logs for what
// fetchWebsiteText actually received — the diagnostic log in
// app/actions/menu.ts already prints it.

async function callScrapingBee(url: string, apiKey: string, extraParams: Record<string, string>, timeoutMs: number): Promise<Response> {
  const params = new URLSearchParams({
    api_key: apiKey,
    url,
    render_js: "true",
    // Gives the page's own JS time to finish loading the menu/content
    // after the initial page load. Ordering apps often show an
    // intermediate screen first (location/table confirmation, a
    // cookie banner) before the real menu — 5s gives more room for
    // that to clear than a bare page load needs.
    wait: "5000",
    block_ads: "true",
    // ScrapingBee blocks extra resources (fonts, some scripts) by
    // default to save bandwidth, but that breaks JS apps whose menu
    // rendering depends on those finishing first — some online
    // ordering pages are among them. ScrapingBee's own error message
    // for this exact failure recommends turning it off.
    block_resources: "false",
    ...extraParams,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// A real ordering-platform page's visible text runs into the
// thousands of characters (categories, item names, descriptions,
// prices). The pre-hydration shell some of these apps show before
// their JS has actually fetched the menu is a couple hundred
// characters at most (nav links, "Sign in", a cart placeholder). This
// is the same test app/actions/menu.ts's "0 items found" check is
// really getting at, just applied earlier — right after rendering,
// so a bad render can be retried instead of only being reported as a
// failure afterward.
const MIN_RENDERED_TEXT_LENGTH = 400;

function htmlToVisibleText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

async function fetchViaScrapingBee(url: string): Promise<string> {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) throw new Error("SCRAPINGBEE_API_KEY is not configured.");

  // The website-import pages (app/dashboard/menu/page.tsx,
  // app/dashboard/knowledge/page.tsx) now allow 180s, not the 60s this
  // used to be capped at. A known bot-protected host skips the doomed
  // plain attempt entirely and goes straight to the stealth proxy.
  //
  // Real-world evidence (see the comment above this function) showed
  // that same stealth-proxy call isn't reliably getting past this
  // site's bot detection — it succeeded once with real menu content,
  // then failed identically across three later attempts running the
  // exact same request. That pattern (same call, different outcome)
  // means the render itself is flaky, not that any particular param
  // is wrong — so instead of one shot, this retries a few times and
  // actually checks the rendered text length each time, rather than
  // trusting a 200 status that a bot-detection stub page can return
  // just as easily as a real one. Each attempt is a fresh ScrapingBee
  // request, which gets a fresh proxy IP — a real chance at a
  // different, better outcome, not a repeat of the same failure.
  if (isKnownBotProtectedHost(url)) {
    const attempts = 3;
    let lastHtml = "";
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const response = await callScrapingBee(url, apiKey, { stealth_proxy: "true" }, 40000);
      const status = response.status;
      const spbCost = response.headers.get("Spb-cost");
      const spbInitialStatus = response.headers.get("Spb-initial-status-code");

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.log(`[websiteImport] ScrapingBee attempt ${attempt}/${attempts} for ${url}: HTTP ${status} (Spb-cost=${spbCost}, Spb-initial-status-code=${spbInitialStatus}) — ${body.slice(0, 200)}`);
        lastHtml = body;
        continue;
      }

      const html = await response.text();
      const visibleText = htmlToVisibleText(html);
      console.log(`[websiteImport] ScrapingBee attempt ${attempt}/${attempts} for ${url}: HTTP ${status}, ${visibleText.length} visible chars (Spb-cost=${spbCost}, Spb-initial-status-code=${spbInitialStatus})`);
      lastHtml = html;

      if (visibleText.length >= MIN_RENDERED_TEXT_LENGTH) {
        return html;
      }
    }
    // Every attempt came back too thin to be the real page. Return the
    // last one anyway — fetchWebsiteText's own <50-char check and
    // app/actions/menu.ts's "0 items found" check will report this as
    // a failure, but with the actual content visible for debugging,
    // same as before.
    return lastHtml;
  }

  let response = await callScrapingBee(url, apiKey, {}, 30000);

  // Some ordering platforms run basic bot-detection that a plain
  // headless render trips. If the first attempt fails, retry once
  // through ScrapingBee's premium/stealth proxy before giving up — it
  // costs more of the account's monthly credits, so it's a fallback,
  // not the default. Capped tighter than a lone attempt would be so the
  // two together still leave room for the AI extraction step under
  // Vercel's 60s ceiling.
  if (!response.ok) {
    response = await callScrapingBee(url, apiKey, { stealth_proxy: "true" }, 25000);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`The page-rendering service couldn't load that page (HTTP ${response.status}). ${body.slice(0, 200)}`);
  }

  return response.text();
}

// --------------------------------------------------------------------------
// SSRF guard. This fetches whatever URL a business owner types into
// "Import from your website" — with no restriction, that's a server-
// side request to an address OF THE OWNER'S CHOOSING, and the result
// (or up to 300 chars of it — see the "0 items found" diagnostic in
// extractMenuFromWebsiteAction) gets echoed back into the dashboard.
// That's blind SSRF turned into SSRF-with-disclosure: pointed at
// 169.254.169.254 (cloud metadata) or an internal service, it could
// leak real infrastructure data to whoever's running the import.
// Resolves the hostname ourselves and refuses anything that isn't a
// public address, rather than trusting the URL's scheme/hostname
// alone (which a redirect or a numeric-IP host can disguise).
// --------------------------------------------------------------------------

function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 0) return true; // "this" network
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true; // loopback / unspecified
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local fc00::/7
    if (lower.startsWith("::ffff:")) {
      const embedded = lower.split(":").pop()!;
      if (net.isIPv4(embedded)) return isPrivateOrReservedIp(embedded);
    }
    return false;
  }
  return true; // not a recognizable IP — fail closed
}

async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("That doesn't look like a valid website address.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http or https website addresses can be imported.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("That address can't be imported from.");
  }

  let addresses: string[];
  try {
    addresses = (await dns.lookup(hostname, { all: true })).map((r) => r.address);
  } catch {
    throw new Error("Could not resolve that website's address.");
  }

  if (addresses.length === 0 || addresses.some(isPrivateOrReservedIp)) {
    throw new Error("That address can't be imported from.");
  }
}

async function fetchViaPlainRequest(url: string): Promise<string> {
  // Manual redirect handling (not fetch's default "follow") so a page
  // that 30x's to an internal address can't slip past the check above
  // on the very next hop — each hop is validated the same way as the
  // original URL before it's followed.
  let currentUrl = url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicHttpUrl(currentUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("That website redirected without a destination.");
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw new Error(`Could not load that website (HTTP ${response.status}).`);
    }

    return response.text();
  }

  throw new Error("That website redirected too many times.");
}

export async function fetchWebsiteText(url: string): Promise<string> {
  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  // Validated up front for both paths — ScrapingBee fetches from its
  // own infrastructure (so it isn't an SSRF risk to ours), but there's
  // no legitimate reason to "import a menu" from a private/internal
  // address either way, and this keeps the check in one place.
  await assertPublicHttpUrl(normalizedUrl);

  const renderingConfigured = Boolean(process.env.SCRAPINGBEE_API_KEY);
  const html = renderingConfigured ? await fetchViaScrapingBee(normalizedUrl) : await fetchViaPlainRequest(normalizedUrl);

  const text = htmlToVisibleText(html);

  if (text.length < 50) {
    throw new Error(
      renderingConfigured
        ? "Couldn't find enough readable content on that page, even after rendering it — try \"Paste text\" instead."
        : "Couldn't find enough readable content on that page. If this is a JavaScript-based ordering site (Toast, ChowNow, etc.), use \"Paste text\" instead — plain website imports can't read those pages."
    );
  }

  return text.slice(0, MAX_CHARS);
}

export async function extractKnowledgeFromText(businessName: string, websiteText: string): Promise<ExtractedKnowledgeItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: `You extract factual business knowledge from raw website text for "${businessName}", a restaurant. Only extract information that is genuinely present in the text — never invent, guess, or embellish. Respond with ONLY a JSON array, no other text, no markdown fences. Each item: {"category": "faq"|"business_info"|"policy"|"menu"|"custom", "question": string (only for category "faq"), "title": string (for non-faq categories), "content": string}. Aim for 5-15 concise, genuinely useful items. Skip navigation text, cookie notices, and anything not substantive.`,
    messages: [{ role: "user", content: `Extract knowledge items from this website text:\n\n${websiteText}` }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return [];

  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.content === "string" && item.content.trim())
      .map((item) => ({
        category: (["faq", "business_info", "policy", "menu", "custom"].includes(item.category) ? item.category : "custom") as KnowledgeCategory,
        question: typeof item.question === "string" ? item.question : undefined,
        title: typeof item.title === "string" ? item.title : undefined,
        content: item.content,
      }));
  } catch {
    return [];
  }
}

// If the model's response is still cut off mid-array even at the raised
// max_tokens (an unusually huge menu, or a model that's more verbose
// than expected), this recovers whatever complete items came through
// before the cutoff instead of throwing the whole extraction away. It
// walks the raw text tracking brace depth (skipping over quoted
// strings so a "}" inside a description doesn't confuse it) and
// remembers the last point where a top-level object fully closed —
// everything up to there is valid JSON on its own once the array is
// closed off. Extracted items are staged/review-only data anyway (see
// the comment above extractMenuItemsFromText), so a partial menu the
// owner can see and finish manually beats a hard error with nothing.
function salvageTruncatedJsonArray(text: string): unknown[] | null {
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let lastCompleteObjectEnd = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\") {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) lastCompleteObjectEnd = i;
    }
  }

  if (lastCompleteObjectEnd === -1) return null;

  try {
    const parsed = JSON.parse(`${text.slice(0, lastCompleteObjectEnd + 1)}]`);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface ExtractedMenuItem {
  name: string;
  description: string;
  priceDollars: string;
  category: string;
  modifierGroups: { name: string; required: boolean; options: { name: string; priceDeltaDollars: string }[] }[];
}

/**
 * IMPORTANT: extracted items are staged, review-only data — never
 * written straight into menu_items. The onboarding/menu-management UI
 * must show these to the owner for confirmation/editing before
 * anything here becomes a real, orderable menu item. An AI misread
 * price or item name served as fact would be a real menu error a
 * customer could be charged for.
 */
export async function extractMenuItemsFromText(businessName: string, websiteText: string): Promise<ExtractedMenuItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    // A large, real menu (many categories, modifiers on every item) can
    // produce a long JSON response. 2048, then 8192, both turned out to
    // still cut off mid-array on a big enough menu (e.g. a full diner
    // menu with dozens of items across several categories), producing
    // invalid JSON with no indication why beyond a raw truncated string.
    // claude-sonnet-5 supports up to 128K output tokens on the standard
    // API with no special header, so there's no real reason to be this
    // stingy — 16384 gives a lot of room past anything a restaurant menu
    // should need, and see the max_tokens salvage logic below for when
    // even that isn't enough.
    max_tokens: 16384,
    system: `You extract a restaurant MENU (items customers can order) from raw website text for "${businessName}". Only include items genuinely mentioned in the text — never invent an item, price, or add-on that isn't there. Respond with ONLY a JSON array, no other text, no markdown fences. Each item: {"name": string, "description": string (short, one line, empty string if none), "priceDollars": string (just the number, e.g. "12.99" — empty string "" if no price is stated), "category": string (e.g. "Burgers", "Drinks" — empty string if unclear), "modifierGroups": [{"name": string, "required": boolean, "options": [{"name": string, "priceDeltaDollars": string (e.g. "2.00" or "0" — empty string if none stated)}]}]}. Only include modifierGroups that are genuinely stated (like size or topping choices) — an empty array is fine and expected for most items. Skip navigation text and anything that isn't really a menu item.`,
    messages: [{ role: "user", content: `Extract the menu from this website text:\n\n${websiteText}` }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("The AI didn't return a readable response for that page.");
  }

  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected a list of items but got something else back: "${cleaned.slice(0, 300)}"`);
    }
    return parsed
      .filter((item) => item && typeof item.name === "string" && item.name.trim())
      .map((item) => normalizeExtractedMenuItem(item));
  } catch (err) {
    if (err instanceof SyntaxError) {
      // JSON.parse failed — most likely a truncated response (the menu
      // was bigger than even the raised max_tokens above) or the model
      // added stray text despite instructions. If it was specifically
      // cut off mid-array, salvage whatever complete items came through
      // rather than throwing away a menu that's 90% there.
      if (response.stop_reason === "max_tokens") {
        const salvaged = salvageTruncatedJsonArray(cleaned);
        if (salvaged && salvaged.length > 0) {
          return salvaged
            .filter((item): item is Record<string, unknown> => Boolean(item) && typeof (item as any).name === "string" && (item as any).name.trim())
            .map((item) => normalizeExtractedMenuItem(item));
        }
      }

      // Surfacing the raw text (instead of silently returning []) is
      // the difference between "0 items found" with no clue why, and
      // actually seeing what went wrong.
      throw new Error(
        `The AI's response for that menu wasn't valid data (response.stop_reason: ${response.stop_reason}). Start of what it returned: "${cleaned.slice(0, 300)}"`
      );
    }
    throw err;
  }
}

/**
 * The photo equivalent of extractMenuItemsFromText — for a physical
 * printed menu, a sign, or a PDF menu that's been exported/screenshotted
 * as an image page. Uses Claude's real vision capability to read the
 * actual photo, not OCR-then-guess — same strict "never invent a price"
 * rule as the text-based version, and same review-before-live staging.
 */
export async function extractMenuItemsFromImage(
  businessName: string,
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp"
): Promise<ExtractedMenuItem[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: `You extract a restaurant MENU (items customers can order) from a photo of a menu for "${businessName}". Only include items genuinely visible in the image — never invent an item, price, or add-on that isn't clearly shown. Respond with ONLY a JSON array, no other text, no markdown fences. Each item: {"name": string, "description": string (short, one line — empty string if the image doesn't show one), "priceDollars": string (just the number, e.g. "12.99" — empty string "" if no price is visible), "category": string (the section heading it's under, e.g. "Burgers" — empty string if unclear), "modifierGroups": [{"name": string, "required": boolean, "options": [{"name": string, "priceDeltaDollars": string}]}]}. Only include modifierGroups genuinely shown (like size or topping choices) — an empty array is fine and expected for most items. If the image is blurry, unreadable, or doesn't actually show a menu, return an empty array rather than guessing.`,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "Extract the menu items and prices from this photo." },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return [];

  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.name === "string" && item.name.trim())
      .map((item) => normalizeExtractedMenuItem(item));
  } catch {
    return [];
  }
}

function normalizeExtractedMenuItem(item: any): ExtractedMenuItem {
  return {
    name: item.name,
    description: typeof item.description === "string" ? item.description : "",
    priceDollars: typeof item.priceDollars === "string" ? item.priceDollars : "",
    category: typeof item.category === "string" ? item.category : "",
    modifierGroups: Array.isArray(item.modifierGroups)
      ? item.modifierGroups
          .filter((g: any) => g && typeof g.name === "string" && Array.isArray(g.options))
          .map((g: any) => ({
            name: g.name,
            required: Boolean(g.required),
            options: g.options
              .filter((o: any) => o && typeof o.name === "string")
              .map((o: any) => ({ name: o.name, priceDeltaDollars: typeof o.priceDeltaDollars === "string" ? o.priceDeltaDollars : "" })),
          }))
      : [],
  };
}
