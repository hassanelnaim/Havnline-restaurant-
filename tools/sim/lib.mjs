// Shared helpers for the simulations.
import crypto from "node:crypto";
import pg from "/home/claude/simlib/node_modules/pg/lib/index.js";

export const APP = "http://localhost:3000";
export const GATEWAY = "http://127.0.0.1:54321";
export const CONTROL = "http://127.0.0.1:4010";
export const pool = new pg.Pool({ connectionString: "postgres://postgres@127.0.0.1:54322/havnline", max: 8 });
export const sql = (text, args = []) => pool.query(text, args).then((r) => r.rows);
export const one = async (text, args) => (await sql(text, args))[0];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function control(path, body) {
  const r = await fetch(CONTROL + path, body === undefined ? {} : { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return r.json();
}
export const authEmails = () => fetch(GATEWAY + "/__auth/emails").then((r) => r.json());

// ---- results ----
export const results = [];
let current = null;
export async function scenario(name, fn) {
  const rec = { name, ok: true, notes: [], failures: [] };
  current = rec;
  const t0 = Date.now();
  try {
    await fn(rec);
  } catch (e) {
    rec.ok = false;
    rec.failures.push("THREW: " + (e?.stack || e).toString().split("\n").slice(0, 4).join(" | "));
  }
  rec.ms = Date.now() - t0;
  results.push(rec);
  console.log(`${rec.ok ? "PASS" : "FAIL"} ${name} (${rec.ms}ms)${rec.failures.length ? "\n   - " + rec.failures.join("\n   - ") : ""}${rec.notes.length ? "\n   · " + rec.notes.join("\n   · ") : ""}`);
  current = null;
  return rec;
}
export function check(cond, msg) {
  if (!cond) {
    current.ok = false;
    current.failures.push(msg);
  }
  return !!cond;
}
export const note = (msg) => current?.notes.push(msg);

// ---- Twilio ----
export function twilioSignature(token, url, params) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return crypto.createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}
export async function twilioPost(url, params, token, { badSig = false } = {}) {
  const sig = badSig ? "bad" : twilioSignature(token, url, params);
  const t0 = Date.now();
  const r = await fetch(url, { method: "POST", body: new URLSearchParams(params), headers: { "x-twilio-signature": sig, "content-type": "application/x-www-form-urlencoded" }, redirect: "manual" });
  const text = await r.text();
  return { status: r.status, text, ms: Date.now() - t0 };
}

// ---- Stripe ----
export function stripeSigHeader(payload, secret, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}
export async function stripeWebhook(path, event, secret, { badSig = false } = {}) {
  const payload = JSON.stringify(event);
  const r = await fetch(APP + path, { method: "POST", body: payload, headers: { "stripe-signature": badSig ? "t=1,v1=bad" : stripeSigHeader(payload, secret), "content-type": "application/json" } });
  return { status: r.status, text: await r.text() };
}
export function stripeEvent(type, object, { account = null, id } = {}) {
  return { id: id || "evt_" + crypto.randomBytes(12).toString("hex"), object: "event", type, account, api_version: "2024-06-20", created: Math.floor(Date.now() / 1000), data: { object }, livemode: false, pending_webhooks: 1 };
}
export const CONNECT_WHSEC = "whsec_sim_connect";
export const PLATFORM_WHSEC = "whsec_sim_platform";

// ---- TwiML ----
export function parseTwiml(xml) {
  // Tiny parser good enough for the app's TwiML: returns a flat list of verbs, Gather children nested.
  const verbs = [];
  const re = /<(\/?)(Gather|Say|Play|Redirect|Hangup|Reject|Dial|Pause|Number|Response)([^>]*?)(\/?)>/g;
  let m, stack = [{ children: verbs }], lastIndex = 0;
  const attrs = (s) => Object.fromEntries([...s.matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], unesc(a[2])]));
  while ((m = re.exec(xml))) {
    const [, close, tag, attr, selfClose] = m;
    if (tag === "Response") continue;
    const top = stack[stack.length - 1];
    if (close) {
      const node = stack.pop();
      node.text = unesc(xml.slice(node._start, m.index).replace(/<[^>]+>/g, "").trim());
      continue;
    }
    const node = { tag, attrs: attrs(attr), children: [], _start: re.lastIndex };
    top.children.push(node);
    if (!selfClose) stack.push(node);
  }
  return verbs;
}
const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/**
 * Plays the part of Twilio for one call: posts the voice webhook, then follows
 * the TwiML (Gather -> caller's next line, Redirect, Dial), fetching every
 * <Play> URL like Twilio would. `say` is the list of caller utterances; null
 * means silence. Returns a transcript and any problems seen.
 */
