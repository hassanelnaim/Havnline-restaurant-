"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { resumeRestaurantAction } from "@/app/actions/ai-pause";
import type { PauseState } from "@/lib/ai/pause";

function fmt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}

/** On a restaurant's admin page: its pause state, Resume, or a link to pause it. */
export function PauseControls({ businessId, state }: { businessId: string; state: PauseState }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const btn = "inline-flex h-8 items-center rounded-lg border border-border px-3 text-[12.5px] font-medium text-ink hover:bg-paper disabled:opacity-50";

  function resume() {
    setBusy(true);
    setError(null);
    startTransition(async () => {
      const r = await resumeRestaurantAction(businessId);
      setBusy(false);
      if (!r.success) setError(r.error || "Couldn't resume.");
      router.refresh();
    });
  }

  const p = state.active || state.upcoming;
  if (!p) {
    return (
      <Link href={`/admin/pause?to=${businessId}`} className={btn}>
        Pause AI
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ${state.active ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand"}`}>
        {state.active ? `AI paused${p.endsAt ? ` until ${fmt(p.endsAt)}` : ""}` : `Pause scheduled ${fmt(p.startsAt)}`}
      </span>
      <button type="button" onClick={resume} disabled={busy} className={btn}>
        {busy ? "Working…" : state.active ? "Resume AI" : "Cancel for this restaurant"}
      </button>
      {error && <span className="text-[11.5px] text-danger">{error}</span>}
    </div>
  );
}
