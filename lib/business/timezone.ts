// A bad business.timezone value (empty string, a typo, a legacy
// abbreviation like "EST") makes every Intl.DateTimeFormat call that
// uses it throw a RangeError — and several of those calls sit directly
// in the live phone-call path (system prompt building, hours/pricing
// checks) with nothing above them to catch it. One bad value would
// otherwise take down that business's entire phone line. This is the
// single place that validates a timezone before it's stored, and the
// single fallback used everywhere a stored value is read.

const FALLBACK_TIMEZONE = "America/New_York";

export function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Never throws — returns tz if it's a real IANA zone, otherwise a safe fallback. */
export function safeTimezone(tz: string | null | undefined): string {
  return isValidTimezone(tz) ? tz : FALLBACK_TIMEZONE;
}
