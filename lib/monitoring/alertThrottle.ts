/**
 * Per-instance memory of when each kind of alert email was last sent.
 * This is the SECOND guard against an alert storm (the first is a row in
 * the database, shared by every serverless instance — see
 * platformAlert.ts); it exists so that even if the database check fails
 * or is unavailable, one warm instance still can't email the same
 * problem over and over during an outage.
 */
const lastSentAt = new Map<string, number>();

export function recentlySent(key: string, nowMs: number, windowMs: number): boolean {
  const last = lastSentAt.get(key);
  return last !== undefined && nowMs - last < windowMs;
}

export function markSent(key: string, nowMs: number): void {
  lastSentAt.set(key, nowMs);
}
