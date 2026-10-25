import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { encryptionConfigured, isSealed } from "@/lib/security/secretBox";
import type { CronJob } from "@/lib/monitoring/cronRuns";

/**
 * Everything the admin Health page shows, read fresh on every render:
 * the background jobs, things stuck somewhere that need a person, the
 * platform alert log, and setup checks. Each part fails on its own: one
 * unreadable table shows as "couldn't check" in its own section instead
 * of taking the whole page down.
 */

// ---------------------------------------------------------------- jobs

export type JobState = "ok" | "failed" | "late" | "never" | "running" | "unknown";

export interface JobRun {
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  trigger: "schedule" | "manual";
  result: Record<string, unknown> | null;
}

export interface JobStatus {
  job: CronJob;
  label: string;
  schedule: string;
  state: JobState;
  lastRun: JobRun | null;
  /** Up to 14 most recent runs, newest first. */
  history: JobRun[];
}

const JOBS: { job: CronJob; label: string; schedule: string }[] = [
  { job: "cleanup", label: "Nightly cleanup", schedule: "Every night at 7:30 UTC" },
  { job: "weekly-digest", label: "Weekly digest emails", schedule: "Every day at 13:00 UTC, one email per restaurant per week" },
];

// Both jobs run daily; a little slack for Vercel starting a cron late.
const LATE_AFTER_MS = 26 * 60 * 60 * 1000;
// A run that started this long ago and never finished was cut off.
const CUT_OFF_AFTER_MS = 5 * 60 * 1000;

export function jobStateOf(history: JobRun[], now = Date.now()): JobState {
  const last = history[0];
  if (!last) return "never";
  const startedMs = Date.parse(last.startedAt);
  if (!last.finishedAt) return now - startedMs < CUT_OFF_AFTER_MS ? "running" : "failed";
  if (last.ok === false) return "failed";
  // Late is about the schedule: a manual run doesn't stand in for it.
  const lastScheduled = history.find((r) => r.trigger === "schedule");
  if (!lastScheduled || now - Date.parse(lastScheduled.startedAt) > LATE_AFTER_MS) return "late";
  return "ok";
}

export async function getJobStatuses(): Promise<{ jobs: JobStatus[]; available: boolean }> {
  const admin = createAdminClient();
  const results = await Promise.all(
    JOBS.map(async (j) => {
      const { data, error } = await admin
        .from("cron_runs")
        .select("started_at, finished_at, ok, trigger, result")
        .eq("job", j.job)
        .order("started_at", { ascending: false })
        .limit(14);
      if (error) return null;
      const history: JobRun[] = (data || []).map((r) => ({
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        ok: r.ok,
        trigger: r.trigger,
        result: r.result,
      }));
      return { ...j, history, lastRun: history[0] || null, state: jobStateOf(history) } as JobStatus;
    })
  );
  if (results.some((r) => r === null)) {
    return { jobs: JOBS.map((j) => ({ ...j, history: [], lastRun: null, state: "unknown" as const })), available: false };
  }
  return { jobs: results as JobStatus[], available: true };
}

// ---------------------------------------------------------- stuck items

export type StuckAction = "retry_print" | "queue_print" | "mark_handled" | "refund" | "close_call" | "return_fee" | "dismiss_flag";

export interface StuckItem {
  id: string;
  businessId: string;
  businessName: string;
  title: string;
  detail: string;
  /** When the thing got stuck (ISO). */
  since: string;
  actions: StuckAction[];
  link?: { href: string; label: string; external?: boolean };
}

