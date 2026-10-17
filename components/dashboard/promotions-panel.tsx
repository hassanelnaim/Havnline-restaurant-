"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Lightbulb, Loader2, Percent, Plus, Trash2 } from "lucide-react";
import type { DbPromotion } from "@/lib/database/types";
import { addPromotionAction, togglePromotionAction, deletePromotionAction } from "@/app/actions/knowledge";
import type { PromotionPrefill } from "@/lib/analytics/promotionPrefill";
import { describeSchedule, describeDiscount, isPromotionActiveNow } from "@/lib/business/pricing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DayPicker } from "@/components/dashboard/day-picker";

type Status = { label: string; className: string; order: number };

/** Where a promotion stands today, in the restaurant's own timezone. */
function promotionStatus(p: DbPromotion, today: string, timezone: string): Status {
  if (!p.is_active) return { label: "Paused", className: "bg-paper text-text-muted", order: 3 };
  if (p.end_date < today) return { label: "Ended", className: "bg-paper text-text-faint", order: 4 };
  if (p.start_date > today) return { label: "Scheduled", className: "bg-info-soft text-brand-dark", order: 1 };
  if (isPromotionActiveNow(p, timezone)) return { label: "Active now", className: "bg-success-soft text-success", order: 0 };
  return { label: "Running · not right now", className: "bg-brand-soft text-brand-dark", order: 2 };
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function PromotionsPanel({
  initialPromotions,
  menuOptions,
  prefill,
  timezone,
  today,
}: {
  initialPromotions: DbPromotion[];
  menuOptions: { id: string; name: string }[];
  prefill?: PromotionPrefill | null;
  timezone: string;
  /** YYYY-MM-DD in the restaurant's timezone. */
  today: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [promotions, setPromotions] = useState(initialPromotions);
  useEffect(() => { setPromotions(initialPromotions); }, [initialPromotions]);

  const [title, setTitle] = useState(prefill?.title ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [appliesTo, setAppliesTo] = useState(prefill?.appliesTo ?? "");
  const [start, setStart] = useState(prefill?.start ?? "");
  const [end, setEnd] = useState(prefill?.end ?? "");
  const [days, setDays] = useState<number[]>(prefill?.days ?? []);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [discountType, setDiscountType] = useState<"none" | "percent" | "amount">(prefill?.discountType ?? "none");
  const [discountValue, setDiscountValue] = useState(prefill?.discountValue ?? "");
  // Only items still on the menu: an idea may name one that was removed since.
  const [itemIds, setItemIds] = useState<string[]>((prefill?.itemIds ?? []).filter((id) => menuOptions.some((m) => m.id === id)));
  const [itemSearch, setItemSearch] = useState("");
  const [showPrefillNote, setShowPrefillNote] = useState(Boolean(prefill));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function addPromo() {
    setError(null);
    setSaving(true);
    startTransition(async () => {
      const result = await addPromotionAction({
        title, description, appliesTo, startDate: start, endDate: end, days, startTime, endTime,
        discountType, discountValue, menuItemIds: itemIds,
      });
      setSaving(false);
      if (!result.success) { setError(result.error || "Could not add that promotion."); return; }
      setTitle(""); setDescription(""); setAppliesTo(""); setStart(""); setEnd("");
      setDays([]); setStartTime(""); setEndTime(""); setDiscountType("none"); setDiscountValue(""); setItemIds([]); setShowPrefillNote(false);
      router.refresh();
    });
  }

  function togglePromo(id: string, active: boolean) {
    setPromotions((prev) => prev.map((p) => (p.id === id ? { ...p, is_active: active } : p)));
    startTransition(async () => { await togglePromotionAction(id, active); });
  }

  function removePromo(id: string) {
    setPromotions((prev) => prev.filter((p) => p.id !== id));
    startTransition(async () => { await deletePromotionAction(id); });
  }

  const sorted = promotions
    .map((p) => ({ p, status: promotionStatus(p, today, timezone) }))
    .sort((a, b) => a.status.order - b.status.order || a.p.start_date.localeCompare(b.p.start_date));
  const matchingItems = menuOptions.filter((m) => m.name.toLowerCase().includes(itemSearch.trim().toLowerCase()));

  return (
    <div className="space-y-4">
      {showPrefillNote && (
        <div className="flex items-start gap-3 rounded-xl border border-brand/25 bg-brand-50 px-4 py-3 text-[13px] text-ink">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <div className="flex-1">Filled in from your dashboard idea. Check the dates, days and discount, change anything you like, then press <strong>Add promotion</strong>. Nothing is saved until you do.</div>
          <button onClick={() => setShowPrefillNote(false)} className="text-[12px] font-medium text-brand hover:underline">Dismiss</button>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Left: new promotion */}
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand-dark"><Percent className="h-4 w-4" /></span> New promotion</CardTitle>
            <CardDescription className="mt-1">Your AI mentions it — and with a discount set, charges the lower price automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3.5">
            <div><Label>Title</Label><Input className="mt-1.5" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Coney Tuesday" /></div>
            <div><Label>What to tell callers</Label><Input className="mt-1.5" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. $1 off every coney, all day Tuesday" /></div>
            <div className="grid grid-cols-2 gap-2.5">
              <div><Label>Starts</Label><Input type="date" className="mt-1.5" value={start} onChange={(e) => setStart(e.target.value)} /></div>
              <div><Label>Ends</Label><Input type="date" className="mt-1.5" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
            </div>
            <div>
              <Label>Days</Label>
              <div className="mt-1.5"><DayPicker value={days} onChange={setDays} /></div>
              <p className="mt-1 text-[11px] text-text-faint">{days.length === 0 ? "None picked = every day." : describeSchedule({ days })}</p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div><Label>From <span className="font-normal text-text-faint">(optional)</span></Label><Input type="time" className="mt-1.5" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
              <div><Label>Until <span className="font-normal text-text-faint">(optional)</span></Label><Input type="time" className="mt-1.5" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
            </div>

            <div>
              <Label>Discount</Label>
              <div className="mt-1.5 flex gap-2">
                <select
                  className="h-10 flex-1 rounded-lg border border-border bg-card px-3 text-[13.5px] text-text"
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as "none" | "percent" | "amount")}
                >
                  <option value="none">None — just mention it</option>
                  <option value="percent">% off</option>
                  <option value="amount">$ off each item</option>
                </select>
                {discountType !== "none" && (
                  <div className="relative w-24">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12.5px] text-text-faint">{discountType === "percent" ? "%" : "$"}</span>
                    <Input className="h-10 pl-6" inputMode="decimal" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} placeholder={discountType === "percent" ? "20" : "2.00"} />
                  </div>
                )}
              </div>
            </div>

            {discountType !== "none" && (
              <div>
                <Label>Which items</Label>
                <p className="mt-0.5 text-[11px] text-text-faint">{itemIds.length === 0 ? "None picked = every item on the menu." : `${itemIds.length} item${itemIds.length === 1 ? "" : "s"} picked.`}</p>
                <Input className="mt-1.5 h-8" placeholder="Search items…" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} />
                <div className="mt-1.5 max-h-36 overflow-y-auto rounded-lg border border-border p-1.5">
                  {menuOptions.length === 0 ? (
                    <p className="p-1 text-[12px] text-text-faint">Add menu items first.</p>
                  ) : (
                    matchingItems.map((m) => (
                      <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-paper">
                        <input type="checkbox" checked={itemIds.includes(m.id)} onChange={(e) => setItemIds((prev) => (e.target.checked ? [...prev, m.id] : prev.filter((x) => x !== m.id)))} />
                        {m.name}
                      </label>
                    ))
                  )}
                </div>
                <p className="mt-1 text-[11px] text-text-faint">Applies to the item price, not add-ons. Promotions don&apos;t stack — the lowest price wins.</p>
              </div>
            )}

            <div><Label>Applies to <span className="font-normal text-text-faint">(optional note for the AI)</span></Label><Input className="mt-1.5" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} placeholder="e.g. All coneys" /></div>

            {error && <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
            <Button variant="brand" className="w-full" onClick={addPromo} disabled={saving || !title.trim() || !start || !end}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add promotion
            </Button>
          </CardContent>
        </Card>

        {/* Right: existing promotions */}
        <div className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="font-display text-[15px] font-semibold text-ink">Your promotions</h3>
            <span className="text-[12px] text-text-faint">{promotions.length} total</span>
          </div>
          {sorted.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center">
              <Percent className="mx-auto h-6 w-6 text-text-faint" />
              <p className="mt-2 text-[13px] font-medium text-ink">No promotions yet</p>
              <p className="mt-0.5 text-[12.5px] text-text-muted">Create one on the left, or use an idea from your Overview page.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {sorted.map(({ p, status }) => {
                const discount = describeDiscount(p);
                const schedule = describeSchedule({ days: p.days_of_week, start: p.start_time, end: p.end_time });
                const scope = p.menu_item_ids && p.menu_item_ids.length > 0 ? `${p.menu_item_ids.length} item${p.menu_item_ids.length === 1 ? "" : "s"}` : discount ? "All items" : null;
                return (
                  <div key={p.id} className={`rounded-2xl border border-border bg-card p-4 shadow-card ${status.label === "Ended" ? "opacity-70" : ""}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-[14px] font-semibold text-ink">{p.title}</span>
                          {discount && <span className="rounded-md bg-brand px-1.5 py-0.5 text-[11px] font-semibold text-white">{discount}</span>}
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}>{status.label}</span>
                        </div>
                        {p.description && <p className="mt-1 text-[12.5px] text-text-muted">{p.description}</p>}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-text-faint">
                          <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {shortDate(p.start_date)} – {shortDate(p.end_date)}</span>
                          <span>{schedule}</span>
                          {scope && <span>{scope}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={p.is_active} onCheckedChange={(checked) => togglePromo(p.id, checked)} aria-label={p.is_active ? "Pause promotion" : "Turn promotion on"} />
                        <button onClick={() => removePromo(p.id)} className="rounded-md p-1 text-text-faint hover:bg-danger-soft hover:text-danger" aria-label="Delete promotion"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-[11.5px] text-text-faint">To change one item&apos;s own price on certain days or hours (like a breakfast price), use its time-based price on the Menu items tab.</p>
        </div>
      </div>
    </div>
  );
}
