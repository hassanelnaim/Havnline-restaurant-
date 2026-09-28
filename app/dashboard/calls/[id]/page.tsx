import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { getBusiness } from "@/lib/data/business";
import { Card, CardContent } from "@/components/ui/card";
import { CallOutcomeBadge } from "@/components/dashboard/status-badges";
import { formatDateTime, formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CallDetailPage({ params }: { params: { id: string } }) {
  const businessId = await getCurrentBusinessId();
  if (!businessId) notFound();

  const supabase = createClient();
  const [{ data: call }, business] = await Promise.all([
    supabase.from("calls").select("*").eq("id", params.id).eq("business_id", businessId).maybeSingle(),
    getBusiness(),
  ]);
  if (!call) notFound();

  const timezone = business.timezone || "America/New_York";
  const { data: messages } = await supabase
    .from("call_messages")
    .select("*")
    .eq("call_id", params.id)
    .neq("role", "system") // system log lines ("Inbound call from...") aren't part of the conversation
    .order("created_at", { ascending: true });

  return (
    <div>
      <Link href="/dashboard/customers" className="flex items-center gap-1.5 text-[13px] font-medium text-text-muted hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Callers
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[22px] font-semibold text-ink">{call.customer_name || "Phone Caller"}</h1>
          <p className="mt-1 text-[13px] text-text-muted">
            {call.phone} · {formatDateTime(call.started_at, timezone)} · {formatDuration(Math.round((call.duration_seconds || 0) / 60))}
          </p>
        </div>
        <CallOutcomeBadge outcome={call.outcome} />
      </div>

      {call.escalation_reason && (
        <Card className="mt-4 border-danger/20 bg-danger-soft">
          <CardContent className="p-4">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-danger">Escalation reason</div>
            <p className="mt-1 text-[13.5px] text-text">{call.escalation_reason}</p>
          </CardContent>
        </Card>
      )}

      <Card className="mt-4">
        <CardContent className="space-y-4 p-5">
          {(!messages || messages.length === 0) && (
            <p className="text-[13px] text-text-muted">No transcript available for this call.</p>
          )}
          {messages && messages.length > 0 && (
            <p className="rounded-lg bg-paper px-3 py-2 text-[12px] text-text-faint">
              Transcripts are generated automatically and may not be fully accurate — background noise, accents, or crosstalk can cause misheard words.
            </p>
          )}
          {(messages || []).map((msg: any) => (
            <div key={msg.id} className={`flex ${msg.role === "ai" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-[13.5px] ${msg.role === "ai" ? "bg-paper text-text" : "bg-brand text-white"}`}>
                {msg.content}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
