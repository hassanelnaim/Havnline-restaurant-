import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { synthesizeSpeech, isElevenLabsConfigured } from "@/lib/integrations/telephony/elevenlabsProvider";
import { logElevenLabsUsage } from "@/lib/usage/tracking";

// A deliberately short, generic line — this exists purely so an owner
// can hear what their OWN AI actually sounds like before picking a
// voice, not to showcase the voice itself.
const SAMPLE_TEXT = "Hi, thanks for calling — how can I help you today?";

/**
 * POST /api/elevenlabs/preview
 *
 * ElevenLabs' own voice-library preview (the clip GET
 * /api/elevenlabs/voices returns a previewUrl for) is generated with
 * ElevenLabs' own showcase settings — not the model/voice_settings
 * synthesizeSpeech actually uses on a real call (lib/integrations/
 * telephony/elevenlabsProvider.ts optimizes for phone-call latency,
 * which costs a little naturalness). That mismatch is exactly why a
 * voice can sound "more robotic" on a real call than it did when
 * picking it — this route runs the SAME function with the SAME
 * settings a live call would, so what an owner hears here is what
 * their customers actually hear.
 *
 * Session-authenticated (not the signed-URL scheme /api/tts uses for
 * Twilio) since this is only ever called from the logged-in dashboard.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  if (!isElevenLabsConfigured()) {
    return NextResponse.json({ error: "ElevenLabs is not connected yet." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const voiceId = typeof body?.voiceId === "string" ? body.voiceId.trim() : "";
  if (!voiceId) return NextResponse.json({ error: "Missing voiceId." }, { status: 400 });

  try {
    const audioBuffer = await synthesizeSpeech(SAMPLE_TEXT, voiceId);

    // Real usage, same as a live call would log — fire-and-forget,
    // never delays the audio response. Best-effort: a business this
    // account isn't tied to yet (very first login) just skips logging.
    getCurrentBusinessId()
      .then((businessId) => {
        if (businessId) logElevenLabsUsage(businessId, SAMPLE_TEXT.length);
      })
      .catch(() => {});

    return new NextResponse(audioBuffer, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("ElevenLabs preview synthesis failed:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not generate a preview." }, { status: 500 });
  }
}
