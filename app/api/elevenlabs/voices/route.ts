import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentBusinessId } from "@/lib/supabase/business";
import { listVoices, isElevenLabsConfigured } from "@/lib/integrations/telephony/elevenlabsProvider";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  // Only accounts that belong to a restaurant can list voices.
  if (!(await getCurrentBusinessId())) return NextResponse.json({ error: "No business found.", voices: [] }, { status: 403 });

  if (!isElevenLabsConfigured()) {
    return NextResponse.json({ error: "ElevenLabs is not connected yet.", voices: [] }, { status: 200 });
  }

  try {
    const voices = await listVoices();
    return NextResponse.json({ voices });
  } catch (err) {
    console.error("Failed to list ElevenLabs voices:", err);
    return NextResponse.json({ error: "Could not load voices right now.", voices: [] }, { status: 200 });
  }
}
