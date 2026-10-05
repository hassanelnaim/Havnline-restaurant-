#!/usr/bin/env node
/**
 * Measures how ElevenLabs and Anthropic actually behave on YOUR accounts
 * when many requests land at once — the thing a dinner rush does — so
 * capacity decisions can be made from numbers instead of guesses.
 *
 * It fires N simultaneous requests at each provider, for several values
 * of N, and reports per level: how many succeeded, how many were
 * rate-limited (429/529), and the p50 / p95 latency. The highest level
 * with zero rate-limit errors and an acceptable p95 is roughly how many
 * simultaneous requests your current plan can carry.
 *
 * It does NOT touch your database, Twilio, or any real call. It does
 * spend real (tiny) provider credits: the default run is roughly 150
 * short TTS requests and 150 short Claude Haiku requests — on the order
 * of cents. Run it off-peak so it doesn't compete with real callers for
 * the same concurrency slots.
 *
 * Usage (from the repo root, with your real keys in the environment):
 *   ELEVENLABS_API_KEY=... ANTHROPIC_API_KEY=... node scripts/loadtest-providers.mjs
 *
 * Options:
 *   --levels=2,5,10,15,20,30   concurrency levels to try (default shown)
 *   --only=tts | --only=llm    test just one provider
 *   --voice=<elevenlabs voice id>   (default: the stock "Adam" voice)
 *   --tts-model=<model id>     (default: ELEVENLABS_TTS_MODEL or eleven_v4_turbo; try eleven_flash_v2_5)
 *   --llm-model=<model id>     (default: ANTHROPIC_PHONE_MODEL or claude-haiku-4-5-20251001)
 */

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);

// Keys are cleaned once: a stray space, quote, or the carriage return
// Windows Notepad adds at the end of every line makes the key an invalid
// HTTP header value, which fails EVERY request instantly and looks like
// a provider outage when it is really a typo in the file.
const clean = (v) => (v || "").trim().replace(/^["']|["']$/g, "").trim();
const ELEVEN_KEY = clean(process.env.ELEVENLABS_API_KEY);
const ANTHROPIC_KEY = clean(process.env.ANTHROPIC_API_KEY);

const LEVELS = (args.levels || "2,5,10,15,20,30").split(",").map((n) => parseInt(n, 10)).filter(Boolean);
const VOICE = args.voice || "pNInz6obpgDQGcFmaJgB";
const LLM_MODEL = args["llm-model"] || process.env.ANTHROPIC_PHONE_MODEL || "claude-haiku-4-5-20251001";
const TTS_MODEL = args["tts-model"] || process.env.ELEVENLABS_TTS_MODEL || "eleven_v4_turbo"; // default matches lib/integrations/telephony/elevenlabsProvider.ts

// Roughly the length of a real phone reply.
const SAMPLE_REPLIES = [
  "You got it, one large pepperoni and garlic knots. Anything to drink, or any other sides?",
  "Perfect. So that's a large pepperoni, garlic knots, and a two liter Coke, comes to twenty eight seventy five for pickup. Sound right?",
  "Sure thing, I can add extra cheese to that. Would you like anything else with your order?",
];

// A system prompt in the neighborhood of a real one (menu + rules), so
// input-token rate limits are exercised realistically rather than with
// a one-line prompt. ~2-3k tokens.
const FAKE_MENU = Array.from({ length: 70 }, (_, i) => `- Menu item ${i + 1}: house special number ${i + 1}, $${(8 + (i % 9)).toFixed(2)}, comes with choice of side`).join("\n");
const SYSTEM_PROMPT = `You are the automated phone order-taking assistant for a restaurant. Be brief and friendly.\n\nMenu:\n${FAKE_MENU}\n\nRules: only sell items on the menu; read the order back before confirming.`;

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function timed(fn) {
  const start = performance.now();
  try {
    const out = await fn();
    return { ...out, ms: performance.now() - start };
  } catch (err) {
    const cause = err && err.cause ? ` (cause: ${err.cause.code || ""} ${err.cause.message || err.cause})` : "";
    return { ok: false, status: "network", detail: `${err && err.message ? err.message : err}${cause}`, ms: performance.now() - start };
  }
}

async function ttsRequest(i) {
  return timed(async () => {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`, {
      method: "POST",
      headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: SAMPLE_REPLIES[i % SAMPLE_REPLIES.length], model_id: TTS_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) await res.arrayBuffer();
    const detail = res.ok ? undefined : (await res.text().catch(() => "")).slice(0, 300);
    return {
      ok: res.ok,
      status: res.status,
      detail,
      note: res.headers.get("maximum-concurrent-requests") ? `limit=${res.headers.get("maximum-concurrent-requests")}` : undefined,
    };
  });
}

async function llmRequest(i) {
  return timed(async () => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        max_tokens: 120,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Hi, can I get item number ${(i % 70) + 1} please?` }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) await res.json();
    const detail = res.ok ? undefined : (await res.text().catch(() => "")).slice(0, 300);
    return {
      ok: res.ok,
      status: res.status,
      detail,
      note: res.headers.get("anthropic-ratelimit-requests-limit")
        ? `req-limit=${res.headers.get("anthropic-ratelimit-requests-limit")}/min ` +
          `input-tokens-limit=${res.headers.get("anthropic-ratelimit-input-tokens-limit") ?? "?"}/min ` +
          `output-tokens-limit=${res.headers.get("anthropic-ratelimit-output-tokens-limit") ?? "?"}/min`
        : undefined,
    };
  });
}

