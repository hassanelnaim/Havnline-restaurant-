import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { listVoices, isElevenLabsConfigured } from "@/lib/integrations/telephony/elevenlabsProvider";
import { VOICE_CATALOG } from "@/lib/ai/voiceCatalog";

/**
 * The voices a restaurant can pick: the fixed catalog (lib/ai/voiceCatalog.ts),
 * never whatever happens to be in the ElevenLabs account. ElevenLabs is
 * only asked for each voice's sample clip; without it (no key, an outage)
 * the list still loads, just without play buttons.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!(await getCurrentBusinessId())) return NextResponse.json({ error: "No business found.", voices: [] }, { status: 403 });

  const previews = new Map<string, string | null>();
  if (isElevenLabsConfigured()) {
    try {
      for (const v of await listVoices()) previews.set(v.voiceId, v.previewUrl);
    } catch (err) {
      console.error("Couldn't load ElevenLabs voice samples:", err);
    }
  }
  const voices = VOICE_CATALOG.map((v) => ({
    voiceId: v.voiceId,
    name: v.name,
    previewUrl: previews.get(v.voiceId) ?? null,
    category: v.gender,
    description: `${v.gender} · ${v.accent} · ${v.tone}`,
    accent: v.accent,
  }));
  return NextResponse.json({ voices });
}
