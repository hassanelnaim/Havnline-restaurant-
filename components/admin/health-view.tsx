import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight, CircleSlash, ExternalLink, Loader2, XCircle } from "lucide-react";
import { RunJobButton, SealTokensButton, StuckItemActions } from "@/components/admin/health-actions";
import type { CheckState, HealthReport, JobRun, JobState, JobStatus, SetupCheck, StuckAction, StuckGroup } from "@/lib/admin/health";

/**
 * The Health page, problems first: one "Needs you" list with everything a
 * person has to act on, then one quiet line each for jobs, alerts and
 * setup. Details stay folded until clicked.
 */

type Fmt = (iso: string) => string;

function ago(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const Chevron = () => <ChevronRight className="h-4 w-4 shrink-0 text-text-faint transition-transform group-open:rotate-90" />;

/** A row that unfolds; no JavaScript needed. */
function Fold({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 hover:bg-paper/60 [&::-webkit-details-marker]:hidden">
        {summary}
        <Chevron />
      </summary>
      <div className="border-t border-border-soft bg-paper/40 px-5 py-4">{children}</div>
    </details>
  );
}

function Dot({ tone }: { tone: "ok" | "warn" | "bad" | "off" }) {
  const c = tone === "ok" ? "bg-success" : tone === "warn" ? "bg-amber-500" : tone === "bad" ? "bg-danger" : "bg-border";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${c}`} aria-hidden />;
}

function Label({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-8 text-[11px] font-semibold uppercase tracking-wide text-text-faint">{children}</h2>;
}

// ------------------------------------------------------------ needs you

const GROUP_TAG: Record<StuckGroup["key"], string> = {
  unprinted: "Not printed",
  failed_tickets: "Failed ticket",
  bounced_texts: "Text bounced",
  paid_after_void: "Paid after void",
  disputes: "Dispute",
  stuck_calls: "Stuck call",
  fee_returns: "Fee to return",
  violations: "Possible violation",
};

interface NeedRow {
  key: string;
  tag: string;
  title: string;
  sub: React.ReactNode;
  action?: React.ReactNode;
  tone: "bad" | "warn";
}

const JOB_PROBLEM: Partial<Record<JobState, string>> = {
  failed: "last run failed",
  late: "hasn't run in over a day",
  never: "hasn't run yet",
  unknown: "can't be checked until migration 038 is run",
};

export function needsYouRows(report: HealthReport, now: number): NeedRow[] {
  const rows: NeedRow[] = [];

  for (const j of report.jobs.jobs) {
    const problem = JOB_PROBLEM[j.state];
    if (!problem) continue;
    rows.push({
      key: `job:${j.job}`,
      tag: "Job",
      title: `${j.label} ${problem}`,
      sub: j.lastRun ? `Last ran ${ago(j.lastRun.startedAt, now)}` : j.schedule,
      action: j.state === "unknown" ? undefined : <RunJobButton job={j.job} />,
      tone: "bad",
    });
  }

  for (const g of report.stuck) {
    if (g.error) rows.push({ key: `err:${g.key}`, tag: GROUP_TAG[g.key], title: `Couldn't check ${g.title.toLowerCase()}`, sub: g.error, tone: "warn" });
    for (const item of g.items) {
      rows.push({
        key: `${g.key}:${item.id}`,
        tag: GROUP_TAG[g.key],
        title: item.title,
        sub: (
          <>
            <Link href={`/admin/businesses/${item.businessId}`} className="font-medium text-text-muted hover:text-brand-dark">{item.businessName}</Link>
            {" · "}
            {item.detail}
            {" · "}
            {ago(item.since, now)}
            {item.link && (
              <>
                {" · "}
                <a href={item.link.href} target={item.link.external ? "_blank" : undefined} rel={item.link.external ? "noreferrer" : undefined} className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline">
                  {item.link.label} {item.link.external && <ExternalLink className="h-3 w-3" />}
                </a>
              </>
            )}
          </>
        ),
        action: <StuckItemActions id={item.id} actions={item.actions as StuckAction[]} />,
        tone: "bad",
      });
    }
  }

  for (const c of report.setup.filter((x) => x.state === "fail")) {
    rows.push({
      key: c.id,
      tag: "Setup",
      title: c.group === "Keys" ? `${c.label} isn't set` : c.label,
      sub: c.detail,
      action: c.action === "seal_tokens" ? <SealTokensButton /> : undefined,
      tone: "bad",
    });
  }
  return rows;
}

