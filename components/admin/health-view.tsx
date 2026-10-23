import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, XCircle, ExternalLink, Bell, Wrench, ListChecks, Timer } from "lucide-react";
import { BarChart, type Bar } from "@/components/admin/charts";
import { Card } from "@/components/admin/command-center";
import { RunJobButton, SealTokensButton, StuckItemActions } from "@/components/admin/health-actions";
import type { CheckState, HealthReport, JobRun, JobState, JobStatus, SetupCheck, StuckGroup } from "@/lib/admin/health";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ago(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function SectionTitle({ icon: Icon, title, note }: { icon: typeof Bell; title: string; note?: string }) {
  return (
    <div className="mb-3 mt-10 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="flex items-center gap-2 font-display text-[17px] font-semibold text-ink">
        <Icon className="h-4 w-4 text-brand" /> {title}
      </h2>
      {note && <span className="text-[12.5px] text-text-faint">{note}</span>}
    </div>
  );
}

// -------------------------------------------------------------- jobs

const JOB_STATE: Record<JobState, { icon: typeof CheckCircle2; label: string; className: string; spin?: boolean }> = {
  ok: { icon: CheckCircle2, label: "On schedule", className: "bg-success-soft text-success" },
  running: { icon: Loader2, label: "Running", className: "bg-brand-soft text-brand-dark", spin: true },
  failed: { icon: XCircle, label: "Last run failed", className: "bg-danger-soft text-danger" },
  late: { icon: AlertTriangle, label: "Hasn't run in over a day", className: "bg-danger-soft text-danger" },
  never: { icon: CircleSlash, label: "Hasn't run yet", className: "bg-danger-soft text-danger" },
  unknown: { icon: CircleSlash, label: "Can't check", className: "bg-border-soft text-text-muted" },
};

const RESULT_LABELS: Record<string, string> = {
  businessesChecked: "Restaurants due",
  emailsSent: "Emails sent",
  remaining: "Left for the next run",
  errors: "Errors",
  error: "Error",
};

function resultRows(result: Record<string, unknown> | null): { label: string; value: string; bad: boolean }[] {
  if (!result) return [];
  return Object.entries(result).map(([k, v]) => {
    const value = Array.isArray(v) ? (v.length ? v.join("; ") : "None") : String(v);
    const bad = (Array.isArray(v) && v.length > 0) || (typeof v === "string" && (v.startsWith("failed") || k === "error"));
    return { label: RESULT_LABELS[k] || k.charAt(0).toUpperCase() + k.slice(1), value, bad };
  });
}

function duration(run: JobRun): string | null {
  if (!run.finishedAt) return null;
  const ms = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function JobCard({ job, now, fmt }: { job: JobStatus; now: number; fmt: (iso: string) => string }) {
  const s = JOB_STATE[job.state];
  const runs = [...job.history].reverse();
  return (
    <Card
      title={job.label}
      subtitle={job.schedule}
      action={
        <span className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ${s.className}`}>
          <s.icon className={`h-3.5 w-3.5 ${s.spin ? "animate-spin" : ""}`} /> {s.label}
        </span>
      }
    >
      {job.state === "unknown" ? (
        <p className="text-[13px] text-text-muted">Run migration 038 so job runs are recorded.</p>
      ) : job.lastRun ? (
        <>
          <div className="text-[13px] text-text">
            Last ran <span className="font-medium">{ago(job.lastRun.startedAt, now)}</span>
            <span className="text-text-faint"> · {fmt(job.lastRun.startedAt)} · {job.lastRun.trigger === "manual" ? "run by hand" : "on schedule"}{duration(job.lastRun) ? ` · took ${duration(job.lastRun)}` : ""}</span>
          </div>
          <dl className="mt-3 divide-y divide-border-soft rounded-xl border border-border-soft">
            {resultRows(job.lastRun.result).map((r) => (
              <div key={r.label} className="flex items-start justify-between gap-4 px-3 py-2 text-[12.5px]">
                <dt className="text-text-muted">{r.label}</dt>
                <dd className={`text-right font-mono ${r.bad ? "text-danger" : "text-text"}`}>{r.value}</dd>
              </div>
            ))}
            {!job.lastRun.finishedAt && <div className="px-3 py-2 text-[12.5px] text-text-muted">No result recorded. The run was cut off or is still going.</div>}
          </dl>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[11px] text-text-faint">Last {runs.length} runs</span>
            <div className="flex gap-[2px]" role="img" aria-label={`${runs.filter((r) => r.ok).length} of ${runs.length} recent runs succeeded`}>
              {runs.map((r) => (
                <span
                  key={r.startedAt}
                  title={`${fmt(r.startedAt)}: ${r.ok ? "ok" : r.finishedAt ? "failed" : "didn't finish"}`}
                  className={`h-3 w-3 rounded-[3px] ${r.ok ? "bg-success" : r.finishedAt ? "bg-danger" : "bg-border"}`}
                />
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="text-[13px] text-text-muted">No runs recorded yet. The first one shows up after its next scheduled time, or press Run now.</p>
      )}
      {job.state !== "unknown" && (
        <div className="mt-4 border-t border-border-soft pt-3">
          <RunJobButton job={job.job} />
        </div>
      )}
    </Card>
  );
}

// -------------------------------------------------------------- stuck items

function StuckSection({ groups, now, fmt }: { groups: StuckGroup[]; now: number; fmt: (iso: string) => string }) {
  const withItems = groups.filter((g) => g.items.length > 0 || g.error);
  const clear = groups.filter((g) => g.items.length === 0 && !g.error);
  return (
    <div className="space-y-4">
      {withItems.map((g) => (
        <Card
          key={g.key}
          title={g.title}
          subtitle={g.explainer}
          action={g.items.length > 0 ? <span className="shrink-0 rounded-full bg-danger-soft px-2.5 py-0.5 text-[12px] font-semibold text-danger">{g.items.length}</span> : undefined}
        >
          {g.error && <p className="mb-2 text-[12.5px] text-danger">Couldn&apos;t check: {g.error}</p>}
          <ul className="divide-y divide-border-soft">
            {g.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-ink">{item.title}</div>
                  <div className="mt-0.5 text-[12.5px] text-text-muted">{item.detail}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-text-faint">
                    <Link href={`/admin/businesses/${item.businessId}`} className="font-medium text-text-muted hover:text-brand-dark">{item.businessName}</Link>
                    <span title={fmt(item.since)}>{ago(item.since, now)}</span>
                    {item.link && (
                      <a href={item.link.href} target={item.link.external ? "_blank" : undefined} rel={item.link.external ? "noreferrer" : undefined} className="flex items-center gap-1 font-medium text-brand hover:underline">
                        {item.link.label} {item.link.external && <ExternalLink className="h-3 w-3" />}
                      </a>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  <StuckItemActions id={item.id} actions={item.actions} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {clear.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {clear.map((g) => (
            <span key={g.key} className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px] text-text-muted">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {g.title}: none
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------- alerts

const OUTCOME: Record<string, { label: string; className: string }> = {
  sent: { label: "Emailed", className: "bg-brand-soft text-brand-dark" },
  throttled: { label: "Held back", className: "bg-border-soft text-text-muted" },
  not_configured: { label: "Not emailed", className: "bg-amber-100 text-amber-700" },
  failed: { label: "Email failed", className: "bg-danger-soft text-danger" },
};

function AlertsSection({ alerts, now, fmt }: { alerts: HealthReport["alerts"]; now: number; fmt: (iso: string) => string }) {
  if (!alerts.available) {
    return (
      <Card title="Alerts">
        <p className="text-[13px] text-text-muted">Run migration 038 to keep a log of alerts here.</p>
      </Card>
    );
  }
  const bars: Bar[] = alerts.perDay.map((d, i) => {
    const date = new Date(`${d.day}T12:00:00Z`);
    return {
      key: d.day,
      label: i === alerts.perDay.length - 1 ? "Today" : WEEKDAYS[date.getUTCDay()],
      value: d.count,
      inProgress: i === alerts.perDay.length - 1,
      tooltip: [i === alerts.perDay.length - 1 ? "Today (UTC)" : d.day, `${d.count} alert${d.count === 1 ? "" : "s"}`],
    };
  });
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Alert volume" subtitle="Every alert, including ones held back by the 15-minute email limit">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">Last 24 hours</div>
            <div className="mt-1 font-display text-[24px] font-semibold leading-none text-ink">{alerts.last24h}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">Last 7 days</div>
            <div className="mt-1 font-display text-[24px] font-semibold leading-none text-ink">{alerts.last7d}</div>
          </div>
        </div>
        <div className="mt-5">
          <BarChart bars={bars} height={80} color="#DC2626" emphasisColor="#DC2626" ariaLabel={`Alerts per day, ${alerts.last7d} in the last 7 days`} />
        </div>
      </Card>

      <Card title="Most frequent this week" className="lg:col-span-2">
        {alerts.byKey.length === 0 ? (
          <p className="text-[13px] text-text-muted">No alerts in the last 7 days.</p>
        ) : (
          <ul className="space-y-2.5">
            {alerts.byKey.map((k) => (
              <li key={k.key}>
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-text">{k.subject}</span>
                  <span className="shrink-0 font-mono font-medium text-text">{k.count}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-border-soft">
                    <div className="h-full rounded-full bg-danger/70" style={{ width: `${(k.count / alerts.byKey[0].count) * 100}%` }} />
                  </div>
                  <span className="shrink-0 text-[11px] text-text-faint">latest {ago(k.lastAt, now)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {alerts.recent.length > 0 && (
        <Card title="Recent alerts" className="lg:col-span-3">
          <ul className="divide-y divide-border-soft">
            {alerts.recent.map((a, i) => {
              const o = OUTCOME[a.outcome] || { label: a.outcome, className: "bg-border-soft text-text-muted" };
              return (
                <li key={`${a.createdAt}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1 text-[13px] text-text">{a.subject}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${o.className}`}>{o.label}</span>
                  <span className="w-20 text-right text-[12px] text-text-faint sm:w-28" title={fmt(a.createdAt)}>{ago(a.createdAt, now)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

// -------------------------------------------------------------- setup

const CHECK: Record<CheckState, { icon: typeof CheckCircle2; className: string; label: string }> = {
  ok: { icon: CheckCircle2, className: "text-success", label: "OK" },
  warn: { icon: AlertTriangle, className: "text-amber-600", label: "Warning" },
  fail: { icon: XCircle, className: "text-danger", label: "Failing" },
  unknown: { icon: CircleSlash, className: "text-text-faint", label: "Unknown" },
};

function SetupSection({ checks }: { checks: SetupCheck[] }) {
  const groups = ["Keys", "Database", "Restaurants"] as const;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {groups.map((group) => {
        const items = checks.filter((c) => c.group === group);
        const failing = items.filter((c) => c.state === "fail").length;
        return (
          <Card
            key={group}
            title={group === "Keys" ? "Keys in Vercel" : group === "Database" ? "Database migrations" : "Restaurants"}
            subtitle={group === "Keys" ? "Only whether each is set. Values are never shown." : undefined}
            action={
              failing ? (
                <span className="shrink-0 rounded-full bg-danger-soft px-2.5 py-0.5 text-[12px] font-semibold text-danger">{failing} failing</span>
              ) : (
                <span className="shrink-0 rounded-full bg-success-soft px-2.5 py-0.5 text-[12px] font-semibold text-success">All good</span>
              )
            }
          >
            <ul className="space-y-2.5">
              {items.map((c) => {
                const s = CHECK[c.state];
                return (
                  <li key={c.id} className="flex items-start gap-2.5">
                    <s.icon className={`mt-0.5 h-4 w-4 shrink-0 ${s.className}`} aria-label={s.label} />
                    <div className="min-w-0">
                      <div className={`text-[12.5px] font-medium text-text ${group === "Keys" ? "break-all font-mono" : ""}`}>{c.label}</div>
                      <div className="text-[12px] text-text-muted">{c.detail}</div>
                      {c.action === "seal_tokens" && <div className="mt-2"><SealTokensButton /></div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------- page body

export function HealthView({ report, now, timeZone }: { report: HealthReport; now: number; timeZone: string }) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const fmt = (iso: string) => f.format(new Date(iso));
  const stuckCount = report.stuck.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <SectionTitle icon={Timer} title="Background jobs" />
      <div className="grid gap-6 lg:grid-cols-2">
        {report.jobs.jobs.map((j) => (
          <JobCard key={j.job} job={j} now={now} fmt={fmt} />
        ))}
      </div>

      <SectionTitle icon={Wrench} title="Stuck items" note={stuckCount ? `${stuckCount} need a person` : "Nothing stuck"} />
      <StuckSection groups={report.stuck} now={now} fmt={fmt} />

      <SectionTitle icon={Bell} title="Alerts" />
      <AlertsSection alerts={report.alerts} now={now} fmt={fmt} />

      <SectionTitle icon={ListChecks} title="Setup checks" />
      <SetupSection checks={report.setup} />
    </>
  );
}
