import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import { sendPlatformAlert } from "@/lib/monitoring/platformAlert";
import { sumCallSeconds, sumUsageCostsByProvider } from "@/lib/usage/costTotals";
import { MONTHLY_PRICE_CENTS } from "@/lib/billing/constants";
import { findBadInstructions, findCallerComplaints } from "@/lib/compliance/patterns";

/**
 * HavnLine's compliance checks: signs that a restaurant may be breaking the
 * Terms (misusing callers' numbers, telling the AI to do something it
 * mustn't, or abusing the Service). Each finding is saved once
 * (compliance_flags, migration 042), listed on the admin Health page, and
 * emailed to the platform admin. A finding is a reason to look, never proof.
 */

export type FlagKind = "caller_complaint" | "ai_instruction" | "chargebacks" | "stripe_refunds" | "cost_over_price";

interface NewFlag {
  businessId: string;
  kind: FlagKind;
  dedupeKey: string;
  title: string;
  detail: string;
  evidence?: string | null;
  callId?: string | null;
}

const KIND_SUBJECT: Record<FlagKind, string> = {
  caller_complaint: "a caller complained about being contacted",
  ai_instruction: "a restaurant gave the AI an instruction that breaks the Terms",
  chargebacks: "a restaurant has repeated chargebacks",
  stripe_refunds: "a restaurant is refunding orders outside HavnLine",
  cost_over_price: "a restaurant is costing more than it pays",
};

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

/** Saves a finding once. Returns true if it's new (and emails about it). */
export async function recordFlag(flag: NewFlag): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.from("compliance_flags").insert({
    business_id: flag.businessId,
    kind: flag.kind,
    dedupe_key: flag.dedupeKey.slice(0, 300),
    title: flag.title.slice(0, 300),
    detail: flag.detail.slice(0, 1000),
    evidence: flag.evidence ? flag.evidence.slice(0, 1000) : null,
    call_id: flag.callId ?? null,
  });
  if (error) {
    if ((error as { code?: string }).code !== "23505") console.error("[compliance] could not save a finding (run migration 042):", error.message);
    return false;
  }

  const { data: business } = await admin.from("businesses").select("name").eq("id", flag.businessId).maybeSingle();
  const name = business?.name || "A restaurant";
  // One email per restaurant per kind of problem per hour; every finding
  // is still listed on the Health page.
  await sendPlatformAlert({
    key: `violation:${flag.kind}:${flag.businessId}`,
    subject: `HavnLine: ${KIND_SUBJECT[flag.kind]} (${name})`,
    heading: flag.title,
    intro: `${flag.detail} Open the Health page to review it and dismiss it once you've dealt with it.`,
    rows: [
      { label: "Restaurant", value: name },
      ...(flag.evidence ? [{ label: "What was found", value: flag.evidence }] : []),
    ],
    throttleMinutes: 60,
  });
  return true;
}

// ------------------------------------------------------------ callers

/**
 * Checks what a caller just said for signs the restaurant has been calling
 * or texting them outside their order. Runs after each caller turn on a
 * real call; never slows the call down (the caller hears nothing different).
 */
export async function checkCallerWords(businessId: string, callId: string, text: string): Promise<void> {
  const hits = findCallerComplaints(text);
  if (hits.length === 0) return;
  const admin = createAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("compliance_flags")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("kind", "caller_complaint")
    .gte("created_at", since);
  const earlier = count || 0;
  const hit = hits[0];
  await recordFlag({
    businessId,
    kind: "caller_complaint",
    dedupeKey: `caller_complaint:${callId}`,
    title: `A caller ${hit.label}`,
    detail:
      (earlier > 0
        ? `This is complaint number ${earlier + 1} at this restaurant in the last 30 days. Several from different callers is a strong sign it's using callers' numbers for something other than their orders.`
        : "One complaint can be a misunderstanding; several from different callers is a strong sign the restaurant is using callers' numbers for something other than their orders.") +
      " Calling a customer back about their own order is allowed.",
    evidence: `Caller said: "${text.slice(0, 300)}"`,
    callId,
  });
}

// ------------------------------------------------------------ instructions

interface TextSource {
  businessId: string;
  where: string;
  id: string;
  text: string;
}

async function instructionSources(businessId?: string): Promise<TextSource[]> {
  const admin = createAdminClient();
  const [knowledge, ai, businesses, menu] = await Promise.all([
    fetchAllRows<{ id: string; business_id: string; title: string | null; question: string | null; content: string }>((from, to) => {
      let q = admin.from("knowledge_items").select("id, business_id, title, question, content");
      if (businessId) q = q.eq("business_id", businessId);
      return q.order("id").range(from, to);
    }),
    fetchAllRows<{ id: string; business_id: string; escalation_rules: string | null; ordering_rules: string | null }>((from, to) => {
      let q = admin.from("ai_receptionists").select("id, business_id, escalation_rules, ordering_rules");
      if (businessId) q = q.eq("business_id", businessId);
      return q.order("id").range(from, to);
    }),
    fetchAllRows<{ id: string; description: string | null }>((from, to) => {
      let q = admin.from("businesses").select("id, description");
      if (businessId) q = q.eq("id", businessId);
      return q.order("id").range(from, to);
    }),
    fetchAllRows<{ id: string; business_id: string; name: string; description: string | null }>((from, to) => {
      let q = admin.from("menu_items").select("id, business_id, name, description").not("description", "is", null);
      if (businessId) q = q.eq("business_id", businessId);
      return q.order("id").range(from, to);
    }),
  ]);
  const out: TextSource[] = [];
  for (const k of knowledge.data) out.push({ businessId: k.business_id, where: `Knowledge: ${k.title || k.question || "item"}`, id: k.id, text: [k.question, k.title, k.content].filter(Boolean).join("\n") });
  for (const a of ai.data) {
    if (a.ordering_rules) out.push({ businessId: a.business_id, where: "AI ordering rules", id: `${a.id}:ordering`, text: a.ordering_rules });
    if (a.escalation_rules) out.push({ businessId: a.business_id, where: "AI escalation rules", id: `${a.id}:escalation`, text: a.escalation_rules });
  }
  for (const b of businesses.data) if (b.description) out.push({ businessId: b.id, where: "Business description", id: b.id, text: b.description });
  for (const m of menu.data) if (m.description) out.push({ businessId: m.business_id, where: `Menu item: ${m.name}`, id: m.id, text: m.description });
  return out;
}

