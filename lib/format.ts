export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Real fix for calls showing the wrong time: this now REQUIRES a real
 * IANA timezone (e.g. "America/Detroit"). The previous version passed
 * `undefined` as the locale, which uses the server's own timezone —
 * UTC on Vercel — to format a timestamp that's stored in UTC but
 * meant to be read in the business's actual local time. That mismatch
 * is exactly why every call showed several hours ahead of the real
 * time. Making this required (not optional) means TypeScript itself
 * will flag any call site that forgets to pass it.
 */
export function formatDateTime(iso: string, timezone: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDate(iso: string): string {
  // Pure calendar dates (YYYY-MM-DD, no time component) were never
  // affected by the timezone bug — appending T00:00:00 before parsing
  // and formatting with the server's own timezone round-trips back to
  // the same calendar date either way. Left as-is intentionally.
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "21/08/2026 · Friday" */
export function formatDateWithWeekday(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  return `${dd}/${mm}/${yyyy} · ${weekday}`;
}

/**
 * The calendar date (YYYY-MM-DD) an ISO timestamp falls on in a given
 * IANA timezone — used to group/filter orders by "today" in the
 * business's own local time rather than the server's (UTC on
 * Vercel), same reasoning as formatDateTime above.
 */
export function localDateKey(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: timezone }); // en-CA gives YYYY-MM-DD
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
