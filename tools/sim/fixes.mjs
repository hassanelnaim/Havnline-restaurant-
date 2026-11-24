// Launch-test fixes: voice list, voice fallback, ready times, allergy rule, one switch, loop guard.
// Run with the app started as TTS_MODE=twilio (production's mode).
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { APP, sql, one, scenario, check, note, control, pool, results, runCall, twilioPost, sleep } from "./lib.mjs";
import { createLiveRestaurant } from "./journey.mjs";

const browser = await chromium.launch();
const settle = () => sleep(21000); // business details are cached 20s per server
const caller = () => "+1248" + String(Math.floor(1e6 + Math.random() * 8.9e6));
let seq = 0;
const key = () => `[x${Date.now().toString(36)}${(seq++).toString(36)}]`;
const MAIN_TOKEN = "simmaintoken000000000000000000000";
let R;

async function greetingVoice(from = caller()) {
  const r = await twilioPost(APP + "/api/webhooks/twilio/voice", { AccountSid: "ACsim", CallSid: "CA" + Date.now() + seq++, From: from, To: R.number, CallStatus: "ringing", Direction: "inbound" }, R.token);
  return { status: r.status, voice: (r.text.match(/<Say voice="([^"]+)"/) || [])[1] || null, text: r.text };
}

await scenario("fixes: set up", async () => {
  R = await createLiveRestaurant(browser, { name: "Fixes Cafe", label: "fix" });
  await sql("delete from business_hours where business_id=$1", [R.biz.id]);
  for (const d of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
    await sql("insert into business_hours(business_id, weekday, is_open, open_time, close_time) values ($1,$2,true,'00:00','23:59')", [R.biz.id, d]);
});

await scenario("voices: the list is the fixed catalog", async () => {
  const r = await R.page.evaluate(() => fetch("/api/elevenlabs/voices").then((x) => x.json()));
  const names = r.voices.map((v) => v.name);
  check(names.length === 16, "voice count " + names.length);
  check(new Set(names).size === names.length, "duplicate names: " + names.join(","));
  check(!names.includes("Sim Sarah") && !names.includes("Charlotte"), "list includes voices outside the catalog");
  check(r.voices.find((v) => v.name === "Sarah")?.previewUrl === "https://example.invalid/sarah.mp3", "Sarah's sample missing");
  check(r.voices.every((v) => /^(Female|Male) · /.test(v.description)), "descriptions");
});

await scenario("voices: pick one on the AI page and calls use it", async () => {
  const p = R.page;
  await p.goto(APP + "/dashboard/ai-employee");
  await p.waitForLoadState("networkidle");
  await p.getByRole("button", { name: "Change voice" }).click();
  await p.getByText("Laura", { exact: true }).waitFor();
  const rows = await p.locator("div.grid > div:has(button:has-text('Choose')), div.grid > div:has(button:has-text('Chosen'))").count();
  check(rows === 16 && rows % 2 === 0, "rows in picker: " + rows);
  await p.locator("div.grid > div").filter({ hasText: "Laura" }).getByRole("button", { name: /Choose/ }).click();
  await p.getByRole("button", { name: "Save changes" }).click();
  await p.getByText("Saved. Your AI uses this on the next call.").waitFor({ timeout: 10000 });
  const v = await one("select voice_id, provider_voice_ref from ai_voice_configs where business_id=$1", [R.biz.id]);
  check(v.voice_id === "custom" && v.provider_voice_ref === "FGY2WhTYpPnrIDTdsKH5", "saved " + JSON.stringify(v));
  await settle();
  const g = await greetingVoice();
  check(g.voice === "ElevenLabs.FGY2WhTYpPnrIDTdsKH5", "greeting voice " + g.voice);
});

await scenario("voices: a removed voice falls back to the default", async () => {
  await sql("update ai_voice_configs set voice_id='custom', provider_voice_ref='sim-voice-1', provider_voice_name='Andrew' where business_id=$1", [R.biz.id]);
  await settle();
  const g = await greetingVoice();
  check(g.voice === "ElevenLabs.TX3LPaxmHKxFdv7VOQHJ", "removed voice spoke as " + g.voice);
  await R.page.goto(APP + "/dashboard/ai-employee");
  const t = await R.page.innerText("body");
  check(!/Andrew/.test(t), "AI page still shows the removed voice");
  const r = await R.page.evaluate(async () => {
    const res = await fetch("/api/elevenlabs/voices");
    return res.status;
  });
  check(r === 200, "voices route " + r);
});

await scenario("voices: built-in voices use current standard voices", async () => {
  await sql("update ai_voice_configs set voice_id='alex_professional', provider_voice_ref=null where business_id=$1", [R.biz.id]);
  await settle();
  check((await greetingVoice()).voice === "ElevenLabs.TX3LPaxmHKxFdv7VOQHJ", "alex");
  await sql("update ai_voice_configs set voice_id='sarah_warm' where business_id=$1", [R.biz.id]);
  await settle();
  check((await greetingVoice()).voice === "ElevenLabs.XrExE9yKIg1WjnnlVkGX", "sarah_warm");
});

await scenario("voice safety: Twilio's error webhook switches calls to a basic voice", async () => {
  const url = APP + "/api/webhooks/twilio/debugger";
  const bad = await twilioPost(url, { AccountSid: "ACsim", Level: "ERROR", Payload: JSON.stringify({ error_code: "13511" }) }, "wrong-token");
  check(bad.status === 403, "unsigned post accepted: " + bad.status);
  const other = await twilioPost(url, { AccountSid: "ACsim", Level: "ERROR", Payload: JSON.stringify({ error_code: "11200", more_info: { msg: "HTTP retrieval failure" } }) }, MAIN_TOKEN);
  check(other.status === 204, "other error " + other.status);
  check(!(await one("select 1 as x from service_circuit_breakers where service='twilio_hosted_tts' and tripped_until > now()")), "tripped on an unrelated error");
  const tts = await twilioPost(url, { AccountSid: "ACsim", Level: "WARNING", Payload: JSON.stringify({ error_code: "13511", more_info: { msg: "Say: Invalid voice value" } }) }, MAIN_TOKEN);
  check(tts.status === 204, "tts error " + tts.status);
  check(await one("select 1 as x from service_circuit_breakers where service='twilio_hosted_tts' and tripped_until > now()"), "switch not tripped");
  await sleep(2500);
  const g = await greetingVoice();
  check(/^Polly\./.test(g.voice || ""), "while tripped the greeting used " + g.voice);
  await sql("update service_circuit_breakers set tripped_until=now()-interval '1 second' where service='twilio_hosted_tts'");
  await sleep(2500);
  check(/^ElevenLabs\./.test((await greetingVoice()).voice || ""), "didn't go back to the normal voice");
});

await scenario("ready times: defaults, edit in Settings, AI is told", async () => {
  const p = R.page;
  await p.goto(APP + "/dashboard/settings");
  await p.waitForLoadState("networkidle");
  check((await p.inputValue("#ready-small-min")) === "10" && (await p.inputValue("#ready-small-max")) === "15", "defaults not shown");
  await p.fill("#ready-small-min", "20");
  await p.fill("#ready-small-max", "12");
  await p.getByRole("button", { name: "Save ready times" }).click();
  await p.getByText(/first number no bigger/).waitFor({ timeout: 8000 }).catch(() => {});
  check(await p.getByText(/first number no bigger/).count(), "bad range not refused");
  await p.fill("#ready-small-min", "12");
  await p.fill("#ready-small-max", "18");
  await p.getByRole("button", { name: "Save ready times" }).click();
  await p.getByText("Saved", { exact: true }).waitFor({ timeout: 8000 });
  const b = await one("select ready_minutes from businesses where id=$1", [R.biz.id]);
  check(JSON.stringify(b.ready_minutes?.small) === "[12,18]", "saved " + JSON.stringify(b.ready_minutes));
  await settle();
  const k = key();
  await control("/ai/script", { key: k, turns: [[{ text: "Sure." }]] });
  await runCall({ to: R.number, from: caller(), token: R.token, say: [`hello ${k}`] });
  const sys = (await control("/ai/last-system")).system;
  check(sys.includes("1 to 3 items in total: 12 to 18 minutes"), "ready range missing from the AI's instructions");
  check(sys.includes("8 or more items: 25 to 35 minutes"), "large default missing");
  check(sys.includes("Heads up, the menu says"), "allergy rule missing");
  check(sys.includes("Count quantities"), "count rule missing");
});

await scenario("one switch: only the top bar has the AI switch", async () => {
  const p = R.page;
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.goto(APP + "/dashboard");
  await p.waitForLoadState("networkidle");
  const n = await p.getByRole("switch", { name: /AI order-taker is (on|off)/ }).count();
  check(n === 1, "AI switches on the page: " + n);
});

await scenario("loop guard: escalation phone turned away for 30s after a transfer, not 3 min", async () => {
  const cell = caller();
  await sql("update businesses set escalation_phone=$2 where id=$1", [R.biz.id, cell]);
  await settle();
  const k = key();
  await control("/ai/script", { key: k, turns: [[{ tools: [{ name: "transfer_call", input: {} }] }, { text: "One sec." }], [{ text: "bye" }]] });
  const t = await runCall({ to: R.number, from: caller(), token: R.token, say: [`a person please ${k}`, "ok"] });
  check(t.transcript.some((x) => x.who === "system" && x.text === "DIAL " + cell), "transfer didn't ring the escalation phone");
  const soon = await runCall({ to: R.number, from: cell, token: R.token, say: [] });
  check(soon.ended === "rejected:busy", "right after a transfer, a call from the escalation phone should be refused: " + soon.ended);
  await sleep(31000);
  const later = await runCall({ to: R.number, from: cell, token: R.token, say: [] });
  check(later.ended === "caller_hung_up", "31s later the manager's call should be answered: " + later.ended);
});

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
await browser.close();
await pool.end();
