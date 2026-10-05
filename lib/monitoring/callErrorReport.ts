import { createAdminClient } from "@/lib/supabase/admin";
import { fetchCallErrorAlerts } from "@/lib/monitoring/twilioCallAlerts";
import { sendPlatformAlert } from "@/lib/monitoring/platformAlert";

/**
 * Run when Twilio says a call has ended: asks Twilio whether it recorded
 * any errors for that call and, if so, emails the platform owner. The
 * errors are generated while the call is in progress, so by the time the
 * call-ended callback arrives they are already on record.
 */
export async function reportCallErrors(input: {
  businessId: string;
  accountSid: string;
  authToken: string;
  callSid: string;
  callStatus: string;
}): Promise<void> {
  const alerts = await fetchCallErrorAlerts(input.accountSid, input.authToken, input.callSid);
  if (alerts.length === 0) return;

  const admin = createAdminClient();
  const { data: business } = await admin.from("businesses").select("name").eq("id", input.businessId).maybeSingle();

  const codes = Array.from(new Set(alerts.map((a) => a.errorCode || "unknown")));
  const first = alerts[0];

  await sendPlatformAlert({
    // One email per distinct error code per window.
    key: `twilio-call-error-${codes.sort().join("+")}`.slice(0, 100),
    subject: `HavnLine: Twilio reported ${alerts.length === 1 ? "an error" : `${alerts.length} errors`} on a call (${codes.join(", ")})`,
    heading: "Twilio recorded an error on a call",
    intro: "Twilio logged at least one error during a phone call. The caller may have heard silence or a dropped line. Details below; the full record is in Twilio Console, Monitor, Debugger.",
    rows: [
      { label: "Business", value: business?.name || input.businessId },
      { label: "Call", value: `${input.callSid} (${input.callStatus})` },
      { label: "Error", value: codes.join(", ") },
      { label: "Message", value: first.message },
      ...(first.moreInfo ? [{ label: "Docs", value: first.moreInfo }] : []),
      ...(first.requestUrl ? [{ label: "URL", value: first.requestUrl }] : []),
    ],
  });
}
