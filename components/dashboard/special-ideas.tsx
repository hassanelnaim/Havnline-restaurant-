import Link from "next/link";
import { ArrowRight, CalendarDays, Layers, Lightbulb, Sparkles, Tag, TrendingUp } from "lucide-react";
import type { SpecialSuggestion, SuggestionKind } from "@/lib/analytics/specialSuggestions";

const ICONS: Record<SuggestionKind, typeof Tag> = {
  "slow-day": CalendarDays,
  "cold-item": Tag,
  bundle: Layers,
  steady: TrendingUp,
  "not-enough-data": Sparkles,
};

/**
 * Data-backed ideas for a special, each with a button that opens the
 * promotion form already filled in for that idea (see promotionPrefill.ts).
 */
export function SpecialIdeas({ ideas }: { ideas: SpecialSuggestion[] }) {
  return (
    <section className="rounded-2xl border border-brand/20 bg-gradient-to-br from-brand-50 to-brand-soft p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white shadow-sm"><Lightbulb className="h-[18px] w-[18px]" /></div>
          <div>
            <h2 className="font-display text-[15px] font-semibold text-ink">Ideas for specials</h2>
            <p className="text-[12px] text-text-muted">Based on your own orders from the last 4 weeks</p>
          </div>
        </div>
        <Link href="/dashboard/menu?tab=promotions" className="text-[12.5px] font-medium text-brand hover:underline">All promotions</Link>
      </div>

      <div className={`mt-4 grid gap-3 ${ideas.length > 1 ? "md:grid-cols-2" : ""}`}>
        {ideas.map((idea) => {
          const Icon = ICONS[idea.kind];
          return (
            <div key={idea.title} className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-dark"><Icon className="h-4 w-4" /></div>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold text-ink">{idea.title}</div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">{idea.detail}</p>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <Link
                  href={idea.href}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-white shadow-sm transition-colors hover:bg-brand-dark"
                >
                  {idea.actionLabel} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
