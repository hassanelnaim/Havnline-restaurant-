import { NextRequest, NextResponse } from "next/server";
import { endCall } from "@/lib/ai/receptionist";
import { resolveBusinessFromPhoneNumber } from "@/lib/ai/context";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { getRequestUrl } from "@/lib/ai/twimlHelpers";
import { sendCallNotificationEmail } from "@/lib/notifications/call-email";

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

  const callId = request.nextUrl.searchParams.get("callId");
  const callStatus = params.CallStatus;
  const duration = parseInt(params.CallDuration || "0", 10);

  if (callId && TERMINAL_STATUSES.includes(callStatus)) {
    await endCall(callId, duration);

    // Fire-and-forget: don't hold up Twilio's webhook response on an
    // email send. sendCallNotificationEmail no-ops on its own if the
    // business hasn't turned call notifications on.
    if (resolved) {
      sendCallNotificationEmail(resolved.businessId, callId).catch((err) => console.error("Call notification email failed:", err));
    }
  }

  return new NextResponse("OK");
}
