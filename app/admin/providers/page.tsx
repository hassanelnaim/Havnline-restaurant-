import { requirePlatformAdmin } from "@/lib/supabase/platform-admin";
import { CheckCircle2, XCircle, CircleSlash } from "lucide-react";
import { checkAllProvidersHealth } from "@/app/actions/provider-health";
import { RecheckButton } from "@/components/admin/recheck-button";

export const dynamic = "force-dynamic";

const STATUS_CONFIG = {
  operational: { icon: CheckCircle2, color: "text-success", bg: "bg-success-soft", label: "Operational" },
  error: { icon: XCircle, color: "text-danger", bg: "bg-danger-soft", label: "Error" },
  not_configured: { icon: CircleSlash, color: "text-text-faint", bg: "bg-border-soft", label: "Not Connected" },
};

export default async function ProviderHealthPage() {
  await requirePlatformAdmin();
  const results = await checkAllProvidersHealth();

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-[24px] font-semibold text-ink">Provider Health</h1>
          <p className="mt-1 text-[13.5px] text-text-muted">Real, live checks against each provider — not a cached status.</p>
        </div>
        <RecheckButton />
      </div>

      <div className="mt-6 space-y-3">
        {results.map((result) => {
          const config = STATUS_CONFIG[result.status];
          const Icon = config.icon;
          return (
            <div key={result.provider} className="flex items-center justify-between rounded-2xl border border-border bg-card p-5 shadow-card">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${config.bg} ${config.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-[14px] font-semibold text-ink">{result.provider}</div>
                  <div className="text-[12.5px] text-text-muted">{result.message}</div>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-[13px] font-medium ${config.color}`}>{config.label}</div>
                {result.responseTimeMs !== null && (
                  <div className="text-[11.5px] text-text-faint">{result.responseTimeMs}ms</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[11.5px] text-text-faint">
        Last checked: {new Date(results[0]?.checkedAt).toLocaleString()}. Anthropic's check makes a real, minimal request (1 token) to verify connectivity — this has a negligible but real cost, unlike ElevenLabs' and Twilio's checks, which are free.
      </p>
    </div>
  );
}
