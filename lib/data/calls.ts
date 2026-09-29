import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { mockCalls, mockCallMessages } from "@/lib/mock/data";
import { normalizePhoneDigits } from "@/lib/phone-utils";
import type { DbCall, DbCallMessage } from "@/lib/database/types";

export async function getCalls(): Promise<DbCall[]> {
  if (!isSupabaseConfigured()) return mockCalls;
  const businessId = await getCurrentBusinessId();
  if (!businessId) return mockCalls;

  const supabase = createClient();
  const { data } = await supabase.from("calls").select("*").eq("business_id", businessId).order("started_at", { ascending: false });
  return data || mockCalls;
}

export async function getCall(callId: string): Promise<DbCall | null> {
  if (!isSupabaseConfigured()) return mockCalls.find((c) => c.id === callId) || null;
  const supabase = createClient();
  const { data } = await supabase.from("calls").select("*").eq("id", callId).maybeSingle();
  return data || null;
}

export async function getCallMessages(callId: string): Promise<DbCallMessage[]> {
  if (!isSupabaseConfigured()) return mockCallMessages.filter((m) => m.call_id === callId);
  const supabase = createClient();
  const { data } = await supabase.from("call_messages").select("*").eq("call_id", callId).order("created_at");
  return data || [];
}

/**
 * All calls for the business, grouped by caller phone number (last-10-
 * digits normalized — see lib/phone-utils.ts, since calls.phone is
 * Twilio's E.164 caller ID while customers.phone is whatever format the
 * caller spoke it in) — powers the "Past calls" list in the Callers
 * page detail sheet. Grouped by phone rather than the nullable
 * customer_id link, so it also covers calls that predate a customer
 * record existing.
 */
export async function getCallsByPhone(): Promise<Record<string, DbCall[]>> {
  const calls = await getCalls();
  const byPhone: Record<string, DbCall[]> = {};
  for (const call of calls) {
    const key = normalizePhoneDigits(call.phone);
    (byPhone[key] ||= []).push(call);
  }
  return byPhone;
}

/**
 * All calls that were escalated to a human, most recent first — powers
 * the dedicated Escalations page (and the clickable "Human Escalations"
 * stat on the Overview page that links there).
 */
export async function getEscalatedCalls(): Promise<DbCall[]> {
  const calls = await getCalls();
  return calls.filter((c) => c.outcome === "escalated").sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
}
