import { NextRequest, NextResponse } from "next/server";
import { validateTwilioSignature } from "@/lib/integrations/telephony/twilioProvider";
import { getRequestUrl } from "@/lib/ai/twimlHelpers";
import { tripHostedTtsCircuit, HOSTED_TRIP_SECONDS } from "@/lib/integrations/telephony/ttsCircuit";
import { sendPlatformAlert, settleWithin } from "@/lib/monitoring/platformAlert";

/**
 * Twilio's error webhook (Console > Monitor > Logs > Errors > Webhook, set
 * on the main account). Twilio posts here whenever it logs an error or
 * warning. One kind matters for live calls: when it can't speak a <Say>
 * voice (an ElevenLabs voice it doesn't support, or its voice provider
 * failing) it skips the line and the caller hears nothing. On those,
 * calls switch to a basic Polly voice for a while (ttsCircuit.ts) and the
 * platform owner gets an email. Everything else is acknowledged and ignored.
 */

/** Say errors: 13511 is "invalid voice"; the rest of 135xx are other <Say> problems. */
function isSpeechError(code: string, text: string): boolean {
  if (code === "13511") return true;
  if (/^135\d\d$/.test(code) && /voice|elevenlabs|generative|text.to.speech|\btts\b/i.test(text)) return true;
  return /elevenlabs|generative voice|text.to.speech provider/i.test(text);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => (params[key] = String(value)));

  if (!validateTwilioSignature(request.headers.get("x-twilio-signature"), getRequestUrl(request), params, null)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(params.Payload || "{}");
  } catch {
    payload = {};
  }
  const code = String(payload.error_code ?? "");
  const more = payload.more_info && typeof payload.more_info === "object" ? JSON.stringify(payload.more_info) : String(payload.more_info ?? "");
  const text = `${more} ${String(payload.message ?? "")}`.slice(0, 2000);

  if (!isSpeechError(code, text)) return new NextResponse(null, { status: 204 });

  const reason = `Twilio error ${code || "?"}: ${text.trim().slice(0, 200)}`;
  console.error(`[twilio-debugger] speech failed on a call, switching to the basic voice: ${reason}`);
  const tripped = await tripHostedTtsCircuit(reason);
  await settleWithin(
    sendPlatformAlert({
      key: "twilio-hosted-tts-failed",
      throttleMinutes: 30,
      subject: "HavnLine: Twilio couldn't speak a voice on a call",
      heading: "Calls switched to the basic voice",
      intro: tripped
        ? `Twilio reported that it couldn't speak an ElevenLabs voice, so callers heard silence on that line. For the next ${HOSTED_TRIP_SECONDS / 60} minutes calls use a basic Polly voice instead, then go back to normal. If this keeps happening, check Twilio's error log and the voice list.`
        : "Twilio reported that it couldn't speak an ElevenLabs voice, and HavnLine could not switch calls to the basic voice (database error). Check Twilio's error log.",
      rows: [
        { label: "Error code", value: code || "none given" },
        { label: "Call or resource", value: String(payload.resource_sid ?? params.Sid ?? "unknown") },
        { label: "Detail", value: text.trim().slice(0, 300) || "none" },
      ],
    }),
    3000
  );
  return new NextResponse(null, { status: 204 });
}
