"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelPauseAction, resumeRestaurantAction } from "@/app/actions/ai-pause";
import type { PauseListRow } from "@/lib/admin/pauses";

function fmt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}

const BADGE: Record<PauseListRow["state"], { label: string; cls: string }> = {
  active: { label: "Paused now", cls: "bg-danger-soft text-danger" },
  scheduled: { label: "Scheduled", cls: "bg-brand-soft text-brand" },
  ended: { label: "Ended", cls: "bg-paper text-text-muted" },
  cancelled: { label: "Cancelled", cls: "bg-paper text-text-muted" },
};

export function PauseList({ pauses }: { pauses: PauseListRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(key: string, fn: () => Promise<{ success: boolean; error?: string }>) {
    setBusy(key);
    setError(null);
    startTransition(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.success) setError(r.error || "That didn't work.");
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h2 className="text-[13px] font-semibold text-ink">Pauses</h2>
      {error && <div role="alert" className="mt-3 rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[12.5px] text-danger">{error}</div>}
      {pauses.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-text-muted">No pauses yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {pauses.map((p) => {
            const live = p.state === "active" || p.state === "scheduled";
            const stillPaused = p.restaurants.filter((r) => !r.resumedAt).length;
            return (
              <li key={p.id} className="py-3" data-pause-id={p.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE[p.state].cls}`}>{BADGE[p.state].label}</span>
                    <span className="text-[13px] font-medium text-ink">{p.audience}</span>
                  </div>
                  {live && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => run(p.id, () => cancelPauseAction(p.id))}
                      className="rounded-lg border border-border px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-paper disabled:opacity-50"
                    >
                      {busy === p.id ? "Working…" : p.state === "scheduled" ? "Cancel pause" : "Resume all now"}
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[12px] text-text-muted">
                  {fmt(p.startsAt)} → {p.endsAt ? fmt(p.endsAt) : "until resumed"}
                  {p.cancelledAt && p.state === "ended" ? ` · ended early ${fmt(p.cancelledAt)}` : ""}
                  {" · "}
                  {live ? `${stillPaused} of ${p.restaurants.length} paused` : `${p.restaurants.length} ${p.restaurants.length === 1 ? "restaurant" : "restaurants"}`}
                  {p.messageSent ? " · message sent" : ""}
                </p>
                {p.reason && <p className="mt-0.5 text-[12px] text-text-faint">{p.reason}</p>}
                <button type="button" onClick={() => setOpen(open === p.id ? null : p.id)} className="mt-1 text-[12px] font-medium text-brand hover:underline">
                  {open === p.id ? "Hide restaurants" : "Show restaurants"}
                </button>
                {open === p.id && (
                  <ul className="mt-2 rounded-lg border border-border">
                    {p.restaurants.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-[12.5px] last:border-0">
                        <span className="min-w-0 truncate text-ink">{r.name}</span>
                        {r.resumedAt ? (
                          <span className="text-text-faint">resumed {fmt(r.resumedAt)}</span>
                        ) : live ? (
                          <button type="button" disabled={busy !== null} onClick={() => run(`${p.id}:${r.id}`, () => resumeRestaurantAction(r.id, p.id))} className="font-medium text-brand hover:underline disabled:opacity-50">
                            {busy === `${p.id}:${r.id}` ? "Working…" : p.state === "scheduled" ? "Leave out" : "Resume"}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
