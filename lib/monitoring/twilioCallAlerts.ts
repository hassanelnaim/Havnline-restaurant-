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
 */

export interface TwilioCallAlert {
  errorCode: string | null;
  message: string;
  moreInfo: string | null;
  requestUrl: string | null;
}

const MAX_MESSAGE_LENGTH = 300;

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
  fetchImpl: typeof fetch = fetch
): Promise<TwilioCallAlert[]> {
  try {
    const url = `https://monitor.twilio.com/v1/Alerts?ResourceSid=${encodeURIComponent(callSid)}&LogLevel=error&PageSize=20`;
    const response = await fetchImpl(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      console.error(`[twilio-alerts] Monitor API returned ${response.status} for call ${callSid}`);
      return [];
    }
    const body = (await response.json()) as { alerts?: Array<Record<string, unknown>> };
    return (body.alerts || []).map((a) => ({
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
