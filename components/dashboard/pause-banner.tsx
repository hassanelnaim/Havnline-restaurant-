import { PauseCircle, CalendarClock } from "lucide-react";
import { formatPauseTime, type PauseState } from "@/lib/ai/pause";

/** Top-of-dashboard notice while HavnLine has the AI paused, or has a pause coming up. */
export function PauseBanner({ state, timezone }: { state: PauseState; timezone: string | null }) {
  const t = (iso: string) => formatPauseTime(iso, timezone);
  if (state.active) {
    const p = state.active;
    return (
      <section aria-label="AI paused by HavnLine" className="mb-6 rounded-2xl border border-danger/20 bg-danger-soft p-4">
        <div className="flex items-start gap-3">
          <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
          <div className="text-[13px] leading-relaxed text-ink">
            <p className="font-semibold">HavnLine has paused your AI order-taker for an update{p.endsAt ? ` until ${t(p.endsAt)}` : ""}.</p>
            <p className="mt-0.5 text-text-muted">Calls to your HavnLine number are ringing your restaurant&apos;s phone in the meantime. Your AI turns back on by itself; you don&apos;t need to do anything.</p>
          </div>
        </div>
      </section>
    );
  }
  if (state.upcoming) {
    const p = state.upcoming;
    return (
      <section aria-label="Upcoming AI pause" className="mb-6 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
          <div className="text-[13px] leading-relaxed text-ink">
            <p className="font-semibold">
              Planned update: your AI order-taker pauses {t(p.startsAt)}
              {p.endsAt ? ` until ${t(p.endsAt)}` : ""}.
            </p>
            <p className="mt-0.5 text-text-muted">During that time, calls will ring your restaurant&apos;s phone so you don&apos;t miss orders.</p>
          </div>
        </div>
      </section>
    );
  }
  return null;
}
