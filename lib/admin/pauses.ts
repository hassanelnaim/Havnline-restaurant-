import { createAdminClient } from "@/lib/supabase/admin";
import { describeAudience, sendPlatformMessage, type AudienceRestaurant, type MessageAudience, type SendSummary } from "@/lib/admin/messages";

/** Admin > Pause AI: creating, listing, cancelling and resuming pauses (see lib/ai/pause.ts). */

export const REASON_MAX = 300;
/** How far ahead a pause can be scheduled, and how long one can run. */
export const MAX_DAYS_AHEAD = 90;

export interface CreatePauseInput {
  createKey: string;
  startsAt: string;
  endsAt: string | null;
  reason: string | null;
  audience: MessageAudience;
  restaurants: AudienceRestaurant[];
  createdBy: string | null;
  message: { subject: string; body: string } | null;
}

export interface CreatePauseResult {
  success: boolean;
  error?: string;
  pauseId?: string;
  restaurants?: number;
  alreadyCreated?: boolean;
  message?: SendSummary;
  messageError?: string;
}

export async function createPause(input: CreatePauseInput): Promise<CreatePauseResult> {
  const admin = createAdminClient();
  const { data: created, error } = await admin
    .from("ai_pauses")
    .insert({
      create_key: input.createKey,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      reason: input.reason,
      audience: describeAudience(input.audience, input.restaurants.length),
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await admin.from("ai_pauses").select("id").eq("create_key", input.createKey).maybeSingle();
      if (existing) {
        const { count } = await admin.from("ai_pause_targets").select("business_id", { count: "exact", head: true }).eq("pause_id", existing.id);
        return { success: true, pauseId: existing.id, restaurants: count || 0, alreadyCreated: true };
      }
    }
    console.error("[pauses] create failed:", error.message);
    return { success: false, error: "Couldn't save the pause. Nothing was changed." };
  }
  const pauseId = created.id as string;

  for (let i = 0; i < input.restaurants.length; i += 500) {
    const rows = input.restaurants.slice(i, i + 500).map((r) => ({ pause_id: pauseId, business_id: r.id }));
    const { error: tErr } = await admin.from("ai_pause_targets").insert(rows);
    if (tErr) {
      console.error("[pauses] targets failed:", tErr.message);
      await admin.from("ai_pauses").delete().eq("id", pauseId);
      return { success: false, error: "Couldn't save the pause. Nothing was changed." };
    }
  }

  const result: CreatePauseResult = { success: true, pauseId, restaurants: input.restaurants.length };
  if (input.message) {
    const sent = await sendPlatformMessage({
      sendKey: `${input.createKey}-msg`,
      subject: input.message.subject,
      body: input.message.body,
      audience: input.audience,
      restaurants: input.restaurants,
      sentBy: input.createdBy,
    });
    if (sent.success) {
      result.message = sent.summary;
      const { data: msg } = await admin.from("platform_messages").select("id").eq("send_key", `${input.createKey}-msg`).maybeSingle();
      if (msg) await admin.from("ai_pauses").update({ message_id: msg.id }).eq("id", pauseId);
    } else {
      result.messageError = sent.error;
    }
  }
  return result;
}

export interface PauseListRow {
  id: string;
  startsAt: string;
  endsAt: string | null;
  reason: string | null;
  audience: string;
  cancelledAt: string | null;
  createdAt: string;
  messageSent: boolean;
  state: "scheduled" | "active" | "ended" | "cancelled";
  restaurants: { id: string; name: string; resumedAt: string | null }[];
}

/** Scheduled and active pauses first, then the most recent finished ones. */
export async function listPauses(limit = 30): Promise<PauseListRow[]> {
  const admin = createAdminClient();
  const { data: pauses } = await admin
    .from("ai_pauses")
    .select("id, starts_at, ends_at, reason, audience, cancelled_at, created_at, message_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!pauses?.length) return [];
  const { data: targets } = await admin
    .from("ai_pause_targets")
    .select("pause_id, business_id, resumed_at, businesses(name)")
    .in("pause_id", pauses.map((p) => p.id));
  const now = Date.now();
  const rows: PauseListRow[] = pauses.map((p) => {
    const mine = (targets || []).filter((t) => t.pause_id === p.id);
    const allResumed = mine.length > 0 && mine.every((t) => t.resumed_at);
    let state: PauseListRow["state"];
    if (p.cancelled_at) state = new Date(p.cancelled_at).getTime() <= new Date(p.starts_at).getTime() ? "cancelled" : "ended";
    else if (p.ends_at && new Date(p.ends_at).getTime() <= now) state = "ended";
    else if (allResumed) state = "ended";
    else state = new Date(p.starts_at).getTime() > now ? "scheduled" : "active";
    return {
      id: p.id,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
      reason: p.reason,
      audience: p.audience,
      cancelledAt: p.cancelled_at,
      createdAt: p.created_at,
      messageSent: Boolean(p.message_id),
      state,
      restaurants: mine
        .map((t) => {
          const b = t.businesses as unknown as { name: string | null } | { name: string | null }[] | null;
          const name = (Array.isArray(b) ? b[0]?.name : b?.name) || "Restaurant";
          return { id: t.business_id, name, resumedAt: t.resumed_at };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
  const order = { active: 0, scheduled: 1, ended: 2, cancelled: 2 };
  return rows.sort((a, b) => order[a.state] - order[b.state] || b.createdAt.localeCompare(a.createdAt));
}

/** Cancel a pause that hasn't started, or end one early for everyone it covers. */
export async function cancelPause(pauseId: string): Promise<{ success: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("ai_pauses").update({ cancelled_at: new Date().toISOString() }).eq("id", pauseId).is("cancelled_at", null).select("id");
  if (error) return { success: false, error: "Couldn't update the pause." };
  if (!data?.length) return { success: false, error: "That pause was already cancelled or ended." };
  return { success: true };
}

/** Lift every pause for one restaurant (scheduled or active); other restaurants stay paused. */
export async function resumeRestaurant(businessId: string, pauseId?: string): Promise<{ success: boolean; error?: string; lifted?: number }> {
  const admin = createAdminClient();
  let q = admin.from("ai_pause_targets").update({ resumed_at: new Date().toISOString() }).eq("business_id", businessId).is("resumed_at", null);
  if (pauseId) q = q.eq("pause_id", pauseId);
  const { data, error } = await q.select("pause_id");
  if (error) return { success: false, error: "Couldn't resume that restaurant." };
  return { success: true, lifted: data?.length || 0 };
}
