import Link from "next/link";
import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import type { BusinessIssue } from "@/lib/admin/issues";

const SEVERITY_STYLES: Record<BusinessIssue["severity"], { icon: typeof AlertOctagon; badge: string; iconColor: string }> = {
  critical: { icon: AlertOctagon, badge: "bg-danger-soft text-danger", iconColor: "text-danger" },
  warning: { icon: AlertTriangle, badge: "bg-amber-100 text-amber-700", iconColor: "text-amber-600" },
  info: { icon: Info, badge: "bg-brand-soft text-brand-dark", iconColor: "text-brand" },
};

/**
 * Read-only — lists what's actually wrong (or worth knowing) right now,
 * computed fresh on every render (see lib/admin/issues.ts). showBusinessLink
 * is on for the platform-wide Command Center panel and off when this is
 * embedded on a single business's own page (name would be redundant there).
 */
export function IssuesPanel({ issues, showBusinessLink = true }: { issues: BusinessIssue[]; showBusinessLink?: boolean }) {
  if (issues.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
        <h2 className="font-display text-[15px] font-semibold text-ink">Issues</h2>
        <p className="mt-2 text-[13px] text-text-muted">Nothing needs attention right now.</p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[15px] font-semibold text-ink">Issues</h2>
        <span className="text-[12px] text-text-faint">{issues.length} found</span>
      </div>
      <div className="mt-3 divide-y divide-border-soft">
        {issues.map((issue, i) => {
          const style = SEVERITY_STYLES[issue.severity];
          const Icon = style.icon;
          return (
            <div key={`${issue.businessId}-${issue.label}-${i}`} className="flex items-start gap-3 py-3">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconColor}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${style.badge}`}>{issue.label}</span>
                  {showBusinessLink && (
                    <Link href={`/admin/businesses/${issue.businessId}`} className="text-[13px] font-medium text-text hover:text-brand-dark">
                      {issue.businessName}
                    </Link>
                  )}
                </div>
                <p className="mt-1 text-[12.5px] text-text-muted">{issue.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
