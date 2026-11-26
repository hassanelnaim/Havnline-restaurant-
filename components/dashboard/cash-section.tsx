"use client";
import { useState, useTransition } from "react";
import { Banknote, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { updateCashSettingsAction } from "@/app/actions/business";

/** Settings > Cash at pickup: whether callers can choose cash, and the most a cash order can be. */
export function CashSection({ acceptsCash, maxCents }: { acceptsCash: boolean; maxCents: number | null }) {
  const [on, setOn] = useState(acceptsCash);
  const [max, setMax] = useState(maxCents ? (maxCents / 100).toFixed(2).replace(/\.00$/, "") : "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await updateCashSettingsAction({ acceptsCash: on, maxDollars: max });
      if (r.success) setSaved(true);
      else setError(r.error || "Couldn't save the cash settings.");
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-dark"><Banknote className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15px] font-semibold text-ink">Cash at pickup</h2>
          <p className="mt-0.5 text-[12.5px] text-text-muted">
            When it&apos;s on, your AI asks callers whether they&apos;d like to pay by card now or cash when they pick up. Cash orders print straight away with the amount to collect; tap &ldquo;Paid in cash&rdquo; or &ldquo;No-show&rdquo; on the kitchen tablet. A number that doesn&apos;t pick up a cash order pays by card next time.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2.5 text-[13.5px] font-medium text-text">
          <Switch id="accepts-cash" checked={on} onCheckedChange={(v: boolean) => { setOn(v); setSaved(false); }} aria-label="Accept cash at pickup" />
          {on ? "Accepting cash" : "Card only"}
        </label>
        {on && (
          <div className="flex items-center gap-2 text-[13px] text-text-muted">
            <label htmlFor="cash-max">Cash orders up to $</label>
            <Input id="cash-max" inputMode="decimal" className="w-24" value={max} placeholder="No limit" onChange={(e) => { setMax(e.target.value.replace(/[^\d.]/g, "").slice(0, 8)); setSaved(false); }} />
          </div>
        )}
      </div>
      <p className="mt-2 text-[11.5px] text-text-faint">HavnLine&apos;s fee applies to cash orders too. It&apos;s added to your monthly invoice; no-shows aren&apos;t charged.</p>
      {error && <p role="alert" className="mt-3 text-[12.5px] text-danger">{error}</p>}
      <div className="mt-4 flex items-center gap-3">
        <Button variant="brand" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save cash settings"}</Button>
        {saved && <span className="inline-flex items-center gap-1 text-[12px] font-medium text-success"><Check className="h-3.5 w-3.5" /> Saved</span>}
      </div>
    </section>
  );
}
