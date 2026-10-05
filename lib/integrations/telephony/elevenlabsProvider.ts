import type { VoiceId } from "@/lib/database/types";

const DEFAULT_VOICE_MAP: Record<Exclude<VoiceId, "custom">, string> = {
  alex_professional: process.env.ELEVENLABS_VOICE_ALEX || "pNInz6obpgDQGcFmaJgB",
  sarah_warm: process.env.ELEVENLABS_VOICE_SARAH || "21m00Tcm4TlvDq8ikWAM",
  james_calm: process.env.ELEVENLABS_VOICE_JAMES || "VR6AewLTigWG4xSOukaG",
  emma_friendly: process.env.ELEVENLABS_VOICE_EMMA || "EXAVITQu4vr4xnSDxMaL",
};

// The TTS model decides two things that matter at scale: how long each
// request holds one of the plan's concurrent-request slots, and WHICH
// slot pool it counts against — ElevenLabs gives Flash/Turbo models
// roughly double the concurrency of its other models on every plan. It's
// an env setting (not a code change) so it can be switched, measured
// with scripts/loadtest-providers.mjs, and switched back without a
// deploy. Default is unchanged from before.
const DEFAULT_TTS_MODEL = "eleven_v4_turbo";
export function getTtsModelId(): string {
  return process.env.ELEVENLABS_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
}

/**
 * How the app's speech is produced. One switch, TTS_MODE:
 *
 *  - "own" (default): every line is synthesized by THIS app's ElevenLabs
 *    account and played back as audio. Capacity is that account's
 *    concurrent-request limit; when it is saturated or down the fallback
 *    is a different (Polly) voice.
 *  - "auto": same as "own" until the shared breaker says our ElevenLabs is
 *    saturated; then the same voice is played by Twilio's <Say> instead,
 *    on Twilio's capacity, so the caller doesn't hear a different voice.
 *  - "twilio": premade voices are always played by Twilio's <Say>. This
 *    app's ElevenLabs account (and its concurrency cap) is out of the
 *    picture for them.
 *
 * Twilio's <Say> can speak ElevenLabs voices itself (public beta as of
 * Sep 2026) as `ElevenLabs.<voice id>`: Twilio calls ElevenLabs under its
 * own agreement and bills the characters to the Twilio account. Twilio
 * picks the model (Flash 2.0 for English) and does not document a
 * concurrency limit, and it costs more per character than calling
 * ElevenLabs directly — which is why it is opt-in and should be confirmed
 * on a real call before anything depends on it.
 *
 * Custom (cloned) voices live in THIS app's ElevenLabs account, which
 * Twilio can't reach, so they never use the Twilio-hosted path.
 */
export type TtsMode = "own" | "auto" | "twilio";

export function getTtsMode(): TtsMode {
  const raw = process.env.TTS_MODE?.trim().toLowerCase();
  return raw === "auto" || raw === "twilio" ? raw : "own";
}

export function twilioHostedElevenLabsVoice(voiceId: VoiceId | null | undefined): string | null {
  if (getTtsMode() === "own") return null;
  if (voiceId === "custom") return null;
  return `ElevenLabs.${resolveElevenLabsVoiceId(voiceId)}`;
}

export type SpeechPath = "play" | "twilio-hosted" | "polly";

/**
 * Decides how one spoken line is produced. Kept as a pure function (no
 * I/O) so every combination of mode / voice / provider health can be
 * tested directly.
 */
export function chooseSpeechPath(input: {
  voiceId: VoiceId | null | undefined;
  /** The shared breaker says our own ElevenLabs is currently unusable. */
  ttsDegraded: boolean;
  elevenConfigured: boolean;
}): SpeechPath {
  const hosted = twilioHostedElevenLabsVoice(input.voiceId) !== null;
  if (hosted && (getTtsMode() === "twilio" || input.ttsDegraded || !input.elevenConfigured)) return "twilio-hosted";
  if (input.elevenConfigured && !input.ttsDegraded) return "play";
  return "polly";
}

export function isElevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

export function resolveElevenLabsVoiceId(
  voiceId: VoiceId | null | undefined,
  providerVoiceRef?: string | null
): string {
  if (voiceId === "custom" && providerVoiceRef) return providerVoiceRef;
  if (voiceId && voiceId !== "custom") return DEFAULT_VOICE_MAP[voiceId];
  return DEFAULT_VOICE_MAP.alex_professional;
}

/**
 * Thrown when speech couldn't be produced. `unavailable` distinguishes
 * "ElevenLabs as a whole can't serve us right now" (rate/concurrency
 * limit, outage, exhausted quota, timeout — worth switching the whole
 * app to Twilio's built-in voice for a few seconds, see ttsCircuit.ts)
 * from "this one request was wrong" (bad voice id, malformed text),
 * which says nothing about the provider's health and must not trip
 * anything.
 */
export class TtsError extends Error {
  constructor(message: string, public readonly status: number | null, public readonly unavailable: boolean) {
    super(message);
    this.name = "TtsError";
  }
}

