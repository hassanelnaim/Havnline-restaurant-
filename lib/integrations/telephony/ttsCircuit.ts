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

let cachedReading: { degraded: boolean; hosted?: boolean; at: number } | null = null;

// Second switch, for ElevenLabs voices spoken by Twilio (TTS_MODE twilio).
// When Twilio can't speak one it skips the line, so the caller hears
// nothing; Twilio's error webhook (/api/webhooks/twilio/debugger) trips
// this, and calls use a basic Polly voice until it clears.
const HOSTED_SERVICE = "twilio_hosted_tts";
export const HOSTED_TRIP_SECONDS = 10 * 60;
let lastTripWriteAt = 0;

export async function isTtsDegraded(): Promise<boolean> {
  const now = Date.now();
  if (cachedReading && now - cachedReading.at < READ_CACHE_MS) return cachedReading.degraded;

  let degraded = false;
  let hosted = false;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("service_circuit_breakers")
      .select("service, tripped_until")
      .in("service", [SERVICE, HOSTED_SERVICE]);
    if (!error && data) {
      for (const row of data) {
        const on = Boolean(row.tripped_until) && new Date(row.tripped_until as string).getTime() > now;
        if (row.service === SERVICE) degraded = on;
        if (row.service === HOSTED_SERVICE) hosted = on;
      }
    }
  } catch {
    degraded = false;
    hosted = false;
  }

  cachedReading = { degraded, hosted, at: now };
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


/**
 * Whether Twilio-hosted ElevenLabs voices are switched off right now, from
 * the reading isTtsDegraded() just took (every turn calls it before
 * building its TwiML). No reading in the last minute counts as "fine".
 */
export function hostedTtsDegradedCached(): boolean {
  return Boolean(cachedReading?.hosted) && Date.now() - (cachedReading?.at ?? 0) < 60_000;
}

/** Switch Twilio-hosted voices off for a while (see HOSTED_SERVICE). */
export async function tripHostedTtsCircuit(reason: string, seconds: number = HOSTED_TRIP_SECONDS): Promise<boolean> {
  const now = Date.now();
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("service_circuit_breakers").upsert(
      {
        service: HOSTED_SERVICE,
        tripped_until: new Date(now + seconds * 1000).toISOString(),
        last_reason: reason.slice(0, 300),
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: "service" }
    );
    if (error) {
      console.error("Could not switch off Twilio-hosted voices:", error.message);
      return false;
    }
    cachedReading = { degraded: cachedReading?.degraded ?? false, hosted: true, at: now };
    return true;
  } catch (err) {
    console.error("Could not switch off Twilio-hosted voices:", err);
    return false;
  }
}