export interface StuckGroup {
  key: "unprinted" | "failed_tickets" | "bounced_texts" | "paid_after_void" | "disputes" | "stuck_calls" | "fee_returns" | "violations";
  title: string;
  explainer: string;
  items: StuckItem[];
  error?: string;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const STUCK_CALL_MS = 30 * 60 * 1000; // calls are capped at 25 minutes
const OPEN_DISPUTE = ["warning_needs_response", "warning_under_review", "needs_response", "under_review"];

const money = (cents: number | null | undefined) => `$${((cents || 0) / 100).toFixed(2)}`;
const shortId = (id: string) => `#${id.slice(0, 8).toUpperCase()}`;
const customer = (name: string | null, phone: string | null) => [name || "Unnamed customer", phone].filter(Boolean).join(" · ");

export function stripeAccountLink(accountId: string | null | undefined): StuckItem["link"] | undefined {
  if (!accountId) return undefined;
  return { href: `https://dashboard.stripe.com/connect/accounts/${accountId}`, label: "Open in Stripe", external: true };
}

export async function getStuckItems(): Promise<StuckGroup[]> {
  const admin = createAdminClient();
  const now = Date.now();
  const fiveMinAgo = new Date(now - FIVE_MINUTES_MS).toISOString();
  const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

  const [pendingJobs, unqueuedOrders, failedJobs, bounced, paidVoid, disputes, calls, feesOwed, flags] = await Promise.all([
    admin.from("printer_print_jobs").select("id, business_id, order_id, kind, created_at, attempts, error").eq("status", "pending").lt("created_at", fiveMinAgo).order("created_at").limit(100),
    // Paid, at a restaurant with a kitchen tablet, but never queued (the
    // queue step failed, or the payment webhook died part way).
    admin.from("orders").select("id, business_id, customer_name, phone, total_cents, submit_error, created_at").eq("status", "confirmed").eq("payment_status", "paid").lt("created_at", fiveMinAgo).gte("created_at", twoDaysAgo).order("created_at").limit(100),
    failedTicketsQuery(),
    admin.from("orders").select("id, business_id, customer_name, phone, total_cents, payment_link_sms_status, payment_link_sms_error, created_at").in("payment_link_sms_status", ["undelivered", "failed"]).eq("payment_status", "awaiting_payment").neq("status", "cancelled").gte("created_at", twoDaysAgo).order("created_at", { ascending: false }).limit(100),
    admin.from("orders").select("id, business_id, customer_name, phone, total_cents, created_at").eq("status", "cancelled").eq("payment_status", "paid").order("created_at", { ascending: false }).limit(100),
    admin.from("orders").select("id, business_id, customer_name, phone, total_cents, dispute_status, created_at").in("dispute_status", OPEN_DISPUTE).order("created_at", { ascending: false }).limit(100),
    admin.from("calls").select("id, business_id, phone, started_at").eq("status", "in_progress").lt("started_at", new Date(now - STUCK_CALL_MS).toISOString()).order("started_at").limit(200),
    feesOwedQuery(),
    openFlagsQuery(),
  ]);

  const businessIds = new Set<string>();
  for (const res of [pendingJobs, unqueuedOrders, failedJobs, bounced, paidVoid, disputes, calls, feesOwed, flags]) {
    for (const row of (res.data || []) as { business_id: string }[]) businessIds.add(row.business_id);
  }
  const { data: businesses } = businessIds.size
    ? await admin.from("businesses").select("id, name, printer_app_paired_at, stripe_connect_account_id").in("id", Array.from(businessIds))
    : { data: [] as { id: string; name: string; printer_app_paired_at: string | null; stripe_connect_account_id: string | null }[] };
  const byId = new Map((businesses || []).map((b) => [b.id, b]));
  const nameOf = (id: string) => byId.get(id)?.name || "Unknown business";

  // When each tablet last checked in: the usual reason tickets wait.
  const jobBusinessIds = Array.from(new Set((pendingJobs.data || []).map((j) => j.business_id)));
  const { data: devices } = jobBusinessIds.length
    ? await admin.from("printer_devices").select("business_id, last_seen_at").in("business_id", jobBusinessIds)
    : { data: [] as { business_id: string; last_seen_at: string | null }[] };
  const lastSeen = new Map((devices || []).map((d) => [d.business_id, d.last_seen_at]));

  const unprinted: StuckItem[] = [
    ...(pendingJobs.data || []).map((j) => {
      const seen = lastSeen.get(j.business_id);
      const tablet = seen ? `Tablet last checked in ${agoText(seen, now)}.` : "No tablet has checked in.";
      return {
        id: j.id,
        businessId: j.business_id,
        businessName: nameOf(j.business_id),
        title: `${j.kind === "addendum" ? "Added items for order" : "Order"} ${shortId(j.order_id)} waiting to print`,
        detail: [tablet, j.attempts ? `${j.attempts} failed tr${j.attempts === 1 ? "y" : "ies"}${j.error ? `: ${j.error}` : ""}.` : ""].filter(Boolean).join(" "),
        since: j.created_at,
        actions: ["retry_print"] as StuckAction[],
      };
    }),
    ...(unqueuedOrders.data || [])
      .filter((o) => byId.get(o.business_id)?.printer_app_paired_at)
      .map((o) => ({
        id: o.id,
        businessId: o.business_id,
        businessName: nameOf(o.business_id),
        title: `Order ${shortId(o.id)} paid but never sent to the kitchen`,
        detail: `${customer(o.customer_name, o.phone)} · ${money(o.total_cents)}${o.submit_error ? ` · ${o.submit_error}` : ""}`,
        since: o.created_at,
        actions: ["queue_print"] as StuckAction[],
      })),
  ];

  const failedTickets: StuckItem[] = (failedJobs.data || []).map((j) => ({
    id: j.id,
    businessId: j.business_id,
    businessName: nameOf(j.business_id),
    title: `${j.kind === "addendum" ? "Added items for order" : "Order"} ${shortId(j.order_id)} didn't print`,
    detail: `Gave up after ${j.attempts || 1} tr${(j.attempts || 1) === 1 ? "y" : "ies"}${j.error ? `: ${j.error}` : ""}. The restaurant was emailed.`,
    since: j.created_at,
    actions: ["retry_print", "mark_handled"] as StuckAction[],
  }));

  const bouncedTexts: StuckItem[] = (bounced.data || []).map((o) => ({
    id: o.id,
    businessId: o.business_id,
    businessName: nameOf(o.business_id),
    title: `Payment link didn't reach ${customer(o.customer_name, o.phone)}`,
    detail: `${money(o.total_cents)} unpaid · ${o.payment_link_sms_error || `Text ${o.payment_link_sms_status}`}`,
    since: o.created_at,
    actions: [],
    link: { href: `/admin/businesses/${o.business_id}`, label: "Business" },
  }));

  const paidAfterVoid: StuckItem[] = (paidVoid.data || []).map((o) => ({
    id: o.id,
    businessId: o.business_id,
    businessName: nameOf(o.business_id),
    title: `Order ${shortId(o.id)} paid after it was voided`,
    detail: `${customer(o.customer_name, o.phone)} · ${money(o.total_cents)} collected, not sent to the kitchen`,
    since: o.created_at,
    actions: ["refund"] as StuckAction[],
    link: stripeAccountLink(byId.get(o.business_id)?.stripe_connect_account_id),
  }));

  const openDisputes: StuckItem[] = (disputes.data || []).map((o) => ({
    id: o.id,
    businessId: o.business_id,
    businessName: nameOf(o.business_id),
    title: `Dispute on order ${shortId(o.id)}`,
    detail: `${customer(o.customer_name, o.phone)} · ${money(o.total_cents)} · ${String(o.dispute_status).replace(/_/g, " ")}`,
    since: o.created_at,
    actions: [],
    link: stripeAccountLink(byId.get(o.business_id)?.stripe_connect_account_id),
  }));

  const stuckCalls: StuckItem[] = (calls.data || []).map((c) => ({
    id: c.id,
    businessId: c.business_id,
    businessName: nameOf(c.business_id),
    title: `Call from ${c.phone || "unknown number"} still marked in progress`,
    detail: `Started ${agoText(c.started_at, now)}. Twilio's call-ended report never arrived.`,
    since: c.started_at,
    actions: ["close_call"] as StuckAction[],
  }));

  const feeReturns: StuckItem[] = (feesOwed.data || []).map((o) => ({
    id: o.id,
    businessId: o.business_id,
    businessName: nameOf(o.business_id),
    title: `Return ${money(o.fee_return_owed_cents)} fee on order ${shortId(o.id)}`,
    detail: `Refunded in the restaurant's Stripe dashboard (${money(o.amount_refunded_cents)} of ${money(o.total_cents)}), so HavnLine's fee wasn't given back automatically.`,
    since: o.refunded_at || o.created_at,
    actions: ["return_fee"] as StuckAction[],
  }));

  const violations: StuckItem[] = (flags.data || []).map((f) => ({
    id: f.id,
    businessId: f.business_id,
    businessName: nameOf(f.business_id),
    title: f.title,
    detail: [f.evidence, f.detail].filter(Boolean).join(" · "),
    since: f.created_at,
    actions: ["dismiss_flag"] as StuckAction[],
  }));

  const err = (res: { error: { message: string } | null }) => (res.error ? res.error.message : undefined);
  return [
    { key: "violations", title: "Possible violations", explainer: "Signs a restaurant may be breaking the Terms. Review each one, contact the restaurant if needed, then dismiss it.", items: violations, error: err(flags) },
    { key: "unprinted", title: "Paid but not printed", explainer: "Paid orders that haven't reached the kitchen printer after 5 minutes.", items: unprinted, error: err(pendingJobs) || err(unqueuedOrders) },
    { key: "failed_tickets", title: "Failed tickets", explainer: "Tickets the tablet gave up on after 4 tries.", items: failedTickets, error: err(failedJobs) },
    { key: "bounced_texts", title: "Payment links that didn't arrive", explainer: "The carrier rejected the text in the last 2 days and the order is still unpaid. Call the customer.", items: bouncedTexts, error: err(bounced) },
    { key: "paid_after_void", title: "Paid after voiding", explainer: "The customer paid after the restaurant voided the order. Refund them unless the restaurant made it.", items: paidAfterVoid, error: err(paidVoid) },
    { key: "disputes", title: "Open disputes", explainer: "The customer's bank is disputing the charge. The restaurant answers in Stripe before the deadline.", items: openDisputes, error: err(disputes) },
    { key: "fee_returns", title: "Fees to return", explainer: "Orders refunded outside HavnLine. Refunds made in HavnLine return the fee automatically.", items: feeReturns, error: err(feesOwed) },
    { key: "stuck_calls", title: "Calls stuck in progress", explainer: "Calls marked live for over 30 minutes (the cap is 25). The nightly cleanup closes them after 2 hours.", items: stuckCalls, error: err(calls) },
  ];
}

/** Compliance findings not yet dismissed. Before migration 042 the table doesn't exist, and there's nothing to show. */
async function openFlagsQuery() {
  const res = await createAdminClient()
    .from("compliance_flags")
    .select("id, business_id, title, detail, evidence, created_at")
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (res.error && /compliance_flags/.test(res.error.message)) return { data: [], error: null };
  return res;
}

/** Orders with a fee still to give back. Before migration 041 the column doesn't exist, and there's nothing to show. */
async function feesOwedQuery() {
  const res = await createAdminClient()
    .from("orders")
    .select("id, business_id, total_cents, amount_refunded_cents, fee_return_owed_cents, refunded_at, created_at")
    .gt("fee_return_owed_cents", 0)
    .order("created_at", { ascending: false })
    .limit(100);
  if (res.error && /fee_return_owed_cents/.test(res.error.message)) return { data: [], error: null };
  return res;
}

/** Failed, not yet handled. Before migration 038 there's no handled_at column, so every failed ticket shows. */
async function failedTicketsQuery() {
  const admin = createAdminClient();
  const cols = "id, business_id, order_id, kind, created_at, attempts, error";
  const res = await admin.from("printer_print_jobs").select(cols).eq("status", "failed").is("handled_at", null).order("created_at", { ascending: false }).limit(100);
  if (!res.error) return res;
  return admin.from("printer_print_jobs").select(cols).eq("status", "failed").order("created_at", { ascending: false }).limit(100);
}

function agoText(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// --------------------------------------------------------------- alerts

export interface AlertSummary {
  available: boolean;
  last24h: number;
  last7d: number;
  /** Alert kinds in the last 7 days, most frequent first. */
  byKey: { key: string; subject: string; count: number; lastAt: string }[];
  /** Per day for the last 7 days, oldest first. */
  perDay: { day: string; count: number }[];
  recent: { subject: string; outcome: string; createdAt: string }[];
}

export async function getAlertSummary(): Promise<AlertSummary> {
  const admin = createAdminClient();
  const now = Date.now();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await fetchAllRows<{ key: string; subject: string; outcome: string; created_at: string }>((from, to) =>
    admin.from("platform_alerts").select("key, subject, outcome, created_at").gte("created_at", weekAgo).order("created_at", { ascending: false }).range(from, to)
  );
  if (error) return { available: false, last24h: 0, last7d: 0, byKey: [], perDay: [], recent: [] };
  const rows = data || [];
  const dayAgo = now - 24 * 60 * 60 * 1000;

  const groups = new Map<string, { key: string; subject: string; count: number; lastAt: string }>();
  for (const r of rows) {
    const g = groups.get(r.key);
    if (g) g.count += 1;
    else groups.set(r.key, { key: r.key, subject: r.subject, count: 1, lastAt: r.created_at });
  }

  const perDay: { day: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    perDay.push({ day, count: rows.filter((r) => r.created_at.slice(0, 10) === day).length });
  }

  return {
    available: true,
    last24h: rows.filter((r) => Date.parse(r.created_at) >= dayAgo).length,
    last7d: rows.length,
    byKey: Array.from(groups.values()).sort((a, b) => b.count - a.count).slice(0, 10),
    perDay,
    recent: rows.slice(0, 15).map((r) => ({ subject: r.subject, outcome: r.outcome, createdAt: r.created_at })),
  };
}

// --------------------------------------------------------- setup checks

export type CheckState = "ok" | "warn" | "fail" | "unknown";

export interface SetupCheck {
  id: string;
  group: "Keys" | "Database" | "Restaurants";
  label: string;
  state: CheckState;
  detail: string;
  action?: "seal_tokens";
}

// Names only: values are never read into the page.
const REQUIRED_ENV: { name: string; what: string }[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", what: "Database address" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", what: "Database server key" },
  { name: "NEXT_PUBLIC_SITE_URL", what: "Your site address. Twilio sends every call here" },
  { name: "ANTHROPIC_API_KEY", what: "The AI" },
  { name: "ELEVENLABS_API_KEY", what: "The voice" },
  { name: "TWILIO_ACCOUNT_SID", what: "Phone numbers" },
  { name: "TWILIO_AUTH_TOKEN", what: "Phone numbers" },
  { name: "STRIPE_SECRET_KEY", what: "Subscriptions and payments" },
  { name: "STRIPE_PRICE_ID", what: "The subscription price" },
  { name: "STRIPE_WEBHOOK_SECRET", what: "Subscription events from Stripe" },
  { name: "STRIPE_CONNECT_WEBHOOK_SECRET", what: "Phone-order payment events from Stripe" },
  { name: "RESEND_API_KEY", what: "All emails, including these alerts" },
  { name: "CRON_SECRET", what: "Lets the nightly jobs run" },
  { name: "PLATFORM_ADMIN_EMAIL", what: "Who gets alerts and sees this page" },
  { name: "SECRETS_ENCRYPTION_KEY", what: "Encrypts restaurants' Twilio tokens" },
];

const MIGRATIONS: { key: string; label: string }[] = [
  { key: "m032", label: "032 lock down client access" },
  { key: "m033", label: "033 payment and print safety" },
  { key: "m034", label: "034 atomic rate limits" },
  { key: "m035", label: "035 hashed tablet tokens" },
  { key: "m036", label: "036 scale batch" },
  { key: "m037", label: "037 leftovers" },
  { key: "m038", label: "038 admin health" },
  { key: "m039", label: "039 transcript retention" },
  { key: "m040", label: "040 consent records" },
  { key: "m041", label: "041 platform fee returns" },
  { key: "m042", label: "042 compliance checks" },
];

export async function getSetupChecks(): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [];