// Twilio is waiting on this audio mid-call, so every attempt and the
// whole retry sequence are bounded. A single hung request used to be
// able to hold a call in silence until Twilio's own timeout.
const TTS_ATTEMPT_TIMEOUT_MS = 4000;
const TTS_MAX_ATTEMPTS = 3;
const TTS_TOTAL_BUDGET_MS = 6500;
const TTS_BACKOFF_BASE_MS = 200;
const TTS_BACKOFF_CAP_MS = 1500;

// 401/402 are included: an invalid or out-of-quota key means ElevenLabs
// is unusable for EVERY request, and Twilio's own voice is a far better
// outcome than silence.
function isUnavailableStatus(status: number): boolean {
  return status === 401 || status === 402 || status === 408 || status === 429 || status >= 500;
}

// Only worth retrying if waiting could plausibly help.
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// "Full jitter" backoff, per ElevenLabs' own guidance for 429s: spreading
// retries randomly across the interval stops a burst of rejected
// requests from all retrying at the same instant and colliding again.
function backoffDelayMs(attemptIndex: number, retryAfterHeader: string | null): number {
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    // The server said exactly how long to wait; honor it over a guess.
    return retryAfterSeconds * 1000;
  }
  const ceiling = Math.min(TTS_BACKOFF_CAP_MS, TTS_BACKOFF_BASE_MS * 2 ** attemptIndex);
  return Math.random() * ceiling;
}

export interface SynthesizeOptions {
  /**
   * Called when a request has been rate-limited twice in a row — i.e. the
   * account is genuinely at its concurrency ceiling rather than having hit
   * a one-off collision that a jittered retry would clear. The caller can
   * use it to start shedding load right away instead of waiting for this
   * request to burn through its whole retry budget and fail.
   */
  onSaturated?: () => void;
}

export async function synthesizeSpeech(text: string, elevenVoiceId: string, options: SynthesizeOptions = {}): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new TtsError("ELEVENLABS_API_KEY is not configured.", null, true);
  }

  const startedAt = Date.now();
  let lastError: TtsError | null = null;

  for (let attempt = 0; attempt < TTS_MAX_ATTEMPTS; attempt++) {
    let retryAfterHeader: string | null = null;

    try {
      // optimize_streaming_latency only applies to eleven_turbo_v2_5 /
      // eleven_flash_v2_5 — ElevenLabs rejects it outright (400
      // unsupported_model) when model_id is eleven_v4_turbo, which is
      // what's actually used below. v4 models have their own, different
      // latency behavior and don't take this param at all.
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${elevenVoiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          // eleven_turbo_v2_5 is deprecated (ElevenLabs now treats it as
          // just a slower version of eleven_flash_v2_5). eleven_v4_turbo
          // is the current real-time-appropriate model with noticeably
          // more natural output than either Turbo or Flash — still fast
          // enough for a live phone call (~100ms vs. Flash's ~75ms, a
          // difference a caller won't perceive), so this is a quality
          // upgrade with no real latency tradeoff for this use case.
          model_id: getTtsModelId(),
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal: AbortSignal.timeout(TTS_ATTEMPT_TIMEOUT_MS),
      });

      if (response.ok) return await response.arrayBuffer();

      const errText = await response.text().catch(() => "");
      retryAfterHeader = response.headers.get("retry-after");
      lastError = new TtsError(`ElevenLabs TTS failed: ${response.status} ${errText}`, response.status, isUnavailableStatus(response.status));

      if (response.status === 429) {
        if (attempt >= 1) options.onSaturated?.();
        // These headers are how you find out you're near your plan's
        // concurrency ceiling BEFORE callers notice — worth having in
        // the logs.
        console.warn(
          `[elevenlabs] 429 on attempt ${attempt + 1}: concurrent=${response.headers.get("current-concurrent-requests")} ` +
            `max=${response.headers.get("maximum-concurrent-requests")}`
        );
      }

      if (!isRetryableStatus(response.status)) throw lastError;
    } catch (err) {
      if (err instanceof TtsError) {
        if (!isRetryableStatus(err.status ?? 0)) throw err;
      } else {
        // Timeout or network failure — the provider didn't answer.
        lastError = new TtsError(
          `ElevenLabs TTS request failed: ${err instanceof Error ? err.message : String(err)}`,
          null,
          true
        );
      }
    }

    if (attempt === TTS_MAX_ATTEMPTS - 1) break;

    const delay = backoffDelayMs(attempt, retryAfterHeader);
    // No point sleeping into a retry we've already run out of time for.
    if (Date.now() - startedAt + delay + TTS_ATTEMPT_TIMEOUT_MS > TTS_TOTAL_BUDGET_MS) break;
    await sleep(delay);
  }

  throw lastError ?? new TtsError("ElevenLabs TTS failed for an unknown reason.", null, true);
}

export interface ElevenLabsVoice {
  voiceId: string;
  name: string;
  previewUrl: string | null;
  category: string | null;
  description: string | null;
}

export async function listVoices(): Promise<ElevenLabsVoice[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not configured.");
  }

  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`ElevenLabs list voices failed: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const voices: any[] = data.voices || [];

  return voices.map((v) => ({
    voiceId: v.voice_id,
    name: v.name,
    previewUrl: v.preview_url || null,
    category: v.category || null,
    description: v.labels?.description || v.labels?.accent || null,
  }));
}
