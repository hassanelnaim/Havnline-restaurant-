"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, RotateCcw, Check, PhoneOff, Undo2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  closeStuckCallAction,
  markTicketHandledAction,
  queueOrderPrintAction,
  refundPaidAfterVoidAction,
  retryPrintJobAction,
  runJobNowAction,
  sealTwilioTokensAction,
  type HealthActionResult,
} from "@/app/actions/admin-health";
import type { CronJob } from "@/lib/monitoring/cronRuns";
import type { StuckAction } from "@/lib/admin/health";

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<HealthActionResult | null>(null);
  const run = (fn: () => Promise<HealthActionResult>) =>
    start(async () => {
      setResult(null);
      try {
        const r = await fn();
        setResult(r);
      } catch {
        setResult({ success: false, error: "Something went wrong. Try again." });
      }
      router.refresh();
    });
  return { pending, result, run };
}

function Feedback({ result }: { result: HealthActionResult | null }) {
  if (!result) return null;
  const text = result.success ? result.message : result.error;
  if (!text) return null;
  return <span className={`text-[12px] ${result.success ? "text-success" : "text-danger"}`}>{text}</span>;
}

export function RunJobButton({ job }: { job: CronJob }) {
  const { pending, result, run } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => runJobNowAction(job))}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {pending ? "Running…" : "Run now"}
      </Button>
      <Feedback result={result} />
    </div>
  );
}

const LABELS: Record<StuckAction, { label: string; icon: typeof Play; confirm?: string }> = {
  retry_print: { label: "Retry print", icon: RotateCcw },
  queue_print: { label: "Send to kitchen", icon: RotateCcw },
  mark_handled: { label: "Mark handled", icon: Check },
  close_call: { label: "Close", icon: PhoneOff },
  refund: { label: "Refund", icon: Undo2, confirm: "Refund in full?" },
};

function callFor(action: StuckAction, id: string): () => Promise<HealthActionResult> {
  switch (action) {
    case "retry_print":
      return () => retryPrintJobAction(id);
    case "queue_print":
      return () => queueOrderPrintAction(id);
    case "mark_handled":
      return () => markTicketHandledAction(id);
    case "close_call":
      return () => closeStuckCallAction(id);
    case "refund":
      return () => refundPaidAfterVoidAction(id);
  }
}

/** The fix buttons on one stuck item. Refund asks a second time before it moves money. */
export function StuckItemActions({ id, actions }: { id: string; actions: StuckAction[] }) {
  const { pending, result, run } = useAction();
  const [confirming, setConfirming] = useState<StuckAction | null>(null);
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((a) => {
        const { label, icon: Icon, confirm } = LABELS[a];
        const asking = confirming === a;
        return (
          <Button
            key={a}
            size="sm"
            variant={asking ? "danger" : a === "mark_handled" ? "ghost" : "outline"}
            disabled={pending}
            onClick={() => {
              if (confirm && !asking) {
                setConfirming(a);
                return;
              }
              setConfirming(null);
              run(callFor(a, id));
            }}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
            {asking ? confirm : label}
          </Button>
        );
      })}
      {confirming && (
        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
          Cancel
        </Button>
      )}
      <Feedback result={result} />
    </div>
  );
}

export function SealTokensButton() {
  const { pending, result, run } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(sealTwilioTokensAction)}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
        Encrypt now
      </Button>
      <Feedback result={result} />
    </div>
  );
}
