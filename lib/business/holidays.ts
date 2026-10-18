/**
 * The US holidays restaurants most often close for, as quick-add
 * suggestions on the Settings page. Pure date math, client-safe.
 * Dates are "YYYY-MM-DD" calendar dates (no timezone involved).
 */

const pad = (n: number) => String(n).padStart(2, "0");
const key = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The nth (1-based) given weekday (0=Sun) of a month; n = -1 for the last one. */
function nthWeekday(y: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return key(y, month, day);
  }
  const lastDate = new Date(Date.UTC(y, month, 0)).getUTCDate();
  const lastDay = new Date(Date.UTC(y, month - 1, lastDate)).getUTCDay();
  return key(y, month, lastDate - ((lastDay - weekday + 7) % 7));
}

/** Easter Sunday (Gregorian), Anonymous algorithm. */
function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return key(y, month, day);
}

function holidaysForYear(y: number): { name: string; date: string }[] {
  return [
    { name: "New Year's Day", date: key(y, 1, 1) },
    { name: "Easter", date: easter(y) },
    { name: "Memorial Day", date: nthWeekday(y, 5, 1, -1) },
    { name: "Independence Day", date: key(y, 7, 4) },
    { name: "Labor Day", date: nthWeekday(y, 9, 1, 1) },
    { name: "Thanksgiving", date: nthWeekday(y, 11, 4, 4) },
    { name: "Christmas Eve", date: key(y, 12, 24) },
    { name: "Christmas", date: key(y, 12, 25) },
    { name: "New Year's Eve", date: key(y, 12, 31) },
  ];
}

/** The next `count` holidays on or after `fromDateKey`, soonest first. */
export function upcomingHolidays(fromDateKey: string, count: number): { name: string; date: string }[] {
  const y = parseInt(fromDateKey.slice(0, 4), 10);
  return [...holidaysForYear(y), ...holidaysForYear(y + 1)]
    .filter((h) => h.date >= fromDateKey)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, count);
}
