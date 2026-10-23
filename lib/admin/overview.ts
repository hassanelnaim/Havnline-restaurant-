import { createAdminClient } from "@/lib/supabase/admin";

/** The admin pages' day boundaries ("today", "per day"). */
export const ADMIN_TIMEZONE = process.env.ADMIN_TIMEZONE || "America/New_York";

export interface CallActivity {
  available: boolean;
  /** Calls started in each hour of today, 0-23. */
  hourly: { hour: number; calls: number }[];
  /** Most calls on the line at once today, and when. */
  peak: number;
  peakAt: string | null;
  liveNow: number;
  /** Last 14 days, oldest first. */
  daily: { day: string; calls: number; orders: number; salesCents: number }[];
}

const EMPTY: CallActivity = { available: false, hourly: [], peak: 0, peakAt: null, liveNow: 0, daily: [] };

/** Start of today in ADMIN_TIMEZONE, as a UTC instant. */
export function startOfTodayIso(timeZone = ADMIN_TIMEZONE, now = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  // How far local wall-clock time is ahead of UTC right now.
  const localAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMs = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offsetMs).toISOString();
}

/**
 * Platform-wide call numbers for the Command Center, summed in the
 * database (migration 038) so a busy month doesn't mean downloading
 * every call.
 */
export async function getCallActivity(): Promise<CallActivity> {
  const admin = createAdminClient();
  const [hourly, peak, daily] = await Promise.all([
    admin.rpc("admin_calls_by_hour_today", { p_tz: ADMIN_TIMEZONE }),
    admin.rpc("admin_peak_concurrent_calls", { p_from: startOfTodayIso(), p_to: new Date().toISOString() }),
    admin.rpc("admin_daily_activity", { p_days: 14, p_tz: ADMIN_TIMEZONE }),
  ]);
  if (hourly.error || peak.error || daily.error) {
    console.error("[admin] call activity unavailable (run migration 038):", hourly.error?.message || peak.error?.message || daily.error?.message);
    return EMPTY;
  }
  const p = (Array.isArray(peak.data) ? peak.data[0] : peak.data) as { peak: number; peak_at: string | null; live_now: number } | null;
  return {
    available: true,
    hourly: ((hourly.data || []) as { hour: number; calls: number | string }[]).map((r) => ({ hour: Number(r.hour), calls: Number(r.calls) })),
    peak: Number(p?.peak || 0),
    peakAt: p?.peak_at || null,
    liveNow: Number(p?.live_now || 0),
    daily: ((daily.data || []) as { day: string; calls: number | string; orders: number | string; sales_cents: number | string }[]).map((r) => ({
      day: String(r.day).slice(0, 10),
      calls: Number(r.calls),
      orders: Number(r.orders),
      salesCents: Number(r.sales_cents),
    })),
  };
}
