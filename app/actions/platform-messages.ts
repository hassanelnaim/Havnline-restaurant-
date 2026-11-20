"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { isPlatformAdmin } from "@/lib/supabase/platform-admin";
import { BODY_MAX, SUBJECT_MAX, resolveAudience, sendPlatformMessage, sendTestMessage, type MessageAudience, type SendSummary } from "@/lib/admin/messages";

export interface MessageActionResult {
  success: boolean;
  error?: string;
  summary?: SendSummary;
  count?: number;
}

function checkText(subject: string, body: string): string | null {
  if (!subject.trim()) return "Add a subject.";
  if (subject.trim().length > SUBJECT_MAX) return `Keep the subject under ${SUBJECT_MAX} characters.`;
  if (!body.trim()) return "Write the message.";
  if (body.trim().length > BODY_MAX) return `Keep the message under ${BODY_MAX.toLocaleString()} characters.`;
  return null;
}

function cleanAudience(audience: MessageAudience): MessageAudience | null {
  if (audience?.kind === "all") return { kind: "all" };
  if (audience?.kind === "status" && Array.isArray(audience.statuses)) return { kind: "status", statuses: audience.statuses.map(String).slice(0, 10) };
  if (audience?.kind === "selected" && Array.isArray(audience.businessIds)) return { kind: "selected", businessIds: audience.businessIds.map(String).slice(0, 5000) };
  return null;
}

async function adminEmail(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email || null;
}

/** How many restaurants a send would reach, as the server sees it. */
export async function countMessageAudienceAction(audience: MessageAudience): Promise<MessageActionResult> {
  if (!(await isPlatformAdmin())) return { success: false, error: "Not authorized." };
  if (!isSupabaseConfigured()) return { success: true, count: 0 };
  const a = cleanAudience(audience);
  if (!a) return { success: false, error: "Choose who gets the message." };
  return { success: true, count: (await resolveAudience(a)).length };
}

export async function sendTestMessageAction(subject: string, body: string): Promise<MessageActionResult> {
  if (!(await isPlatformAdmin())) return { success: false, error: "Not authorized." };
  const bad = checkText(subject, body);
  if (bad) return { success: false, error: bad };
  const to = await adminEmail();
  if (!to) return { success: false, error: "Couldn't find your email address." };
  return sendTestMessage(to, subject.trim(), body.trim());
}

export async function sendPlatformMessageAction(input: { sendKey: string; subject: string; body: string; audience: MessageAudience; expectedCount: number }): Promise<MessageActionResult> {
  if (!(await isPlatformAdmin())) return { success: false, error: "Not authorized." };
  if (!isSupabaseConfigured()) return { success: false, error: "This is a preview with demo data, so nothing can be sent." };
  const bad = checkText(input.subject, input.body);
  if (bad) return { success: false, error: bad };
  if (!/^[A-Za-z0-9-]{8,64}$/.test(String(input.sendKey))) return { success: false, error: "Refresh the page and try again." };
  const audience = cleanAudience(input.audience);
  if (!audience) return { success: false, error: "Choose who gets the message." };

  const restaurants = await resolveAudience(audience);
  if (restaurants.length === 0) return { success: false, error: "No restaurants match, so nothing was sent." };
  // The confirm step showed a number; if the list changed since, show the new one first.
  if (restaurants.length !== input.expectedCount) {
    return { success: false, count: restaurants.length, error: `This would now go to ${restaurants.length} restaurants, not ${input.expectedCount}. Check the list and confirm again.` };
  }

  const result = await sendPlatformMessage({ sendKey: input.sendKey, subject: input.subject.trim(), body: input.body.trim(), audience, restaurants, sentBy: await adminEmail() });
  if (!result.success) return { success: false, error: result.error };
  revalidatePath("/admin/messages");
  return { success: true, summary: result.summary };
}

/** A restaurant marks a message from HavnLine as read; it leaves their dashboard. */
export async function markPlatformMessageReadAction(messageId: string): Promise<{ success: boolean }> {
  if (!isSupabaseConfigured()) return { success: true };
  const businessId = await getCurrentBusinessId();
  if (!businessId || !/^[0-9a-f-]{36}$/i.test(String(messageId))) return { success: false };
  const admin = createAdminClient();
  const { error } = await admin
    .from("platform_message_recipients")
    .update({ read_at: new Date().toISOString() })
    .eq("message_id", messageId)
    .eq("business_id", businessId)
    .is("read_at", null);
  if (error) return { success: false };
  revalidatePath("/dashboard", "layout");
  return { success: true };
}