async function runLevel(label, requestFn, n) {
  const results = await Promise.all(Array.from({ length: n }, (_, i) => requestFn(i)));
  const ok = results.filter((r) => r.ok).length;
  const limited = results.filter((r) => r.status === 429 || r.status === 529).length;
  const other = results.length - ok - limited;
  const latencies = results.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  const note = results.find((r) => r.note)?.note || "";
  console.log(
    `${label.padEnd(10)} concurrency=${String(n).padEnd(3)} ok=${String(ok).padEnd(3)} rate-limited=${String(limited).padEnd(3)} other-errors=${String(other).padEnd(3)} ` +
      `p50=${latencies.length ? Math.round(pct(latencies, 50)) + "ms" : "-"} p95=${latencies.length ? Math.round(pct(latencies, 95)) + "ms" : "-"} ${note}`
  );
  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    const counts = {};
    for (const f of failures) counts[f.status] = (counts[f.status] || 0) + 1;
    console.log(`   errors by status: ${JSON.stringify(counts)} | first error: ${String(failures[0].detail || "(no detail)").slice(0, 250)}`);
  }
  return { limited, other, ok, n };
}

async function sweep(label, requestFn) {
  console.log(`\n=== ${label} ===`);
  const probe = await requestFn(0);
  if (!probe.ok && probe.status !== 429 && probe.status !== 529) {
    console.log(`A single test request failed, so the concurrency sweep was skipped (it would only repeat this error).`);
    console.log(`status: ${probe.status}\ndetail: ${probe.detail || "(none)"}`);
    return;
  }
  let highestClean = 0;
  for (const n of LEVELS) {
    const r = await runLevel(label, requestFn, n);
    if (r.limited === 0 && r.other === 0) highestClean = n;
    // Let any provider-side queue drain between levels so one level's
    // backlog doesn't contaminate the next one's numbers.
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  console.log(`-> ${label}: highest level with zero errors = ${highestClean || "none (even the lowest level had errors)"}`);
}

async function main() {
  const only = args.only;
  const wantTts = !only || only === "tts";
  const wantLlm = !only || only === "llm";

  if (wantTts && !ELEVEN_KEY) throw new Error("ELEVENLABS_API_KEY is not set (or run with --only=llm).");
  if (wantLlm && !ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY is not set (or run with --only=tts).");

  console.log(`Levels: ${LEVELS.join(", ")} | TTS model: ${TTS_MODEL} | LLM model: ${LLM_MODEL}`);
  if (wantTts) await sweep("ElevenLabs", ttsRequest);
  if (wantLlm) await sweep("Anthropic", llmRequest);

  console.log(
    "\nHow to read this: one live phone call is NOT one concurrent request — it only occupies a slot for the 1-2 seconds a" +
      "\nreply takes to synthesize or generate, roughly once every 10-15 seconds. So the simultaneous-CALL capacity is roughly" +
      "\n5-8x the 'highest clean concurrency' above. Treat that as an estimate and re-run after any plan change."
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
