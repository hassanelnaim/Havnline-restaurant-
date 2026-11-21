import { createAdminClient } from "@/lib/supabase/admin";

/**
 * HavnLine pausing a restaurant's AI order-taker for an update
 * (Admin > Pause AI, migration 050). While a pause is active the call
 * webhook rings the restaurant's own phone instead of answering with the
 * AI. Start and end are compared with the clock on every lookup, so a
 * scheduled pause begins and ends on the minute without a cron job.
 */

export interface PauseWindow {
  id: string;
  startsAt: string;
  /** Null: until HavnLine resumes it by hand. */
  endsAt: string | null;
  reason: string | null;
}

export interface PauseState {
  /** Paused right now. endsAt is the latest end of the pauses in force (null if any has no end). */
  active: PauseWindow | null;
  /** The next pause that hasn't started yet. */
  upcoming: PauseWindow | null;
}

const NONE: PauseState = { active: null, upcoming: null };

type Row = { pause_id: string; ai_pauses: { starts_at: string; ends_at: string | null; reason: string | null; cancelled_at: string | null } | { starts_at: string; ends_at: string | null; reason: string | null; cancelled_at: string | null }[] | null };

/**
 * This restaurant's pause state. Any error (including the tables not
 * existing before migration 050) counts as "not paused": a pause is a
 * courtesy for planned updates, and failing open keeps calls answered.
 */
export async function getPauseState(businessId: string, now: Date = new Date()): Promise<PauseState> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("ai_pause_targets")
      .select("pause_id, ai_pauses(starts_at, ends_at, reason, cancelled_at)")
      .eq("business_id", businessId)
      .is("resumed_at", null);
    if (error || !data) return NONE;
    const t = now.getTime();
    const open = (data as unknown as Row[]).flatMap((r) => {
      const p = Array.isArray(r.ai_pauses) ? r.ai_pauses[0] : r.ai_pauses;
      if (!p || p.cancelled_at) return [];
      if (p.ends_at && new Date(p.ends_at).getTime() <= t) return [];
      return [{ id: r.pause_id, startsAt: p.starts_at, endsAt: p.ends_at, reason: p.reason }];
    });
    const started = open.filter((p) => new Date(p.startsAt).getTime() <= t);
    const later = open.filter((p) => new Date(p.startsAt).getTime() > t).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    let active: PauseWindow | null = null;
    if (started.length) {
      const endless = started.find((p) => !p.endsAt);
      const latest = [...started].sort((a, b) => (b.endsAt || "").localeCompare(a.endsAt || ""))[0];
      active = { ...(endless || latest), endsAt: endless ? null : latest.endsAt };
    }
    return { active, upcoming: later[0] || null };
  } catch {
    return NONE;
  }
}

/** "Sat, Nov 22, 2:00 AM EST" in the given time zone. */
export function formatPauseTime(iso: string, timeZone?: string | null): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timeZone || undefined }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-US", opts).format(new Date(iso));
  }
}
