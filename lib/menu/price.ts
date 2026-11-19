/**
 * Menu prices typed by the owner (or read from an imported menu), in dollars,
 * turned into cents. The browser's number box only suggests a minimum; the
 * server used to save whatever arrived, including negative prices.
 */

/** $1,000: far above any single menu item, same ceiling as a tablet special. */
export const MAX_PRICE_CENTS = 100_000;

/** An item's price. Empty = 0 (price not set yet). null = not a usable price. */
export function itemPriceCents(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return 0;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return cents >= 0 && cents <= MAX_PRICE_CENTS ? cents : null;
}

/** An add-on's price change. May be negative ("no cheese, 50¢ off"), within the same ceiling. */
export function addonDeltaCents(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return 0;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return Math.abs(cents) <= MAX_PRICE_CENTS ? cents : null;
}

export const PRICE_ERROR = "Enter a price from $0 to $1,000, like 9.99.";
export const ADDON_PRICE_ERROR = "Enter an add-on price between -$1,000 and $1,000, like 1.50.";