  for (const env of REQUIRED_ENV) {
    const set = Boolean(process.env[env.name]?.trim());
    checks.push({ id: `env:${env.name}`, group: "Keys", label: env.name, state: set ? "ok" : "fail", detail: set ? env.what : `Missing. ${env.what} won't work.` });
  }
  if (process.env.SECRETS_ENCRYPTION_KEY && !encryptionConfigured()) {
    const c = checks.find((x) => x.id === "env:SECRETS_ENCRYPTION_KEY")!;
    c.state = "fail";
    c.detail = "Set, but too short to use (at least 16 characters).";
  }
  checks.push({
    id: "env:SIGNING_SECRET",
    group: "Keys",
    label: "SIGNING_SECRET",
    state: process.env.SIGNING_SECRET ? "ok" : "warn",
    detail: process.env.SIGNING_SECRET ? "Signs call links." : "Optional. Call links are signed with the database server key instead, so rotating that key also breaks calls in progress.",
  });
  checks.push({
    id: "env:NEXT_PUBLIC_APP_URL",
    group: "Keys",
    label: "NEXT_PUBLIC_APP_URL",
    state: process.env.NEXT_PUBLIC_APP_URL ? "ok" : "warn",
    detail: process.env.NEXT_PUBLIC_APP_URL
      ? "Address used for the links in emails."
      : "Optional. Links in emails point to https://havnline.com without it.",
  });
  // A test-mode Stripe key takes "payments" that never charge anyone.
  if ((process.env.STRIPE_SECRET_KEY || "").startsWith("sk_test_")) {
    const c = checks.find((x) => x.id === "env:STRIPE_SECRET_KEY");
    if (c) {
      c.state = "fail";
      c.detail = "This is a Stripe test-mode key: no real money is collected. Use the live key (sk_live_…) before selling.";
    }
  }
  if (process.env.DEMO_CALLER_NUMBERS) {
    checks.push({ id: "env:DEMO_CALLER_NUMBERS", group: "Keys", label: "DEMO_CALLER_NUMBERS", state: "warn", detail: "No longer used. You can delete it from Vercel." });
  }

