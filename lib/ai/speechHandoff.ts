import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What the caller said used to travel from /gather to /process and
 * /gather-continue inside the URL (?speech=..., ?original=...), so names,
 * phone numbers and addresses landed in Twilio's and Vercel's request logs.
 * Now the words are stored for a moment (migration 037) and only an id
 * travels in the URL. The cleanup cron deletes old rows.
 */
export async function storeSpeech(callId: string, speech: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("call_speech_handoffs").insert({ call_id: callId, speech }).select("id").single();
  if (error || !data) {
    console.error(`[speechHandoff] could not store speech for call ${callId} (run migration 037?):`, error?.message);
    return null;
  }
  return data.id as string;
}

export async function readSpeech(callId: string, handoffId: string | null): Promise<string | null> {
  if (!handoffId) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("call_speech_handoffs").select("speech").eq("id", handoffId).eq("call_id", callId).maybeSingle();
  return (data?.speech as string | undefined) ?? null;
}

/** The URL parameter: `h=<id>` when stored, the words themselves only if storing failed. */
export function speechParam(name: "speech" | "original", speech: string, handoffId: string | null): string {
  return handoffId ? `h=${handoffId}` : `${name}=${encodeURIComponent(speech)}`;
}
