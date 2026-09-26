import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";
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
// JavaScript (SpotOn online ordering, Toast, ChowNow, Squarespace, Wix,
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

async function callScrapingBee(url: string, apiKey: string, extraParams: Record<string, string>): Promise<Response> {
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
    // rendering depends on those finishing first — SpotOn's ordering
    // pages are one of them. ScrapingBee's own error message for this
    // exact failure recommends turning it off.
    block_resources: "false",
    ...extraParams,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    return await fetch(`https://app.scrapingbee.com/api/v1/?${params.toString()}`, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaScrapingBee(url: string): Promise<string> {
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) throw new Error("SCRAPINGBEE_API_KEY is not configured.");

  let response = await callScrapingBee(url, apiKey, {});

  // Some ordering platforms run basic bot-detection that a plain
  // headless render trips. If the first attempt fails, retry once
  // through ScrapingBee's premium/stealth proxy before giving up — it
  // costs more of the account's monthly credits, so it's a fallback,
  // not the default.
  if (!response.ok) {
    response = await callScrapingBee(url, apiKey, { stealth_proxy: "true" });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`The page-rendering service couldn't load that page (HTTP ${response.status}). ${body.slice(0, 200)}`);
  }

  return response.text();
}

async function fetchViaPlainRequest(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Could not load that website (HTTP ${response.status}).`);
  }

  return response.text();
}

export async function fetchWebsiteText(url: string): Promise<string> {
  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  const renderingConfigured = Boolean(process.env.SCRAPINGBEE_API_KEY);
  const html = renderingConfigured ? await fetchViaScrapingBee(normalizedUrl) : await fetchViaPlainRequest(normalizedUrl);

  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer").remove();

  const text = $("body").text().replace(/\s+/g, " ").trim();

  if (text.length < 50) {
    throw new Error(
      renderingConfigured
        ? "Couldn't find enough readable content on that page, even after rendering it — try \"Paste text\" instead."
        : "Couldn't find enough readable content on that page. If this is a JavaScript-based ordering site (SpotOn, Toast, ChowNow, etc.), use \"Paste text\" instead — plain website imports can't read those pages."
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
    max_tokens: 2048,
    system: `You extract a restaurant MENU (items customers can order) from raw website text for "${businessName}". Only include items genuinely mentioned in the text — never invent an item, price, or add-on that isn't there. Respond with ONLY a JSON array, no other text, no markdown fences. Each item: {"name": string, "description": string (short, one line, empty string if none), "priceDollars": string (just the number, e.g. "12.99" — empty string "" if no price is stated), "category": string (e.g. "Burgers", "Drinks" — empty string if unclear), "modifierGroups": [{"name": string, "required": boolean, "options": [{"name": string, "priceDeltaDollars": string (e.g. "2.00" or "0" — empty string if none stated)}]}]}. Only include modifierGroups that are genuinely stated (like size or topping choices) — an empty array is fine and expected for most items. Skip navigation text and anything that isn't really a menu item.`,
    messages: [{ role: "user", content: `Extract the menu from this website text:\n\n${websiteText}` }],
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
