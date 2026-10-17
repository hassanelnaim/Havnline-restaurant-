/**
 * Lets a dashboard idea ("Create a Sunday special") open the promotion form
 * already filled in. The values travel in the Knowledge page's URL and are
 * validated on the way in; nothing is saved until the owner presses Add.
 * Client-safe: no server imports.
 */

export interface PromotionPrefill {
  title?: string;
  description?: string;
  appliesTo?: string;
  days?: number[];
  itemIds?: string[];
  discountType?: "percent" | "amount";
  discountValue?: string;
  start?: string;
  end?: string;
}

export function promotionPrefillHref(p: PromotionPrefill): string {
  const q = new URLSearchParams({ tab: "promotions", prefill: "1" });
  if (p.title) q.set("title", p.title);
  if (p.description) q.set("description", p.description);
  if (p.appliesTo) q.set("appliesTo", p.appliesTo);
  if (p.days?.length) q.set("days", p.days.join(","));
  if (p.itemIds?.length) q.set("items", p.itemIds.join(","));
  if (p.discountType) q.set("discountType", p.discountType);
  if (p.discountValue) q.set("discountValue", p.discountValue);
  if (p.start) q.set("start", p.start);
  if (p.end) q.set("end", p.end);
  return `/dashboard/knowledge?${q.toString()}`;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** Null unless the URL actually carries a prefill. Bad values are dropped, never trusted. */
export function readPromotionPrefill(params: Params): PromotionPrefill | null {
  if (one(params.prefill) !== "1") return null;
  const text = (v: string | undefined, max: number) => (v ? v.slice(0, max) : undefined);
  const days = (one(params.days) || "")
    .split(",")
    .map((d) => parseInt(d, 10))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const itemIds = (one(params.items) || "").split(",").filter((id) => UUID.test(id));
  const discountType = one(params.discountType);
  const discountValue = one(params.discountValue);
  const start = one(params.start);
  const end = one(params.end);
  return {
    title: text(one(params.title), 80),
    description: text(one(params.description), 200),
    appliesTo: text(one(params.appliesTo), 80),
    days: days.length ? Array.from(new Set(days)) : undefined,
    itemIds: itemIds.length ? itemIds : undefined,
    discountType: discountType === "percent" || discountType === "amount" ? discountType : undefined,
    discountValue: discountValue && /^\d{1,4}(\.\d{1,2})?$/.test(discountValue) ? discountValue : undefined,
    start: start && DATE.test(start) ? start : undefined,
    end: end && DATE.test(end) ? end : undefined,
  };
}

export function readInitialKnowledgeTab(params: Params): string | undefined {
  const tab = one(params.tab);
  return tab && ["faqs", "promotions", "policies", "import"].includes(tab) ? tab : undefined;
}
