"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/supabase/platform-admin";
import { runCronJob, type CronJob } from "@/lib/monitoring/cronRuns";
import { runNightlyCleanup } from "@/lib/maintenance/cleanup";
import { runWeeklyDigestJob } from "@/lib/notifications/weekly-digest-email";
import { queuePrintJob, requeueOrderPrintJob } from "@/lib/integrations/printer-app";
import { processOrderRefund } from "@/lib/billing/orderRefund";
import { encryptionConfigured, isSealed, sealSecret } from "@/lib/security/secretBox";
import { fetchAllRows } from "@/lib/supabase/fetchAll";
import type { OrderWithItems } from "@/lib/database/types";

/**
 * The fix buttons on the admin Health page. Every action re-checks that
 * the caller is the platform admin (a server action is a public endpoint;
 * the page being hidden isn't protection) and re-reads the row's current
 * state, so a stale page can't act on something that has since moved on.
 */

export interface HealthActionResult {
  success: boolean;
  error?: string;
  message?: string;
}

const CALL_CAP_SECONDS = 25 * 60;

async function guard(): Promise<HealthActionResult | null> {
  if (!(await isPlatformAdmin())) return { success: false, error: "Not authorized." };
  if (!isSupabaseConfigured()) return { success: false, error: "This is a preview with demo data." };
  return null;
}

function done(message?: string): HealthActionResult {
  revalidatePath("/admin/health");
  revalidatePath("/admin");
  return { success: true, message };
}

export async function runJobNowAction(job: CronJob): Promise<HealthActionResult> {
  const denied = await guard();
  if (denied) return denied;
  if (job !== "cleanup" && job !== "weekly-digest") return { success: false, error: "Unknown job." };
  const outcome = await runCronJob(job, "manual", job === "cleanup" ? runNightlyCleanup : runWeeklyDigestJob);
  revalidatePath("/admin/health");
  return outcome.ok ? { success: true, message: "Finished." } : { success: false, error: "Ran with errors. See the result below." };
}

async function loadOrderWithItems(orderId: string): Promise<OrderWithItems | null> {
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return null;
  const { data: items } = await admin.from("order_items").select("*").eq("order_id", orderId);
  const itemIds = (items || []).map((i) => i.id);
  const { data: modifiers } = itemIds.length ? await admin.from("order_item_modifiers").select("*").in("order_item_id", itemIds) : { data: [] };
  return { ...order, items: (items || []).map((i) => ({ ...i, modifiers: (modifiers || []).filter((m) => m.order_item_id === i.id) })) };
}

/** Puts a waiting or failed ticket back at the front of the tablet's queue. */
export async function retryPrintJobAction(jobId: string): Promise<HealthActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const admin = createAdminClient();
  const { data: job } = await admin.from("printer_print_jobs").select("id, order_id, kind, status").eq("id", jobId).maybeSingle();
  if (!job) return { success: false, error: "That ticket no longer exists." };
  if (job.status === "printed") return done("It printed in the meantime.");

  const { data: order } = await admin.from("orders").select("status").eq("id", job.order_id).maybeSingle();
  if (order?.status === "cancelled") return { success: false, error: "The order was voided, so it shouldn't go to the kitchen." };

  const { error } = await admin
    .from("printer_print_jobs")
    .update({ status: "pending", claimed_at: null, attempts: 0, handed_out: 0, error: null })
    .eq("id", job.id)
    .neq("status", "printed");
  if (error) return { success: false, error: error.message };
  if (job.kind === "order") await admin.from("orders").update({ submit_error: null }).eq("id", job.order_id);
  return done("Back in the queue. The tablet picks it up on its next check.");
}

