import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveBusinessFromPhoneNumber } from "@/lib/ai/context";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { getRequestUrl } from "@/lib/ai/twimlHelpers";
import { sendPlatformAlert, settleWithin } from "@/lib/monitoring/platformAlert";
import { isTransferLoop } from "@/lib/ai/liveTransfer";
import { getSiteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

const SITE_URL = getSiteUrl();

/**
 * POST /api/webhooks/twilio/voice-fallback
 *
 * Twilio's "if the voice webhook fails" URL. It is called when the main
 * voice webhook times out, returns an error, or returns TwiML Twilio
 * can't parse — exactly the moments a caller would otherwise hear a
 * generic error and be hung up on.
 *
 * Deliberately simple and independent of the AI and speech pipeline:
 * whatever broke the main path (the AI provider, speech synthesis, the
 * database) must not also break this. It uses Twilio's built-in voice,
 * never throws, and tries to ring the restaurant's own phone so the
 * caller still reaches a person.
 *
 * It also serves as its own <Dial> action: when the attempt to reach the
 * restaurant finishes, Twilio posts back here with DialCallStatus.
 */
function twiml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { "Content-Type": "text/xml" } });
}
function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SORRY_ONLY =
  `<Say>Sorry, we're having trouble taking your call right now. Please try again in a few minutes.</Say><Hangup/>`;
const SORRY_NO_ANSWER =
  `<Say>Sorry, no one is available to take your call right now. Please try again in a few minutes.</Say><Hangup/>`;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const params: Record<string, string> = {};
    formData.forEach((value, key) => (params[key] = String(value)));

    // Second leg: the attempt to reach the restaurant has finished.
    if (params.DialCallStatus) {
      return twiml(params.DialCallStatus === "completed" ? `<Hangup/>` : SORRY_NO_ANSWER);
    }

    const to = params.To || "";
    const from = params.From || "";

    // First leg. Look up whose number this is; if that fails (the
    // database may be the thing that is down), fall back to the plain
    // apology rather than failing again.
    const resolved = to ? await resolveBusinessFromPhoneNumber(to).catch(() => null) : null;

    if (resolved) {
      const signature = request.headers.get("x-twilio-signature");
      if (!validateTwilioSignature(signature, getRequestUrl(request), params, resolved.subAccountAuthToken)) {
        return new Response("Invalid signature", { status: 403 });
      }
    }

    // Tell the platform owner, throttled so an outage is one email.
    void settleWithin(
      sendPlatformAlert({
        key: "voice-fallback-triggered",
        subject: "HavnLine: a call fell back to the emergency path",
        heading: "The main call handler failed",
        intro:
          "Twilio could not get a valid response from HavnLine's main voice webhook, so it used the fallback. Callers are being told there is a problem and, where possible, connected to the restaurant's own phone.",
        rows: [
          { label: "Number called", value: to || "unknown" },
          { label: "Twilio error code", value: params.ErrorCode || "none given" },
          { label: "Failing URL", value: (params.ErrorUrl || "none given").slice(0, 200) },
        ],
      }),
      1500
    );

    let restaurantPhone: string | null = null;
    if (resolved) {
      const admin = createAdminClient();
      const { data } = await admin.from("businesses").select("phone").eq("id", resolved.businessId).single();
      restaurantPhone = data?.phone || null;
    }

    // Never ring the restaurant from its own number (it would loop back
    // here) or when there is nowhere to ring.
    if (!restaurantPhone || isTransferLoop({ from, to, restaurantPhone, recentTransfer: true })) {
      return twiml(SORRY_ONLY);
    }

    const action = `${SITE_URL}/api/webhooks/twilio/voice-fallback`;
    return twiml(
      `<Say>Sorry, our order system is having trouble. Let me connect you to the restaurant.</Say>` +
        `<Dial callerId="${escapeXml(to)}" timeout="25" action="${escapeXml(action)}" method="POST">${escapeXml(restaurantPhone)}</Dial>`
    );
  } catch (err) {
    console.error("voice-fallback failed:", err);
    return twiml(SORRY_ONLY);
  }
}
