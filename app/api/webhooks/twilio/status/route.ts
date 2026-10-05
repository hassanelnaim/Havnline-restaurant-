import { NextRequest, NextResponse } from "next/server";
import { endCall, findInProgressCallId } from "@/lib/ai/receptionist";
import { resolveBusinessFromPhoneNumber } from "@/lib/ai/context";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { getRequestUrl } from "@/lib/ai/twimlHelpers";
import { sendCallNotificationEmail } from "@/lib/notifications/call-email";
import { reportCallErrors } from "@/lib/monitoring/callErrorReport";
import { settleWithin } from "@/lib/monitoring/platformAlert";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/twilio/status
 *
 * Twilio posts here when a call's status changes — not just once at
 * the end. If this route is configured to fire on every status change
 * (ringing, in-progress, completed, etc.), calling endCall() on an
 * early event would record duration=0 before the real duration is
 * ever known, since Twilio's CallDuration is only meaningful once the
 * call has actually completed. This is a likely real cause of calls
 * always showing "0m" — added a check so duration is only ever
 * recorded on a genuine terminal status.
 */
const TERMINAL_STATUSES = ["completed", "busy", "failed", "no-answer", "canceled"];

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => (params[key] = String(value)));

  const resolved = await resolveBusinessFromPhoneNumber(params.To);
  const signature = request.headers.get("x-twilio-signature");
  const fullUrl = getRequestUrl(request);
  if (!validateTwilioSignature(signature, fullUrl, params, resolved?.subAccountAuthToken)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  let callId = request.nextUrl.searchParams.get("callId");
  const callStatus = params.CallStatus;
  const duration = parseInt(params.CallDuration || "0", 10);

  // The number-level callback URL has no callId (see
  // findInProgressCallId), so find the call by who was calling.
  if (!callId && resolved && params.From && TERMINAL_STATUSES.includes(callStatus)) {
    callId = await findInProgressCallId(resolved.businessId, params.From);
  }

  if (callId && TERMINAL_STATUSES.includes(callStatus)) {
    await endCall(callId, duration);

    // sendCallNotificationEmail no-ops on its own if the business hasn't
    // turned call notifications on. Awaited (briefly) rather than fired
    // and forgotten: on serverless, work left running after the response
    // is sent can be cut off before the email goes out.
    if (resolved) {
      await settleWithin(
        sendCallNotificationEmail(resolved.businessId, callId).catch((err) => console.error("Call notification email failed:", err)),
        5000
      );
    }
  } else if (TERMINAL_STATUSES.includes(callStatus)) {
    console.error(`[twilio-status] could not match ended call ${params.CallSid} from ${params.From} to a call record`);
  }

  // Independent of the block above (which needs a callId this callback
  // doesn't always carry): once a call is over, ask Twilio whether it
  // logged any errors for it, and email the platform owner if so. Bounded
  // so a slow Twilio API can't hold up this webhook.
  if (resolved?.subAccountAuthToken && params.CallSid && params.AccountSid && TERMINAL_STATUSES.includes(callStatus)) {
    await settleWithin(
      reportCallErrors({
        businessId: resolved.businessId,
        accountSid: params.AccountSid,
        authToken: resolved.subAccountAuthToken,
        callSid: params.CallSid,
        callStatus,
      }).catch((err) => console.error("Call error report failed:", err)),
      6000
    );
  }

  return new NextResponse("OK");
}