function NeedsYou({ rows }: { rows: NeedRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-success/25 bg-success-soft px-5 py-4">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
        <div>
          <div className="text-[14px] font-semibold text-success">Nothing needs you right now</div>
          <div className="text-[12.5px] text-text-muted">Jobs are on schedule, nothing is stuck, and setup checks pass.</div>
        </div>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border-soft overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 gap-3">
            <span className="mt-1.5"><Dot tone={r.tone} /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-medium text-ink">{r.title}</span>
                <span className="rounded-full bg-border-soft px-2 py-0.5 text-[10.5px] font-medium text-text-muted">{r.tag}</span>
              </div>
              <div className="mt-0.5 text-[12.5px] text-text-muted">{r.sub}</div>
            </div>
          </div>
          {r.action && <div className="shrink-0 pl-5 sm:pl-0">{r.action}</div>}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------ jobs

const JOB_TONE: Record<JobState, "ok" | "warn" | "bad" | "off"> = { ok: "ok", running: "warn", failed: "bad", late: "bad", never: "bad", unknown: "off" };

const RESULT_LABELS: Record<string, string> = {
  businessesChecked: "Restaurants due",
  emailsSent: "Emails sent",
  remaining: "Left for the next run",
  errors: "Errors",
  error: "Error",
};

function resultRows(result: Record<string, unknown> | null) {
  if (!result) return [];
  return Object.entries(result).map(([k, v]) => {
    const value = Array.isArray(v) ? (v.length ? v.join("; ") : "None") : String(v);
    const bad = (Array.isArray(v) && v.length > 0) || (typeof v === "string" && (v.startsWith("failed") || k === "error"));
    return { label: RESULT_LABELS[k] || k.charAt(0).toUpperCase() + k.slice(1), value, bad };
  });
}

function RunStrip({ history, fmt }: { history: JobRun[]; fmt: Fmt }) {
  const runs = [...history].reverse();
  return (
    <div className="hidden gap-[2px] md:flex" role="img" aria-label={`${runs.filter((r) => r.ok).length} of ${runs.length} recent runs succeeded`}>
      {runs.map((r) => (
        <span key={r.startedAt} title={`${fmt(r.startedAt)}: ${r.ok ? "ok" : r.finishedAt ? "failed" : "didn't finish"}`} className={`h-3.5 w-1.5 rounded-sm ${r.ok ? "bg-success" : r.finishedAt ? "bg-danger" : "bg-border"}`} />
      ))}
    </div>
  );
}

function JobRow({ job, now, fmt }: { job: JobStatus; now: number; fmt: Fmt }) {
  const last = job.lastRun;
  return (
    <Fold
      summary={
        <>
          <Dot tone={JOB_TONE[job.state]} />
          <span className="min-w-0 flex-1 text-[13.5px] font-medium text-ink">{job.label}</span>
          <span className="hidden text-[12.5px] text-text-muted sm:inline">
            {job.state === "running" ? (
              <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> running</span>
            ) : last ? (
              `ran ${ago(last.startedAt, now)}`
            ) : (
              "no runs yet"
            )}
          </span>
          <RunStrip history={job.history} fmt={fmt} />
          {job.state !== "unknown" && <RunJobButton job={job.job} />}
        </>
      }
    >
      <p className="text-[12.5px] text-text-muted">
        {job.schedule}.{" "}
        {last && (
          <>
            Last run {fmt(last.startedAt)}, {last.trigger === "manual" ? "started by hand" : "on schedule"}
            {last.finishedAt ? `, took ${((Date.parse(last.finishedAt) - Date.parse(last.startedAt)) / 1000).toFixed(1)} s.` : ", didn't finish."}
          </>
        )}
      </p>
      {last?.result && (
        <dl className="mt-3 grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
          {resultRows(last.result).map((r) => (
            <div key={r.label} className="flex justify-between gap-4 text-[12.5px]">
              <dt className="text-text-muted">{r.label}</dt>
              <dd className={`text-right font-mono ${r.bad ? "text-danger" : "text-text"}`}>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Fold>
  );
}

// ------------------------------------------------------------ alerts

const OUTCOME: Record<string, string> = { sent: "emailed", throttled: "held back", not_configured: "not emailed", failed: "email failed" };

function AlertsRow({ alerts, now }: { alerts: HealthReport["alerts"]; now: number }) {
  if (!alerts.available) {
    return <div className="px-5 py-4 text-[13px] text-text-muted">Run migration 038 to keep a log of alerts.</div>;
  }
  const max = Math.max(1, ...alerts.perDay.map((d) => d.count));
  return (
    <Fold
      summary={
        <>
          <Dot tone={alerts.last24h ? "warn" : "ok"} />
          <span className="min-w-0 flex-1 text-[13.5px] font-medium text-ink">
            {alerts.last24h} today <span className="font-normal text-text-muted">· {alerts.last7d} this week</span>
          </span>
          <div className="flex h-5 items-end gap-[2px]" role="img" aria-label={`Alerts per day this week: ${alerts.perDay.map((d) => d.count).join(", ")}`}>
            {alerts.perDay.map((d) => (
              <span key={d.day} title={`${d.day}: ${d.count}`} className="w-1.5 rounded-t-sm bg-danger/70" style={{ height: `${d.count ? Math.max(15, (d.count / max) * 100) : 6}%`, opacity: d.count ? 1 : 0.25 }} />
            ))}
          </div>
        </>
      }
    >
      {alerts.byKey.length === 0 ? (
        <p className="text-[12.5px] text-text-muted">No alerts in the last 7 days.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">Most frequent this week</div>
            <ul className="space-y-1.5">
              {alerts.byKey.slice(0, 5).map((k) => (
                <li key={k.key} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0 truncate text-text">{k.subject}</span>
                  <span className="shrink-0 font-mono text-text-muted">{k.count}×</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">Latest</div>
            <ul className="space-y-1.5">
              {alerts.recent.slice(0, 5).map((a, i) => (
                <li key={`${a.createdAt}-${i}`} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0 truncate text-text">{a.subject}</span>
                  <span className="shrink-0 text-text-faint">{OUTCOME[a.outcome] || a.outcome} · {ago(a.createdAt, now)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Fold>
  );
}

// ------------------------------------------------------------ setup

const CHECK_ICON: Record<CheckState, { icon: typeof CheckCircle2; className: string }> = {
  ok: { icon: CheckCircle2, className: "text-success" },
  warn: { icon: AlertTriangle, className: "text-amber-600" },
  fail: { icon: XCircle, className: "text-danger" },
  unknown: { icon: CircleSlash, className: "text-text-faint" },
};

const RANK: Record<CheckState, number> = { fail: 0, warn: 1, unknown: 2, ok: 3 };

function SetupRow({ checks }: { checks: SetupCheck[] }) {
  const passing = checks.filter((c) => c.state === "ok").length;
  const warnings = checks.filter((c) => c.state === "warn").length;
  const failing = checks.filter((c) => c.state === "fail").length;
  const groups = ["Keys", "Database", "Restaurants"] as const;
  return (
    <Fold
      summary={
        <>
          <Dot tone={failing ? "bad" : warnings ? "warn" : "ok"} />
          <span className="min-w-0 flex-1 text-[13.5px] font-medium text-ink">
            {passing} of {checks.length} checks passing
            {warnings > 0 && <span className="font-normal text-text-muted"> · {warnings} warning{warnings === 1 ? "" : "s"}</span>}
          </span>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-3">
        {groups.map((g) => (
          <div key={g}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">{g === "Keys" ? "Keys in Vercel (never shown)" : g}</div>
            <ul className="space-y-2">
              {checks
                .filter((c) => c.group === g)
                // Problems at the top of each column.
                .sort((a, b) => RANK[a.state] - RANK[b.state])
                .map((c) => {
                  const s = CHECK_ICON[c.state];
                  return (
                    <li key={c.id} className="flex gap-2" title={c.detail}>
                      <s.icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${s.className}`} />
                      <div className="min-w-0">
                        <div className={`text-[12.5px] text-text ${g === "Keys" ? "break-all font-mono text-[11.5px]" : ""}`}>{c.label}</div>
                        {c.state !== "ok" && <div className="text-[11.5px] text-text-muted">{c.detail}</div>}
                      </div>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </div>
    </Fold>
  );
}

// ------------------------------------------------------------ page body

export function HealthView({ report, now, timeZone }: { report: HealthReport; now: number; timeZone: string }) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const fmt: Fmt = (iso) => f.format(new Date(iso));
  const rows = needsYouRows(report, now);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-[24px] font-semibold text-ink">Health</h1>
        <span className={`flex items-center gap-2 rounded-full px-3 py-1 text-[12.5px] font-medium ${rows.length ? "bg-danger-soft text-danger" : "bg-success-soft text-success"}`}>
          <Dot tone={rows.length ? "bad" : "ok"} />
          {rows.length ? `${rows.length} thing${rows.length === 1 ? "" : "s"} need${rows.length === 1 ? "s" : ""} you` : "All clear"}
        </span>
      </div>

      {rows.length > 0 && <Label>Needs you</Label>}
      <div className={rows.length ? "" : "mt-6"}>
        <NeedsYou rows={rows} />
      </div>

      <Label>Background jobs</Label>
      <div className="divide-y divide-border-soft overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {report.jobs.jobs.map((j) => (
          <JobRow key={j.job} job={j} now={now} fmt={fmt} />
        ))}
      </div>

      <Label>Alerts</Label>
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <AlertsRow alerts={report.alerts} now={now} />
      </div>

      <Label>Setup</Label>
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        <SetupRow checks={report.setup} />
      </div>
    </>
  );
}
