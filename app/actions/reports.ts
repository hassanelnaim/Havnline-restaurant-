"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { getOrdersForDate } from "@/lib/data/orders";
import { localDateKey } from "@/lib/format";
import type { OrderWithItems } from "@/lib/database/types";

async function requireBusinessId(): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");

  const businessId = await getCurrentBusinessId();
  if (!businessId) throw new Error("No business found for this account.");
  return businessId;
}

// Orders that never actually happened (never confirmed, or called off)
// shouldn't count toward the day's sales totals — same rule as the
// live "Today" summary on the Orders page (see orders-client.tsx).
const COUNTS_TOWARD_SALES = new Set(["confirmed", "submitted"]);

export interface EndOfDaySummary {
  dateKey: string;
  orderCount: number;
  cancelledCount: number;
  grossCents: number;
  netCents: number;
  taxCents: number;
}

export interface EndOfDayResult {
  success: boolean;
  error?: string;
  summary?: EndOfDaySummary;
  orders?: OrderWithItems[];
}

/**
 * The end-of-day reconciliation report: one calendar day's orders in
 * the business's own timezone, plus the same sales math the AI used
 * when it confirmed each order. HavnLine never touches the customer's
 * money (no payments, no POS) — this is purely for an owner to check
 * "does this match what came in on the register/deposits tonight,"
 * not a payments close-out.
 */
export async function getEndOfDaySummaryAction(dateKey: string): Promise<EndOfDayResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return { success: false, error: "Invalid date." };
  }

  let businessId: string;
  try {
    businessId = await requireBusinessId();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Not authenticated." };
  }

  const supabase = createClient();
  const { data: business } = await supabase.from("businesses").select("timezone").eq("id", businessId).single();
  const timezone = business?.timezone || "America/New_York";

  // A future date has no orders and would just be a confusing empty
  // report — clamp to today in the business's own timezone.
  const today = localDateKey(new Date().toISOString(), timezone);
  const effectiveDateKey = dateKey > today ? today : dateKey;

  const orders = await getOrdersForDate(businessId, effectiveDateKey, timezone);
  const salesOrders = orders.filter((o) => COUNTS_TOWARD_SALES.has(o.status));
  const cancelledCount = orders.filter((o) => o.status === "cancelled").length;

  const summary: EndOfDaySummary = {
    dateKey: effectiveDateKey,
    orderCount: salesOrders.length,
    cancelledCount,
    grossCents: salesOrders.reduce((sum, o) => sum + o.total_cents, 0),
    netCents: salesOrders.reduce((sum, o) => sum + o.subtotal_cents, 0),
    taxCents: salesOrders.reduce((sum, o) => sum + o.tax_cents, 0),
  };

  return { success: true, summary, orders };
}
