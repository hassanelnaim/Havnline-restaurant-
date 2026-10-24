"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBusinessSubscriptionStatusAction } from "@/app/actions/platform-admin";

const STATUSES = ["none", "trialing", "active", "past_due", "canceled"];

export function StatusEditor({ businessId, currentStatus }: { businessId: string; currentStatus: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [saved, setSaved] = useState(false);
  const [, startTransition] = useTransition();

  function handleChange(newStatus: string) {
    setStatus(newStatus);
    startTransition(async () => {
      await updateBusinessSubscriptionStatusAction(businessId, newStatus);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select aria-label="Subscription status" value={status} onChange={(e) => handleChange(e.target.value)} className="h-9 rounded-lg border border-border bg-card px-3 text-[13px]">
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {saved && <span className="text-[12px] font-medium text-success">Saved ✓</span>}
    </div>
  );
}