  const admin = createAdminClient();
  const { data: schema, error: schemaError } = await admin.rpc("admin_schema_check");
  if (schemaError || !schema) {
    checks.push({ id: "db:038", group: "Database", label: "038 admin health", state: "fail", detail: "Not run yet, so the other migrations can't be checked. Run 038 in the Supabase SQL editor." });
  } else {
    const s = schema as Record<string, unknown>;
    for (const m of MIGRATIONS) {
      checks.push({ id: `db:${m.key}`, group: "Database", label: m.label, state: s[m.key] ? "ok" : "fail", detail: s[m.key] ? "Applied" : "Not applied. Run it in the Supabase SQL editor." });
    }
    const noRls = Array.isArray(s.tables_without_rls) ? (s.tables_without_rls as string[]) : [];
    checks.push({
      id: "db:rls",
      group: "Database",
      label: "Row level security on every table",
      state: noRls.length ? "fail" : "ok",
      detail: noRls.length ? `Off on: ${noRls.join(", ")}. Anyone with the public key can read those.` : "On for every table.",
    });
  }

  // Twilio tokens still in plain text, and restaurants answering calls
  // that can't text payment links.
  const [twilio, sms, ai] = await Promise.all([
    fetchAllRows<{ business_id: string; status: string; metadata: Record<string, unknown> | null }>((from, to) =>
      admin.from("integrations").select("business_id, status, metadata").eq("provider", "twilio").order("business_id").range(from, to)
    ),
    fetchAllRows<{ business_id: string }>((from, to) => admin.from("integrations").select("business_id").eq("provider", "sms").eq("status", "connected").order("business_id").range(from, to)),
    fetchAllRows<{ business_id: string }>((from, to) => admin.from("ai_receptionists").select("business_id").eq("status", "online").order("business_id").range(from, to)),
  ]);

