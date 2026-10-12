/**
 * Validates and normalises the schedule/discount part of a promotion or an
 * item special price coming from a form. Pure (no I/O) so it can be tested
 * directly; the server actions call it before writing anything.
 */

export interface ScheduleInput {
  /** 0=Sunday..6=Saturday. Empty = every day. */
  days: number[];
  /** "HH:MM" or "". Both or neither. */
  startTime: string;
  endTime: string;
}

export type ScheduleResult =
  | { ok: true; days: number[] | null; start: string | null; end: string | null }
  | { ok: false; error: string };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normaliseSchedule(input: ScheduleInput): ScheduleResult {
  const days = Array.from(new Set(input.days));
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return { ok: false, error: "Pick days from Sunday to Saturday." };
  const start = input.startTime.trim();
  const end = input.endTime.trim();
  if ((start && !end) || (!start && end)) return { ok: false, error: "Set both a start and an end time, or leave both blank for all day." };
  if (start && (!HHMM.test(start) || !HHMM.test(end))) return { ok: false, error: "Times should look like 15:00." };
  if (start && start === end) return { ok: false, error: "The start and end time can't be the same." };
  // Selecting every day is the same as selecting none: store "every day" as null.
  return { ok: true, days: days.length === 0 || days.length === 7 ? null : days.sort((a, b) => a - b), start: start || null, end: end || null };
}

export interface DiscountInput {
  type: "none" | "percent" | "amount";
  /** Percent as a whole number ("15") or dollars ("2.50"), as typed. */
  value: string;
}

export type DiscountResult =
  | { ok: true; type: "percent" | "amount" | null; value: number | null }
  | { ok: false; error: string };

export function normaliseDiscount(input: DiscountInput): DiscountResult {
  if (input.type === "none") return { ok: true, type: null, value: null };
  const n = Number(input.value.trim());
  if (!input.value.trim() || !Number.isFinite(n) || n <= 0) return { ok: false, error: "Enter how much the discount is." };
  if (input.type === "percent") {
    if (!Number.isInteger(n) || n > 100) return { ok: false, error: "Percent off should be a whole number from 1 to 100." };
    return { ok: true, type: "percent", value: n };
  }
  const cents = Math.round(n * 100);
  if (cents < 1 || cents > 100000) return { ok: false, error: "Dollar discount should be between $0.01 and $1,000." };
  return { ok: true, type: "amount", value: cents };
}
