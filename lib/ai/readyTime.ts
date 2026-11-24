/**
 * How long an order usually takes, by size (Settings > Ready times,
 * businesses.ready_minutes from migration 051). The AI gives the caller
 * the range for their order once it's placed, as an estimate.
 */

export type ReadyTier = "small" | "medium" | "large";
export type ReadyMinutes = Record<ReadyTier, [number, number]>;

export const READY_TIERS: { tier: ReadyTier; label: string; items: string }[] = [
  { tier: "small", label: "Small order", items: "1–3 items" },
  { tier: "medium", label: "Medium order", items: "4–7 items" },
  { tier: "large", label: "Large order", items: "8 or more items" },
];

export const DEFAULT_READY_MINUTES: ReadyMinutes = { small: [10, 15], medium: [15, 25], large: [25, 35] };
export const READY_MAX_MINUTES = 240;

function validPair(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 1 && n <= READY_MAX_MINUTES) && v[0] <= v[1];
}

/** The restaurant's ranges, with the default for anything missing or invalid. */
export function readReadyMinutes(raw: unknown): ReadyMinutes {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    small: validPair(r.small) ? r.small : DEFAULT_READY_MINUTES.small,
    medium: validPair(r.medium) ? r.medium : DEFAULT_READY_MINUTES.medium,
    large: validPair(r.large) ? r.large : DEFAULT_READY_MINUTES.large,
  };
}

/** Checks what Settings sends; null when it's not a usable set of ranges. */
export function parseReadyMinutesInput(input: unknown): ReadyMinutes | null {
  const r = (input && typeof input === "object" ? input : null) as Record<string, unknown> | null;
  if (!r) return null;
  const out = {} as ReadyMinutes;
  for (const { tier } of READY_TIERS) {
    if (!validPair(r[tier])) return null;
    out[tier] = r[tier] as [number, number];
  }
  return out;
}

const range = ([a, b]: [number, number]) => (a === b ? `about ${a} minutes` : `${a} to ${b} minutes`);

/** The ready-time rule for the system prompt. */
export function readyTimePrompt(raw: unknown): string {
  const r = readReadyMinutes(raw);
  return `Ready time (how long until the order is ready for pickup, an estimate the restaurant set):
- 1 to 3 items in total: ${range(r.small)}. 4 to 7 items: ${range(r.medium)}. 8 or more items: ${range(r.large)}. Count quantities: 2 burgers and 2 fries is 4 items.
- Once the order is placed, tell the caller the range for their order in one short sentence, for example "It'll usually be ready in about ${r.small[0]} to ${r.small[1]} minutes." If they pay by the texted link, say the time starts once they pay. Say it again if they ask how long.
- Always give it as a range and an estimate ("usually", "about"). Never promise an exact time, and never give a time other than these ranges.`;
}
