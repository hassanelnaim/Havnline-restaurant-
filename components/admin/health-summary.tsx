import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { HealthCounts } from "@/lib/admin/health";

/** Four green/red tiles at the top of the Health page. */
export function HealthSummary({ counts }: { counts: HealthCounts }) {
  const tiles = [
    { label: "Background jobs", bad: counts.jobsFailing > 0, text: counts.jobsFailing ? `${counts.jobsFailing} not running right` : "On schedule" },
    { label: "Stuck items", bad: counts.stuckItems > 0, text: counts.stuckItems ? `${counts.stuckItems} need a person` : "Nothing stuck" },
    { label: "Alerts, last 24h", bad: false, warn: counts.alerts24h > 0, text: counts.alerts24h ? `${counts.alerts24h} alert${counts.alerts24h === 1 ? "" : "s"}` : "None" },
    { label: "Setup", bad: counts.setupFailing > 0, text: counts.setupFailing ? `${counts.setupFailing} check${counts.setupFailing === 1 ? "" : "s"} failing` : "All passing" },
  ];
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => {
        // Alerts are worth knowing about, not by themselves broken: amber.
        const tone = t.bad ? "bad" : "warn" in t && t.warn ? "warn" : "ok";
        const box = tone === "bad" ? "border-danger/25 bg-danger-soft" : tone === "warn" ? "border-amber-300/60 bg-amber-50" : "border-success/25 bg-success-soft";
        const ink = tone === "bad" ? "text-danger" : tone === "warn" ? "text-amber-700" : "text-success";
        return (
        <div key={t.label} className={`rounded-2xl border px-4 py-3 ${box}`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{t.label}</div>
          <div className={`mt-1 flex items-center gap-1.5 text-[14px] font-semibold ${ink}`}>
            {tone === "ok" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
            {t.text}
          </div>
        </div>
        );
      })}
    </div>
  );
}
