import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetchAll";

type Admin = ReturnType<typeof createAdminClient>;

function functionMissing(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message || "")));
}

/**
 * Total estimated AI and voice cost by provider, summed in the database
 * (migration 036) instead of downloading every usage row, which also hit
 * Supabase's 1,000-row cap and undercounted. Pages through the rows as a
 * fallback until that migration has been run.
 */
export async function sumUsageCostsByProvider(admin: Admin, filter: { businessId?: string; since?: string } = {}): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  const { data, error } = await admin.rpc("usage_cost_totals", { p_business: filter.businessId ?? null, p_since: filter.since ?? null });
  if (!error) {
    for (const row of (data || []) as { provider: string; cost_cents: number | string }[]) totals.set(row.provider, Number(row.cost_cents) || 0);
    return totals;
  }
  if (!functionMissing(error)) console.error("[costTotals] usage_cost_totals failed, paging instead:", error.message);
  const { data: rows } = await fetchAllRows<{ provider: string; estimated_cost_cents: number | string }>((from, to) => {
    let q = admin.from("usage_records").select("provider, estimated_cost_cents");
    if (filter.businessId) q = q.eq("business_id", filter.businessId);
    if (filter.since) q = q.gte("created_at", filter.since);
    return q.order("id").range(from, to);
  });
  for (const r of rows) totals.set(r.provider, (totals.get(r.provider) || 0) + Number(r.estimated_cost_cents));
  return totals;
}

/** Total call seconds, summed in the database (migration 036), paging as a fallback. */
export async function sumCallSeconds(admin: Admin, filter: { businessId?: string; since?: string } = {}): Promise<number> {
  const { data, error } = await admin.rpc("call_seconds_total", { p_business: filter.businessId ?? null, p_since: filter.since ?? null });
  if (!error) return Number(data) || 0;
  if (!functionMissing(error)) console.error("[costTotals] call_seconds_total failed, paging instead:", error.message);
  const { data: rows } = await fetchAllRows<{ duration_seconds: number | null }>((from, to) => {
    let q = admin.from("calls").select("duration_seconds");
    if (filter.businessId) q = q.eq("business_id", filter.businessId);
    if (filter.since) q = q.gte("started_at", filter.since);
    return q.order("id").range(from, to);
  });
  return rows.reduce((sum, c) => sum + (c.duration_seconds || 0), 0);
}
