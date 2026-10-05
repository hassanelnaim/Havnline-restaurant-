import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A shared "ElevenLabs is currently unusable" flag, so that when it
 * starts refusing requests (concurrency limit hit during a rush, an
 * outage, an exhausted quota) callers hear Twilio's built-in voice for
 * a few seconds instead of dead air. See migration 026 for why this
 * lives in the database rather than in memory: each webhook can be
 * served by a different serverless instance.
 *
 * Every function here fails OPEN — if the table is missing (migration
 * not run yet) or the query errors, the answer is "not tripped" and the
 * app behaves exactly as it did before this existed. A broken safety
 * net must never be what takes calls down.
 */

const SERVICE = "elevenlabs_tts";

// Long enough to shed load and let a saturated provider recover, short
// enough that the natural voice comes back quickly once it has.
const TRIP_SECONDS = 20;

// Reads happen on every webhook turn; a burst of turns landing on the
// same warm instance shouldn't each cost a database round trip.
const READ_CACHE_MS = 2000;
// A burst of failing /api/tts requests would otherwise each upsert the
// same row.
const WRITE_THROTTLE_MS = 5000;

let cachedReading: { degraded: boolean; at: number } | null = null;
let lastTripWriteAt = 0;

export async function isTtsDegraded(): Promise<boolean> {
  const now = Date.now();
  if (cachedReading && now - cachedReading.at < READ_CACHE_MS) return cachedReading.degraded;

  let degraded = false;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("service_circuit_breakers")
      .select("tripped_until")
      .eq("service", SERVICE)
      .maybeSingle();
    if (!error && data?.tripped_until) {
      degraded = new Date(data.tripped_until).getTime() > now;
    }
  } catch {
    degraded = false;
  }

  cachedReading = { degraded, at: now };
  return degraded;
}

export async function tripTtsCircuit(reason: string, seconds: number = TRIP_SECONDS): Promise<void> {
  const now = Date.now();
  if (now - lastTripWriteAt < WRITE_THROTTLE_MS) return;
  lastTripWriteAt = now;
  // This instance knows it's tripped without asking the database.
  cachedReading = { degraded: true, at: now };

  try {
    const admin = createAdminClient();
    const { error } = await admin.from("service_circuit_breakers").upsert(
      {
        service: SERVICE,
        tripped_until: new Date(now + seconds * 1000).toISOString(),
        last_reason: reason.slice(0, 300),
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: "service" }
    );
    if (error) console.error("Could not record TTS circuit trip:", error.message);
  } catch (err) {
    console.error("Could not record TTS circuit trip:", err);
  }
}
