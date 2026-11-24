"use client";
import { useState, useTransition } from "react";
import { Timer, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { updateReadyTimesAction } from "@/app/actions/business";
import { READY_TIERS, readReadyMinutes, type ReadyMinutes, type ReadyTier } from "@/lib/ai/readyTime";

/** Settings > Ready times: what the AI tells callers about how long their order takes. */
export function ReadyTimesSection({ initial }: { initial: unknown }) {
  const [draft, setDraft] = useState<Record<ReadyTier, [string, string]>>(() => {
    const r: ReadyMinutes = readReadyMinutes(initial);
    return { small: [String(r.small[0]), String(r.small[1])], medium: [String(r.medium[0]), String(r.medium[1])], large: [String(r.large[0]), String(r.large[1])] };
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set(tier: ReadyTier, i: 0 | 1, v: string) {
    setSaved(false);
    setDraft((d) => {
      const pair: [string, string] = [...d[tier]] as [string, string];
      pair[i] = v.replace(/[^\d]/g, "").slice(0, 3);
      return { ...d, [tier]: pair };
    });
  }

  function save() {
    setError(null);
    const value = Object.fromEntries(READY_TIERS.map(({ tier }) => [tier, [Number(draft[tier][0]), Number(draft[tier][1])]]));
    startTransition(async () => {
      const r = await updateReadyTimesAction(value);
      if (r.success) setSaved(true);
      else setError(r.error || "Couldn't save the ready times.");
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-dark"><Timer className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15px] font-semibold text-ink">Ready times</h2>
          <p className="mt-0.5 text-[12.5px] text-text-muted">How long an order usually takes. Your AI tells callers the range for their order, as an estimate.</p>
        </div>
      </div>
      <div className="mt-5 divide-y divide-border-soft rounded-xl border border-border">
        {READY_TIERS.map(({ tier, label, items }) => (
          <div key={tier} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="w-40">
              <div className="text-[13.5px] font-medium text-text">{label}</div>
              <div className="text-[11.5px] text-text-faint">{items}</div>
            </div>
            <div className="flex items-center gap-2">
              <Input id={`ready-${tier}-min`} inputMode="numeric" className="w-16" value={draft[tier][0]} onChange={(e) => set(tier, 0, e.target.value)} aria-label={`${label} shortest minutes`} />
              <span className="text-[12.5px] text-text-faint">to</span>
              <Input id={`ready-${tier}-max`} inputMode="numeric" className="w-16" value={draft[tier][1]} onChange={(e) => set(tier, 1, e.target.value)} aria-label={`${label} longest minutes`} />
              <span className="text-[12.5px] text-text-faint">minutes</span>
            </div>
          </div>
        ))}
      </div>
      {error && <p role="alert" className="mt-3 text-[12.5px] text-danger">{error}</p>}
      <div className="mt-4 flex items-center gap-3">
        <Button variant="brand" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save ready times"}</Button>
        {saved && <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success"><Check className="h-3.5 w-3.5" /> Saved</span>}
      </div>
    </section>
  );
}