export async function runCall({ to, from, token, say = [], callSid, playAudio = true, statusCallbacks = true, onTurn, think = 0 }) {
  callSid = callSid || "CA" + crypto.randomBytes(16).toString("hex");
  const base = { AccountSid: "ACsim", CallSid: callSid, From: from, To: to, CallStatus: "ringing", Direction: "inbound", ApiVersion: "2010-04-01" };
  const transcript = [];
  const problems = [];
  const timings = [];
  let url = APP + "/api/webhooks/twilio/voice";
  let params = { ...base };
  let utter = 0;
  let repeats = 0;
  let steps = 0;
  let ended = null;
  while (steps++ < 200) {
    const r = await twilioPost(url, params, token);
    timings.push({ path: new URL(url).pathname, ms: r.ms, status: r.status });
    if (r.status !== 200) {
      problems.push(`${new URL(url).pathname} -> HTTP ${r.status}: ${r.text.slice(0, 200)}`);
      ended = "http_error";
      break;
    }
    if (r.ms > 15000) problems.push(`${new URL(url).pathname} took ${r.ms}ms (Twilio gives up at 15s)`);
    const verbs = parseTwiml(r.text);
    let next = null;
    for (const v of verbs) {
      if (v.tag === "Say") transcript.push({ who: "ai", text: v.text, how: "say" });
      if (v.tag === "Play") {
        transcript.push({ who: "ai", text: decodeSpoken(v.text), how: "play" });
        if (playAudio) await checkPlay(v.text, problems, timings);
      }
      if (v.tag === "Gather") {
        for (const c of v.children) {
          if (c.tag === "Say") transcript.push({ who: "ai", text: c.text, how: "say" });
          if (c.tag === "Play") {
            transcript.push({ who: "ai", text: decodeSpoken(c.text), how: "play" });
            if (playAudio) await checkPlay(c.text, problems, timings);
          }
        }
        const isContinue = v.attrs.action.includes("gather-continue");
        // A filler's short gather: the caller normally says nothing more.
        if (isContinue) continue;
        // A real caller repeats themselves when asked to.
        const lastAi = [...transcript].reverse().find((t) => t.who === "ai")?.text || "";
        const asked = /say (that|it) (one more time|again)|missed that|could you repeat|didn.t catch/i.test(lastAi) && utter > 0 && say[utter - 1] !== null && repeats < 3;
        if (asked) repeats++;
        else repeats = 0;
        const line = asked ? say[utter - 1] : utter < say.length ? say[utter] : undefined;
        if (!asked) utter++;
        if (line === undefined) { ended = "caller_hung_up"; break; }
        if (onTurn) await onTurn({ utter, line, transcript });
        if (think) await sleep(think * (0.7 + Math.random() * 0.6));
        transcript.push({ who: "caller", text: line });
        next = { url: v.attrs.action, params: { ...base, CallStatus: "in-progress", ...(line === null ? {} : { SpeechResult: line, Confidence: "0.92" }) } };
        break;
      }
      if (v.tag === "Redirect") { next = { url: v.text, params: { ...base, CallStatus: "in-progress" } }; break; }
      if (v.tag === "Dial") {
        transcript.push({ who: "system", text: `DIAL ${v.children.map((c) => c.text).join(",") || v.text}` });
        if (v.attrs.action) next = { url: v.attrs.action, params: { ...base, CallStatus: "in-progress", DialCallStatus: "no-answer" } };
        else ended = "dialed";
        break;
      }
      if (v.tag === "Hangup") { ended = "ai_hung_up"; break; }
      if (v.tag === "Reject") { ended = "rejected:" + (v.attrs.reason || ""); break; }
    }
    if (ended || !next) { ended = ended || "no_next"; break; }
    url = next.url.startsWith("http") ? next.url : APP + next.url;
    params = next.params;
  }
  if (statusCallbacks) {
    const st = await twilioPost(APP + "/api/webhooks/twilio/status", { ...base, CallStatus: "completed", CallDuration: "95" }, token);
    if (st.status !== 200 && st.status !== 204) problems.push(`status callback -> HTTP ${st.status}: ${st.text.slice(0, 120)}`);
  }
  return { callSid, transcript, problems, ended, timings };
}
const TTS_KEY = crypto.createHash("sha256").update("havnline-tts-text-key:sim-signing-secret-0123456789abcdef").digest();
function decodeSpoken(playUrl) {
  try {
    const u = new URL(playUrl);
    const t = u.searchParams.get("t");
    if (t) {
      const raw = Buffer.from(t, "base64url");
      const d = crypto.createDecipheriv("aes-256-gcm", TTS_KEY, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
    }
    return u.searchParams.get("text") || `[audio ${u.pathname}]`;
  } catch {
    return playUrl;
  }
}
async function checkPlay(playUrl, problems, timings) {
  try {
    const t0 = Date.now();
    const r = await fetch(playUrl);
    const b = Buffer.from(await r.arrayBuffer());
    if (timings) timings.push({ path: "/api/tts", ms: Date.now() - t0, status: r.status });
    if (r.status !== 200 || b.length < 100) problems.push(`<Play> ${playUrl.slice(0, 90)} -> HTTP ${r.status}, ${b.length} bytes`);
  } catch (e) {
    problems.push(`<Play> fetch failed: ${e.message}`);
  }
}
export const aiLines = (t) => t.transcript.filter((x) => x.who === "ai").map((x) => x.text);
