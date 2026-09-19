import { AlertTriangle, Phone } from "lucide-react";
import { getEscalatedCalls } from "@/lib/data/calls";
import { getBusiness } from "@/lib/data/business";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

function toBizDateString(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/**
 * Every call the AI handed off to a human, with exactly what a
 * business owner needs to follow up: who called, their number, when,
 * and why. Reached by clicking the "Human Escalations" stat on
 * Overview, or directly from the sidebar. Today's escalations (in the
 * business's real timezone, not the server's) are highlighted so the
 * ones that actually need attention right now don't get lost in older
 * history.
 */
export default async function EscalationsPage() {
  const [escalations, business] = await Promise.all([getEscalatedCalls(), getBusiness()]);
  const timezone = business.timezone || "America/New_York";
  const todayInBizTz = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  return (
    <div>
      <PageHeader title="Escalations" description="Calls your AI handed off to you — customer, phone number, and why." />

      {escalations.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="No escalations" description="When your AI hands a call off to you, it'll show up here." />
      ) : (
        <div className="space-y-3">
          {escalations.map((call) => {
            const isToday = toBizDateString(call.started_at, timezone) === todayInBizTz;
            return (
              <Card key={call.id} className={isToday ? "border-danger/40 ring-1 ring-danger/20" : undefined}>
                <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
                      <AlertTriangle className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                        {call.customer_name}
                        {isToday && <span className="rounded-full bg-danger px-2 py-0.5 text-[10.5px] font-medium text-white">Today</span>}
                      </div>
                      <a href={`tel:${call.phone}`} className="mt-0.5 flex items-center gap-1.5 text-[12.5px] font-medium text-brand hover:underline">
                        <Phone className="h-3 w-3" /> {call.phone}
                      </a>
                      <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-text">
                        {call.escalation_reason || "No reason was logged for this escalation."}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-[11.5px] text-text-faint">{formatDateTime(call.started_at, timezone)}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
