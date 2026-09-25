import Link from "next/link";
import { Phone } from "lucide-react";
import { getCalls } from "@/lib/data/calls";
import { getBusiness } from "@/lib/data/business";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { CallOutcomeBadge } from "@/components/dashboard/status-badges";
import { formatDateTime, formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CallsPage() {
  const [calls, business] = await Promise.all([getCalls(), getBusiness()]);
  const timezone = business.timezone || "America/New_York";

  return (
    <div>
      <PageHeader title="Calls" description="Every call your AI order-taker has answered." />
      {calls.length === 0 ? (
        <EmptyState icon={Phone} title="No calls yet" description="Calls your AI answers will show up here." />
      ) : (
        <>
          {/* Desktop/tablet: real table. Caller name now links to the full transcript. */}
          <Card className="hidden md:block">
            <Table>
              <TableHeader><TableRow><TableHead>Caller</TableHead><TableHead>Phone</TableHead><TableHead>When</TableHead><TableHead>Duration</TableHead><TableHead>Outcome</TableHead></TableRow></TableHeader>
              <TableBody>
                {calls.map((call) => (
                  <TableRow key={call.id}>
                    <TableCell>
                      <Link href={`/dashboard/calls/${call.id}`} className="font-medium text-brand hover:underline">
                        {call.customer_name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-text-muted">{call.phone}</TableCell>
                    <TableCell>{formatDateTime(call.started_at, timezone)}</TableCell>
                    <TableCell>{formatDuration(Math.round(call.duration_seconds / 60))}</TableCell>
                    <TableCell><CallOutcomeBadge outcome={call.outcome} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile: same data, stacked cards — also linked to the transcript. */}
          <div className="space-y-2.5 md:hidden">
            {calls.map((call) => (
              <Link key={call.id} href={`/dashboard/calls/${call.id}`}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[14px] font-semibold text-brand">{call.customer_name}</div>
                      <div className="mt-0.5 text-[12px] text-text-muted">{formatDateTime(call.started_at, timezone)}</div>
                    </div>
                    <CallOutcomeBadge outcome={call.outcome} />
                  </div>
                  <div className="mt-2.5 flex items-center gap-3 border-t border-border-soft pt-2.5 text-[12px] text-text-muted">
                    <span className="font-mono">{call.phone}</span>
                    <span>·</span>
                    <span>{formatDuration(Math.round(call.duration_seconds / 60))}</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
