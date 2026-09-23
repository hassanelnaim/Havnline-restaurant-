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

export async function fetchWebsiteText(url: string): Promise<string> {
  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let response: Response;
  try {
    response = await fetch(normalizedUrl, {
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

  const html = await response.text();
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer").remove();

  const text = $("body").text().replace(/\s+/g, " ").trim();

  if (text.length < 50) {
    throw new Error("Couldn't find enough readable content on that page.");
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