/** A paid order that never got a ticket at all. */
export async function queueOrderPrintAction(orderId: string): Promise<HealthActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const order = await loadOrderWithItems(orderId);
  if (!order) return { success: false, error: "Order not found." };
  if (order.status === "building" || order.status === "cancelled") return { success: false, error: "This order isn't active." };
  if (order.payment_status !== "paid") return { success: false, error: "This order isn't paid." };

  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("name").eq("id", order.business_id).maybeSingle();
  if (!business) return { success: false, error: "Business not found." };

  const result = order.status === "submitted" ? await requeueOrderPrintJob(order, business) : await queuePrintJob(order, business);
  if (!result.success) return { success: false, error: result.error };
  await admin
    .from("orders")
    .update({ status: "submitted", submitted_at: new Date().toISOString(), submit_error: null })
    .eq("id", orderId)
    .in("status", ["confirmed", "submitted"]);
  return done(result.alreadyQueued ? "It was already in the queue." : "Sent to the kitchen queue.");
}

export async function markTicketHandledAction(jobId: string): Promise<HealthActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const { error } = await createAdminClient().from("printer_print_jobs").update({ handled_at: new Date().toISOString() }).eq("id", jobId).eq("status", "failed");
  if (error) return { success: false, error: error.message.includes("handled_at") ? "Run migration 038 first." : error.message };
  return done();
}

/** Closes a call Twilio never reported as ended. Billed time is estimated up to the 25-minute cap. */
export async function closeStuckCallAction(callId: string): Promise<HealthActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const admin = createAdminClient();
  const { data: call } = await admin.from("calls").select("id, started_at, status").eq("id", callId).maybeSingle();
  if (!call) return { success: false, error: "Call not found." };
  if (call.status !== "in_progress") return done("It had already ended.");
  const seconds = Math.min(CALL_CAP_SECONDS, Math.max(0, Math.round((Date.now() - Date.parse(call.started_at)) / 1000)));
  const { error } = await admin.from("calls").update({ status: "completed", duration_seconds: seconds }).eq("id", callId).eq("status", "in_progress");
  if (error) return { success: false, error: error.message };
  return done();
}

/** Full refund of an order the customer paid after it was voided. */
export async function refundPaidAfterVoidAction(orderId: string): Promise<HealthActionResult> {
  const denied = await guard();
  if (denied) return denied;
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("id, business_id, status, payment_status").eq("id", orderId).maybeSingle();
  if (!order) return { success: false, error: "Order not found." };
  if (order.status !== "cancelled" || order.payment_status !== "paid") return done("Nothing to refund any more.");

  const { data: { user } } = await createClient().auth.getUser();
  const result = await processOrderRefund(order.business_id, order.id, undefined, "Paid after the order was voided (refunded by HavnLine)", {
    refundedByUserId: user?.id ?? null,
  });
  if (!result.success) return { success: false, error: result.error };
  return done(`Refunded $${((result.refundedCents || 0) / 100).toFixed(2)}.`);
}

/** Encrypts every Twilio token still stored in plain text. */
export async function sealTwilioTokensAction(): Promise<HealthActionResult> {
  const denied = await guard();
  if (denied) return denied;
  if (!encryptionConfigured()) return { success: false, error: "SECRETS_ENCRYPTION_KEY isn't set." };
  const admin = createAdminClient();
  const { data: rows, error } = await fetchAllRows<{ id: string; metadata: Record<string, unknown> | null }>((from, to) =>
    admin.from("integrations").select("id, metadata").eq("provider", "twilio").order("id").range(from, to)
  );
  if (error) return { success: false, error: error.message };

  let sealed = 0;
  for (const row of rows) {
    const token = row.metadata?.subaccount_auth_token;
    if (typeof token !== "string" || !token || isSealed(token)) continue;
    // Only replaces the exact plain value read, so a token changed in
    // the meantime isn't overwritten with an old one.
    const { data: updated } = await admin
      .from("integrations")
      .update({ metadata: { ...row.metadata, subaccount_auth_token: sealSecret(token) } })
      .eq("id", row.id)
      .eq("metadata->>subaccount_auth_token", token)
      .select("id");
    if (updated?.length) sealed += 1;
  }
  return done(`Encrypted ${sealed} token${sealed === 1 ? "" : "s"}.`);
}