  if (twilio.error) {
    checks.push({ id: "tw:sealed", group: "Restaurants", label: "Twilio tokens encrypted", state: "unknown", detail: `Couldn't check: ${twilio.error.message}` });
  } else {
    const plain = (twilio.data || []).filter((r) => {
      const token = r.metadata?.subaccount_auth_token;
      return typeof token === "string" && token.length > 0 && !isSealed(token);
    }).length;
    checks.push({
      id: "tw:sealed",
      group: "Restaurants",
      label: "Twilio tokens encrypted",
      state: plain ? "fail" : "ok",
      detail: plain ? `${plain} restaurant${plain === 1 ? "" : "s"} still stored in plain text.` : "Every stored token is encrypted.",
      action: plain && encryptionConfigured() ? "seal_tokens" : undefined,
    });
  }

  // EINs are encrypted when saved; ones saved before that are sealed by the same button.
  const eins = await fetchAllRows<{ ein: string | null }>((from, to) => admin.from("businesses").select("ein").not("ein", "is", null).order("id").range(from, to));
  if (!eins.error) {
    const plainEins = eins.data.filter((b) => b.ein && !isSealed(b.ein)).length;
    checks.push({
      id: "ein:sealed",
      group: "Restaurants",
      label: "EINs encrypted",
      state: plainEins ? "fail" : "ok",
      detail: plainEins ? `${plainEins} restaurant${plainEins === 1 ? "" : "s"}' EIN still stored in plain text.` : "Every stored EIN is encrypted.",
      action: plainEins && encryptionConfigured() ? "seal_tokens" : undefined,
    });
  }