/** Scans what restaurants tell the AI. With a businessId, just that restaurant (after it saves something). */
export async function scanInstructions(businessId?: string): Promise<number> {
  const sources = await instructionSources(businessId);
  let found = 0;
  for (const s of sources) {
    for (const hit of findBadInstructions(s.text)) {
      const isNew = await recordFlag({
        businessId: s.businessId,
        kind: "ai_instruction",
        // A changed text is a new finding; the same text isn't flagged twice.
        dedupeKey: `ai_instruction:${s.id}:${hit.rule}:${hash(s.text)}`,
        title: `${s.where} ${hit.label}`,
        detail: "The AI won't follow instructions that break its safety rules, but this shows what the restaurant wants it to do. Ask them to remove it.",
        evidence: hit.snippet,
      });
      if (isNew) found += 1;
    }
  }
  return found;
}

// ------------------------------------------------------------ business signals

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

/** Chargebacks, refunds made outside HavnLine, and cost against what the restaurant pays. */
export async function checkBusinessSignals(): Promise<number> {
  const admin = createAdminClient();
  const now = Date.now();
  const days = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();
  let found = 0;

  const [disputes, stripeRefunds, businesses] = await Promise.all([
    fetchAllRows<{ business_id: string }>((from, to) =>
      admin.from("orders").select("business_id").not("dispute_status", "is", null).gte("created_at", days(60)).order("id").range(from, to)
    ),
    fetchAllRows<{ business_id: string }>((from, to) =>
      admin.from("orders").select("business_id").eq("refund_reason", "Refunded in Stripe").gte("refunded_at", days(30)).order("id").range(from, to)
    ),
    fetchAllRows<{ id: string; subscription_status: string }>((from, to) => admin.from("businesses").select("id, subscription_status").order("id").range(from, to)),
  ]);

  const countBy = (rows: { business_id: string }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.business_id, (m.get(r.business_id) || 0) + 1);
    return m;
  };

  for (const [businessId, n] of countBy(disputes.data)) {
    if (n < 2) continue;
    if (await recordFlag({
      businessId,
      kind: "chargebacks",
      dedupeKey: `chargebacks:${businessId}:${monthKey()}`,
      title: `${n} chargebacks in the last 60 days`,
      detail: "Repeated chargebacks can mean orders aren't being made, customers are unhappy, or cards are being misused. Stripe can close accounts with too many.",
    })) found += 1;
  }

  for (const [businessId, n] of countBy(stripeRefunds.data)) {
    if (n < 3) continue;
    if (await recordFlag({
      businessId,
      kind: "stripe_refunds",
      dedupeKey: `stripe_refunds:${businessId}:${monthKey()}`,
      title: `${n} orders refunded in Stripe instead of HavnLine in 30 days`,
      detail: "Refunds made in the Stripe dashboard skip HavnLine's records and texts to the customer. The fees owed back are listed under Fees to return.",
    })) found += 1;
  }

  // Usage this month against the subscription price, for paying restaurants.
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const since = startOfMonth.toISOString();
  for (const b of businesses.data.filter((x) => x.subscription_status === "active" || x.subscription_status === "trialing").slice(0, 500)) {
    const [byProvider, seconds] = await Promise.all([sumUsageCostsByProvider(admin, { businessId: b.id, since }), sumCallSeconds(admin, { businessId: b.id, since })]);
    const costCents = Array.from(byProvider.values()).reduce((s, v) => s + v, 0) + (seconds / 60) * 4.85;
    if (costCents <= MONTHLY_PRICE_CENTS) continue;
    if (await recordFlag({
      businessId: b.id,
      kind: "cost_over_price",
      dedupeKey: `cost_over_price:${b.id}:${monthKey()}`,
      title: `Usage this month is costing $${(costCents / 100).toFixed(2)}, more than the $${(MONTHLY_PRICE_CENTS / 100).toFixed(0)} subscription`,
      detail: "Very long calls, heavy use of the Test Order-Taker, or someone calling the line on purpose can cause this. The platform fee on paid orders may still cover it; check the business's AI cost breakdown.",
    })) found += 1;
  }

  return found;
}

/** The nightly compliance sweep (run by the nightly cleanup). */
export async function runComplianceSweep(): Promise<{ instructions: number; signals: number }> {
  const [instructions, signals] = await Promise.all([scanInstructions(), checkBusinessSignals()]);
  return { instructions, signals };
}
