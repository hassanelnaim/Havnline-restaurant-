"use server";

import { revalidatePath } from "next/cache";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/supabase/platform-admin";
import { BODY_MAX, SUBJECT_MAX, resolveAudience, type MessageAudience } from "@/lib/admin/messages";
import { MAX_DAYS_AHEAD, REASON_MAX, cancelPause, createPause, resumeRestaurant, type CreatePauseResult } from "@/lib/admin/pauses";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 24 * 60 * 60 * 1000;

export interface PauseActionResult extends CreatePauseResult {
  count?: number;
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

function revalidate() {
  revalidatePath("/admin/pause");
  revalidatePath("/admin/businesses", "layout");
  revalidatePath("/dashboard", "layout");
}

/**
 * Pause the AI for the chosen restaurants from startsAt (now if empty or
 * already past) until endsAt (or until resumed by hand), optionally
 * sending a message about it in the same step.
 */
export async function createPauseAction(input: {
  createKey: string;
  audience: MessageAudience;
  expectedCount: number;
  startsAt: string | null;
  endsAt: string | null;
  reason: string;
  message: { subject: string; body: string } | null;
}): Promise<PauseActionResult> {
  if (!(await isPlatformAdmin())) return { success: false, error: "Not authorized." };
  if (!isSupabaseConfigured()) return { success: false, error: "This is a preview with demo data, so nothing can be paused." };
  if (!/^[A-Za-z0-9-]{8,64}$/.test(String(input.createKey))) return { success: false, error: "Refresh the page and try again." };
  const audience = cleanAudience(input.audience);
  if (!audience) return { success: false, error: "Choose which restaurants to pause." };

  const now = Date.now();
  let start = input.startsAt ? new Date(input.startsAt).getTime() : now;
  if (Number.isNaN(start)) return { success: false, error: "The start time isn't a valid date." };
  // A start a few minutes in the past (the form sat open) just means now.
  if (start < now) {
    if (now - start > 15 * 60 * 1000) return { success: false, error: "The start time is in the past. Pick a later time, or choose Now." };
    start = now;
  }
  if (start - now > MAX_DAYS_AHEAD * DAY) return { success: false, error: `Schedule it within the next ${MAX_DAYS_AHEAD} days.` };
  let end: number | null = null;
  if (input.endsAt) {
    end = new Date(input.endsAt).getTime();
    if (Number.isNaN(end)) return { success: false, error: "The end time isn't a valid date." };
    if (end <= start) return { success: false, error: "The end time has to be after the start." };
    if (end - start > MAX_DAYS_AHEAD * DAY) return { success: false, error: `A pause can last at most ${MAX_DAYS_AHEAD} days.` };
  }
  const reason = String(input.reason || "").trim();
  if (reason.length > REASON_MAX) return { success: false, error: `Keep the note under ${REASON_MAX} characters.` };

  let message: { subject: string; body: string } | null = null;
  if (input.message) {
    const subject = String(input.message.subject || "").trim();
    const body = String(input.message.body || "").trim();
    if (!subject || !body) return { success: false, error: "Add a subject and message, or untick “Also send a message”." };
    if (subject.length > SUBJECT_MAX) return { success: false, error: `Keep the subject under ${SUBJECT_MAX} characters.` };
    if (body.length > BODY_MAX) return { success: false, error: `Keep the message under ${BODY_MAX.toLocaleString()} characters.` };
    message = { subject, body };
  }

  const restaurants = await resolveAudience(audience);
  if (restaurants.length === 0) return { success: false, error: "No restaurants match, so nothing was paused." };
  if (restaurants.length !== input.expectedCount) {
    return { success: false, count: restaurants.length, error: `This would now pause ${restaurants.length} restaurants, not ${input.expectedCount}. Check the list and confirm again.` };
  }

  const result = await createPause({
    createKey: input.createKey,
    startsAt: new Date(start).toISOString(),
    endsAt: end === null ? null : new Date(end).toISOString(),
    reason: reason || null,
    audience,
    restaurants,
    createdBy: await adminEmail(),
    message,
  });
  if (result.success) revalidate();
  return result;
}

/** Cancel a scheduled pause, or end an active one for everyone it covers. */
export async function cancelPauseAction(pauseId: string): Promise<{ success: boolean; error?: string }> {
  if (!(await isPlatformAdmin())) return { success: false, error: "Not authorized." };
  if (!UUID.test(String(pauseId))) return { success: false, error: "Unknown pause." };
  const r = await cancelPause(pauseId);
  if (r.success) revalidate();
  return r;
}

/** Resume one restaurant (from one pause, or from all of them). */
export async function resumeRestaurantAction(businessId: string, pauseId?: string): Promise<{ success: boolean; error?: string }> {
  if (!(await isPlatformAdmin())) return { success: false, error: "Not authorized." };
  if (!UUID.test(String(businessId)) || (pauseId !== undefined && !UUID.test(String(pauseId)))) return { success: false, error: "Unknown restaurant." };
  const r = await resumeRestaurant(businessId, pauseId);
  if (r.success) revalidate();
  return { success: r.success, error: r.error };
}