  if (twilio.error || sms.error || ai.error) {
    checks.push({ id: "tw:texting", group: "Restaurants", label: "Texting approved where calls are on", state: "unknown", detail: "Couldn't check." });
  } else {
    const approved = new Set((sms.data || []).map((r) => r.business_id));
    const online = new Set((ai.data || []).map((r) => r.business_id));
    const missing = (twilio.data || []).filter((r) => r.status === "connected" && online.has(r.business_id) && !approved.has(r.business_id)).map((r) => r.business_id);
    let names: string[] = [];
    if (missing.length) {
      const { data } = await admin.from("businesses").select("name").in("id", missing.slice(0, 20));
      names = (data || []).map((b) => b.name);
    }
    checks.push({
      id: "tw:texting",
      group: "Restaurants",
      label: "Texting approved where calls are on",
      state: missing.length ? "warn" : "ok",
      detail: missing.length
        ? `${missing.length} answering calls without texting approval, so they can't text payment links: ${names.join(", ")}${missing.length > names.length ? "…" : ""}`
        : "Every restaurant answering calls can text.",
    });
  }

  return checks;
}

// -------------------------------------------------------------- summary

export interface HealthReport {
  jobs: { jobs: JobStatus[]; available: boolean };
  stuck: StuckGroup[];
  alerts: AlertSummary;
  setup: SetupCheck[];
}

export async function getHealthReport(): Promise<HealthReport> {
  const [jobs, stuck, alerts, setup] = await Promise.all([getJobStatuses(), getStuckItems(), getAlertSummary(), getSetupChecks()]);
  return { jobs, stuck, alerts, setup };
}

export interface HealthCounts {
  jobsFailing: number;
  stuckItems: number;
  setupFailing: number;
  alerts24h: number;
}

export function healthCounts(r: HealthReport): HealthCounts {
  return {
    jobsFailing: r.jobs.jobs.filter((j) => j.state === "failed" || j.state === "late" || j.state === "never" || j.state === "unknown").length,
    stuckItems: r.stuck.reduce((n, g) => n + g.items.length, 0),
    setupFailing: r.setup.filter((c) => c.state === "fail").length,
    alerts24h: r.alerts.last24h,
  };
}
