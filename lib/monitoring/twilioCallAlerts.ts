/**
 * Reads Twilio's own error record for one call (the same alerts that show
 * up in Console -> Monitor -> Debugger) so a failure that Twilio saw but
 * this app can't — a <Say> voice it couldn't speak, a webhook it couldn't
 * reach, TwiML it couldn't parse — can be reported instead of sitting
 * unseen until someone happens to open the Debugger.
 *
 * Scoped to a single call SID on purpose: that excludes unrelated noise
 * such as texting/A2P registration errors, which belong to messages, not
 * calls. Never throws: a monitoring check must not be able to break the
 * webhook that runs it.
 *
 * Twilio's Alerts list can only be filtered by log level and date — it has
 * no per-call filter, and silently ignores one if you send it. This used to
 * send `ResourceSid=<call>` and trust the result, so every call reported the
 * account's 20 most recent errors of any kind (old texting errors, an old
 * webhook 404), whether or not they had anything to do with that call. Now
 * it asks for the recent window only and keeps the alerts whose
 * resource_sid really is this call.
 */

export interface TwilioCallAlert {
  errorCode: string | null;
  message: string;
  moreInfo: string | null;
  requestUrl: string | null;
}

const MAX_MESSAGE_LENGTH = 300;
const LOOKBACK_MS = 3 * 60 * 60 * 1000;
const PAGE_SIZE = 500;

// Twilio stores alert_text as a URL-encoded form string, e.g.
// "Msg=Invalid%20voice&ErrorCode=13520&...". Pull out the human part.
export function parseAlertText(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "(no details)";
  let text = raw;
  if (raw.includes("=")) {
    try {
      const params = new URLSearchParams(raw);
      text = params.get("Msg") || params.get("msg") || raw;
    } catch {
      text = raw;
    }
  }
  return text.slice(0, MAX_MESSAGE_LENGTH);
}

export async function fetchCallErrorAlerts(
  accountSid: string,
  authToken: string,
  callSid: string,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date()
): Promise<TwilioCallAlert[]> {
  try {
    // A call's errors are logged while it is in progress, so the last few
    // hours always cover it (no call lasts that long).
    const since = new Date(now.getTime() - LOOKBACK_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
    const url = `https://monitor.twilio.com/v1/Alerts?LogLevel=error&StartDate=${encodeURIComponent(since)}&PageSize=${PAGE_SIZE}`;
    const response = await fetchImpl(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.error(`[twilio-alerts] Monitor API returned ${response.status} for call ${callSid}`);
      return [];
    }
    const body = (await response.json()) as { alerts?: Array<Record<string, unknown>> };
    return (body.alerts || []).filter((a) => a.resource_sid === callSid).map((a) => ({
      errorCode: a.error_code != null ? String(a.error_code) : null,
      message: parseAlertText(a.alert_text),
      moreInfo: typeof a.more_info === "string" ? a.more_info : null,
      requestUrl: typeof a.request_url === "string" ? a.request_url : null,
    }));
  } catch (err) {
    console.error("[twilio-alerts] could not read Twilio alerts:", err);
    return [];
  }
}
