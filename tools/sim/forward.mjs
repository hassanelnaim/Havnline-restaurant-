// Call forwarding: every path that rings a person (pause, live transfer, emergency fallback)
// and every result Twilio can report for the forwarded leg.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { APP, sql, one, scenario, check, note, control, pool, results, runCall, twilioPost, sleep } from "./lib.mjs";
// The call webhook caches business details for 20s (lib/ai/context.ts).
const settle = () => sleep(21000);
import { createLiveRestaurant } from "./journey.mjs";

const browser = await chromium.launch();
const caller = () => "+1248" + String(Math.floor(1e6 + Math.random() * 8.9e6));
let seq = 0;
const key = () => `[f${Date.now().toString(36)}${(seq++).toString(36)}]`;
const emailCount = () => fetch("http://127.0.0.1:4010/emails?n=1000").then((r) => r.json()).then((e) => e.length);
const RESULTS = ["completed", "no-answer", "busy", "failed", "canceled"];
const MAIN = "+13135550199";
const ESC = "+12485550123";

let R;
const dialOf = (c) => c.transcript.find((t) => t.who === "system" && t.text.startsWith("DIAL"));
const said = (c) => c.transcript.filter((t) => t.who === "ai").map((t) => t.text).join(" | ");
const apology = (c) => /no one('s| is) available/i.test(said(c));

async function openAllDay(bizId) {
  await sql("delete from business_hours where business_id=$1", [bizId]);
  for (const d of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
    await sql("insert into business_hours(business_id, weekday, is_open, open_time, close_time) values ($1,$2,true,'00:00','23:59')", [bizId, d]);
}
async function setPhones(phone, esc) {
  const cur = await one("select phone, escalation_phone from businesses where id=$1", [R.biz.id]);
  if (cur.phone === phone && cur.escalation_phone === esc) return;
  await sql("update businesses set phone=$2, escalation_phone=$3 where id=$1", [R.biz.id, phone, esc]);
  await settle();
}
async function pauseNow() {
  await sql("update ai_pauses set cancelled_at=now() where cancelled_at is null");
  const p = await one("insert into ai_pauses(create_key, starts_at, ends_at, audience) values ($1, now()-interval '1 minute', now()+interval '1 hour', '1 restaurant') returning id", ["sim-" + Date.now() + seq++]);
  await sql("insert into ai_pause_targets(pause_id, business_id) values ($1,$2)", [p.id, R.biz.id]);
}
const unpause = () => sql("update ai_pauses set cancelled_at=now() where cancelled_at is null");

await scenario("forward: set up a live restaurant", async () => {
  R = await createLiveRestaurant(browser, { name: "Forward Diner", label: "fwd" });
  await openAllDay(R.biz.id);
  note("HavnLine number " + R.number);
});

// ---------- Pause ----------
await scenario("forward/pause: dial details", async () => {
  await setPhones("(313) 555-0199", null);
  await pauseNow();
  const c = await runCall({ to: R.number, from: caller(), token: R.token, dialStatus: "completed" });
  const d = dialOf(c);
  check(d?.text === "DIAL " + MAIN, "dialed " + d?.text);
  check(d?.attrs?.callerId === R.number, "caller ID " + d?.attrs?.callerId);
  check(d?.attrs?.timeout === "25", "timeout " + d?.attrs?.timeout);
  check(/voice-fallback$/.test(d?.attrs?.action || ""), "action " + d?.attrs?.action);
  check(c.problems.length === 0, c.problems.join("; "));
});

for (const status of RESULTS) {
  await scenario(`forward/pause: restaurant ${status}`, async () => {
    const c = await runCall({ to: R.number, from: caller(), token: R.token, dialStatus: status });
    check(dialOf(c), "no dial");
    check(c.ended === "ai_hung_up", "ended " + c.ended);
    if (status === "completed") check(!apology(c), "apologised after the restaurant answered: " + said(c));
    else check(apology(c), "no apology for " + status + ": " + said(c));
    check(c.problems.length === 0, c.problems.join("; "));
  });
}

await scenario("forward/pause: rings the escalation number when one is set", async () => {
  await setPhones("(313) 555-0199", ESC);
  const c = await runCall({ to: R.number, from: caller(), token: R.token });
  check(dialOf(c)?.text === "DIAL " + ESC, "dialed " + dialOf(c)?.text);
});

for (const [typed, want] of [["313.555.0199", MAIN], ["+1 313 555 0199", MAIN], ["1-313-555-0199", MAIN], ["3135550199", MAIN], ["555-0199", null], ["", null]]) {
  await scenario(`forward/pause: phone typed "${typed}"`, async () => {
    await setPhones(typed, null);
    const c = await runCall({ to: R.number, from: caller(), token: R.token });
    if (want) check(dialOf(c)?.text === "DIAL " + want, "dialed " + dialOf(c)?.text);
    else {
      check(!dialOf(c), "dialed an undialable number: " + dialOf(c)?.text);
      check(/try again a little later/.test(said(c)), "no try-later line: " + said(c));
    }
  });
}

await scenario("forward/pause: restaurant phone saved as the HavnLine number", async () => {
  await setPhones(R.number, null);
  const c1 = await runCall({ to: R.number, from: caller(), token: R.token });
  check(!dialOf(c1), "dialed HavnLine from HavnLine (main)");
  await setPhones("(313) 555-0199", R.number);
  const c2 = await runCall({ to: R.number, from: caller(), token: R.token });
  check(!dialOf(c2), "dialed HavnLine from HavnLine (escalation)");
});

await scenario("forward/pause: a forwarded leg that comes back to HavnLine is stopped", async () => {
  // Restaurant line forwards to HavnLine: the second leg arrives From = HavnLine number.
  await setPhones("(313) 555-0199", null);
  const c = await runCall({ to: R.number, from: R.number, token: R.token });
  check(!dialOf(c), "second leg dialed again (loop)");
});

await scenario("forward/pause: closed, blocked, or owner switched AI off", async () => {
  await sql("update business_hours set is_open=false where business_id=$1", [R.biz.id]);
  await settle();
  const closed = await runCall({ to: R.number, from: caller(), token: R.token });
  check(!dialOf(closed) && /closed/i.test(said(closed)), "closed + paused: " + said(closed));
  await openAllDay(R.biz.id);
  await settle();
  const blocked = caller();
  await sql("insert into customers(business_id, phone, name, is_blocked) values ($1,$2,'Spam',true)", [R.biz.id, blocked]);
  const b = await runCall({ to: R.number, from: blocked, token: R.token });
  check(b.ended?.startsWith("rejected"), "blocked caller not rejected: " + b.ended);
  await sql("update ai_receptionists set status='offline' where business_id=$1", [R.biz.id]);
  await settle();
  const off = await runCall({ to: R.number, from: caller(), token: R.token });
  check(!dialOf(off), "forwarded although the owner turned the AI off");
  note("owner-off + paused says: " + said(off));
  await sql("update ai_receptionists set status='online' where business_id=$1", [R.biz.id]);
  await settle();
  await unpause();
});

// ---------- Live transfer during an AI call ----------
for (const [tool, input] of [["transfer_call", {}], ["escalate_to_human", { reason: "complaint", summary: "Cold fries" }]]) {
  for (const status of RESULTS) {
    await scenario(`forward/transfer: ${tool}, restaurant ${status}`, async () => {
      await setPhones("(313) 555-0199", ESC);
      const k = key();
      await control("/ai/script", { key: k, turns: [[{ tools: [{ name: tool, input }] }, { text: "One sec." }], [{ text: "bye" }]] });
      const before = await emailCount();
      const c = await runCall({ to: R.number, from: caller(), token: R.token, say: [`I need a person ${k}`, "ok"], dialStatus: status });
      const d = dialOf(c);
      check(d?.text === "DIAL " + ESC, "dialed " + d?.text);
      check(d?.attrs?.callerId === R.number, "caller ID " + d?.attrs?.callerId);
      check(/dial-status/.test(d?.attrs?.action || ""), "action " + d?.attrs?.action);
      check(c.problems.length === 0, c.problems.join("; "));
      const row = await one("select outcome, escalation_reason from calls where twilio_call_sid=$1", [c.callSid]);
      if (status === "completed") {
        check(!apology(c), "apologised after answer");
        check(row?.outcome !== "escalated", "answered transfer left as escalated: " + row?.outcome);
      } else {
        check(apology(c), "no apology: " + said(c));
        check(row?.outcome === "escalated", "outcome " + row?.outcome);
        check((await emailCount()) > before, "no escalation email");
      }
      note(`outcome=${row?.outcome}`);
    });
  }
}

await scenario("forward/transfer: caller is the restaurant's own phone", async () => {
  await setPhones("(313) 555-0199", null);
  const k = key();
  await control("/ai/script", { key: k, turns: [[{ tools: [{ name: "transfer_call", input: {} }] }, { text: "One sec." }], [{ text: "bye" }]] });
  const c = await runCall({ to: R.number, from: MAIN, token: R.token, say: [`get me a person ${k}`, "ok"] });
  check(!dialOf(c), "transferred the restaurant to itself");
});

await scenario("forward/transfer: escalation number is the HavnLine number", async () => {
  await setPhones("(313) 555-0199", R.number);
  const k = key();
  await control("/ai/script", { key: k, turns: [[{ tools: [{ name: "transfer_call", input: {} }] }, { text: "One sec." }], [{ text: "bye" }]] });
  const c = await runCall({ to: R.number, from: caller(), token: R.token, say: [`get me a person ${k}`, "ok"] });
  const d = dialOf(c);
  note("dial: " + (d?.text || "none"));
  if (d) {
    // Twilio would bring that leg straight back in, From = HavnLine number.
    const back = await runCall({ to: R.number, from: R.number, token: R.token });
    check(!dialOf(back) && !/What would you like/.test(said(back)), "looped leg was answered: " + said(back));
    note("looped leg hears: " + said(back));
  }
});

// ---------- Emergency fallback (main webhook failed) ----------
for (const status of RESULTS) {
  await scenario(`forward/fallback: restaurant ${status}`, async () => {
    await setPhones("(313) 555-0199", null);
    const url = APP + "/api/webhooks/twilio/voice-fallback";
    const base = { AccountSid: "ACsim", CallSid: "CA" + Date.now() + seq++, From: caller(), To: R.number, CallStatus: "in-progress", ErrorCode: "11200" };
    const r1 = await twilioPost(url, base, R.token);
    const m = r1.text.match(/<Dial[^>]*>([^<]+)<\/Dial>/);
    check(m?.[1] === MAIN, "fallback dialed " + (m?.[1] || "nothing") + " :: " + r1.text.slice(0, 200));
    const r2 = await twilioPost(url, { ...base, DialCallStatus: status }, R.token);
    if (status === "completed") check(/<Hangup\/>/.test(r2.text) && !/Sorry/.test(r2.text), "after answer: " + r2.text);
    else check(/no one is available/.test(r2.text), status + ": " + r2.text);
  });
}

await scenario("forward/fallback: escalation number, bad numbers, self-dial", async () => {
  const url = APP + "/api/webhooks/twilio/voice-fallback";
  const post = async () => (await twilioPost(url, { AccountSid: "ACsim", CallSid: "CA" + Date.now() + seq++, From: caller(), To: R.number, CallStatus: "in-progress" }, R.token)).text;
  await setPhones("(313) 555-0199", ESC);
  check((await post()).includes(`>${ESC}</Dial>`), "fallback ignored the escalation number");
  await setPhones("555-0199", null);
  check(!/<Dial/.test(await post()), "fallback dialed a 7-digit number");
  await setPhones(R.number, null);
  check(!/<Dial/.test(await post()), "fallback dialed the HavnLine number");
  await setPhones("(313) 555-0199", null);
});

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
await browser.close();
await pool.end();
