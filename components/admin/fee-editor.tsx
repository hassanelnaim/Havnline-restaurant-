"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePlatformFeeAction } from "@/app/actions/platform-admin";

export function FeeEditor({ businessId, currentFeeBps }: { businessId: string; currentFeeBps: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState(currentFeeBps != null ? (currentFeeBps / 100).toString() : "0");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const parsed = parseFloat(value);
  const dirty = Number.isFinite(parsed) && parsed * 100 !== (currentFeeBps ?? 0);

  function handleSave() {
    setError(null);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      setError("Enter a number between 0 and 100.");
      return;
    }
    startTransition(async () => {
      const result = await updatePlatformFeeAction(businessId, parsed);
      if (!result.success) {
        setError(result.error || "Could not save.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-9 w-24 rounded-lg border border-border bg-card pl-3 pr-6 text-[13px] font-mono"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[13px] text-text-faint">%</span>
        </div>
        <button
          onClick={handleSave}
          disabled={!dirty || isPending}
          className="h-9 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-white disabled:opacity-40"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-[12px] font-medium text-success">Saved ✓</span>}
      </div>
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
      {Number.isFinite(parsed) && parsed > 0 && (
        <p className="mt-1.5 text-[11.5px] text-text-faint">On a $20.00 order, HavnLine keeps ${(20 * (parsed / 100)).toFixed(2)}.</p>
      )}
    </div>
  );
}
