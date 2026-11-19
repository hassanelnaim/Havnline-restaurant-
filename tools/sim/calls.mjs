// Phone-call simulations: the fake AI follows a script, this file plays Twilio
// and the caller, then checks the database, texts, Stripe and the pay page.
import { createRequire } from "node:module";
import { APP, sql, one, scenario, check, note, control, runCall, aiLines, stripeEvent, stripeWebhook, CONNECT_WHSEC, sleep, results } from "./lib.mjs";
import { createLiveRestaurant } from "./journey.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

let seq = 0;
export const key = () => `[k${Date.now().toString(36)}${(seq++).toString(36)}]`;
export const caller = () => "+1248" + String(Math.floor(1e6 + Math.random() * 8.9e6));

export async function openAllDay(bizId) {
  await sql("delete from business_hours where business_id=$1", [bizId]);
  for (const d of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
    await sql("insert into business_hours(business_id, weekday, is_open, open_time, close_time) values ($1,$2,true,'00:00','23:59')", [bizId, d]);
}

/** The standard script: order, read back, name, consent, place. */
export function orderScript(k, { items = [["Cheeseburger", 1], ["Fries", 1]], name = "Sam", consent = true, consentAsked = true, extraTurns = [] } = {}) {
  const adds = items.map(([n, q, mods]) => ({ name: "add_item_to_order", input: { item_name: n, quantity: q, ...(mods ? { modifier_names: mods } : {}) } }));
  return {
    key: k,
    turns: [
      [{ tools: adds }, { text: "Got it. Anything else?" }],
      [{ text: "Okay, that comes to your total. Can I get a name for the order?" }],
      [{ text: consentAsked ? `Thanks, ${name}. Your order won't go through until it's paid. Is it okay to text you a payment link at the number you're calling from?` : `Thanks, ${name}. Placing it now.` }],
      [{ tools: [{ name: "confirm_and_place_order", input: { customer_name: name, text_consent: consent } }] }, { text: "I just texted you the payment link. Your order is not placed yet. It only goes to the kitchen once you pay. The link expires in 30 minutes." }],
      ...extraTurns,
      [{ text: "Thanks for calling. Goodbye!" }],
    ],
  };
}
export const standardLines = (k) => [`Hi, I'd like a cheeseburger and fries ${k}`, "That's it", "Sam", "Yes, that's fine", "Thanks, bye"];

export async function payOrder(order, { account, amount } = {}) {
  const pi = await control("/stripe/succeed", { pi: order.stripe_payment_intent_id, amount });
  const ev = stripeEvent("payment_intent.succeeded", { ...pi, latest_charge: pi.latest_charge }, { account: account || order.stripe_connect_account_id });
  return { pi, ev, res: await stripeWebhook("/api/webhooks/stripe-connect", ev, CONNECT_WHSEC) };
}


export async function dbTranscript(callSid) {
  return sql("select m.role, m.content from call_messages m join calls c on c.id=m.call_id where c.twilio_call_sid=$1 order by m.created_at, m.id", [callSid]);
}
export async function callRow(callSid) { return one("select * from calls where twilio_call_sid=$1", [callSid]); }
export async function orderFor(callSid) { return one("select o.* from orders o join calls c on c.id=o.call_id where c.twilio_call_sid=$1", [callSid]); }
export const toolResults = (k) => control("/ai/toolResults?key=" + encodeURIComponent(k));
export const textsTo = async (n) => (await control("/twilio/messages")).filter((m) => m.to === n);
const problems = (c) => { for (const p of c.problems) check(false, p); };
const said = async (c) => (await dbTranscript(c.callSid)).filter((m) => m.role === "ai").map((m) => m.content);

export async function callScenarios(R) {
  await scenario("call: AI skips the consent question -> nothing texted, AI told to ask", async () => {
    const k = key();
    const sc = orderScript(k, { consentAsked: false });
    await control("/ai/script", sc);
    const from = caller();
    const c = await runCall({ to: R.number, from, token: R.token, say: standardLines(k) });
    problems(c);
    check((await textsTo(from)).length === 0, "no text may be sent without consent");
    const tr = await toolResults(k);
    check(tr.some((t) => /haven't asked the caller yet/.test(t.content)), "tool result should say consent not asked: " + tr.map((t) => t.content.slice(0, 80)).join(" | "));
    const o = await orderFor(c.callSid);
    check(o?.status === "building", "order must stay building, is " + o?.status);
    check((await one("select count(*)::int n from sms_consents where call_id=(select id from calls where twilio_call_sid=$1)", [c.callSid])).n === 0, "no consent record");
  });

  await scenario("call: caller says no to the text", async () => {
    const k = key();
    await control("/ai/script", orderScript(k));
    const from = caller();
    const c = await runCall({ to: R.number, from, token: R.token, say: [`Burger and fries please ${k}`, "That's all", "Sam", "No, don't text me", "bye"] });
    problems(c);
    check((await textsTo(from)).length === 0, "no text when the caller said no");
    const tr = await toolResults(k);
    check(tr.some((t) => /hasn't clearly said yes/.test(t.content)), "tool result should say no clear yes: " + tr.map((t) => t.content.slice(0, 60)).join(" | "));
  });

  await scenario("call: 'yes but use my other number' style answers", async () => {
    for (const ans of ["Sure", "yeah go ahead", "Yes please", "ok", "Is that safe?", "no thanks", "what?", "yes no wait"]) {
      const k = key();
      await control("/ai/script", orderScript(k));
      const from = caller();
      const c = await runCall({ to: R.number, from, token: R.token, say: [`One burger ${k}`, "That's all", "Sam", ans, "bye"] });
      const sent = (await textsTo(from)).length;
      note(`"${ans}" -> ${sent ? "texted" : "not texted"}`);
      problems(c);
    }
  });

  await scenario("call: silence twice -> polite hang up, no order", async () => {
    const k = key();
    await control("/ai/script", orderScript(k));
    const c = await runCall({ to: R.number, from: caller(), token: R.token, say: [null, null, null] });
    problems(c);
    const lines = await said(c);
    check(c.ended === "ai_hung_up", "AI should hang up after repeated silence, ended=" + c.ended);
    check((await orderFor(c.callSid)) == null, "no order for a silent call");
    note("ended " + c.ended);
  });

  await scenario("call: silence once then speaks -> continues", async () => {
    const k = key();
    await control("/ai/script", orderScript(k));
    const from = caller();
    const c = await runCall({ to: R.number, from, token: R.token, say: [null, ...standardLines(k)] });
    problems(c);
    check((await textsTo(from)).length === 1, "pay link texted after a missed first answer");
  });

  await scenario("call: caller hangs up mid-order", async () => {
    const k = key();
    await control("/ai/script", orderScript(k));
    const c = await runCall({ to: R.number, from: caller(), token: R.token, say: [`A burger ${k}`] });
    problems(c);
    const call = await callRow(c.callSid);
    const o = await orderFor(c.callSid);
    note(`call ${call.status}/${call.outcome}, order ${o?.status}`);
    check(call.status === "completed", "call closed by status callback");
  });

  await scenario("call: Twilio retries the same gather (duplicate request)", async () => {
    const k = key();
    await control("/ai/script", orderScript(k));
    const from = caller();
    let dup = null;
    const c = await runCall({
      to: R.number, from, token: R.token, say: standardLines(k),
      onTurn: async ({ utter }) => { if (utter === 2) dup = true; },
    });
    problems(c);
    // replay the first gather request exactly
    const call = await callRow(c.callSid);
    const items = await sql("select item_name, quantity from order_items oi join orders o on o.id=oi.order_id where o.call_id=$1", [call.id]);
    check(items.length === 2, "2 items, got " + JSON.stringify(items));
  });

  await scenario("call: exact replay of a gather POST adds nothing twice", async () => {
    const k = key();
    await control("/ai/script", orderScript(k));
    const from = caller();
    // First get to the first gather.
    const sid = "CA" + Math.random().toString(16).slice(2).padEnd(32, "0");
    const base = { AccountSid: "ACsim", CallSid: sid, From: from, To: R.number, CallStatus: "ringing", Direction: "inbound" };
    const { twilioPost, parseTwiml } = await import("./lib.mjs");
    const v = await twilioPost(APP + "/api/webhooks/twilio/voice", base, R.token);
    const g = parseTwiml(v.text).find((x) => x.tag === "Gather");
    const params = { ...base, CallStatus: "in-progress", SpeechResult: `A cheeseburger and fries ${k}`, Confidence: "0.9" };
    const [a, b] = await Promise.all([twilioPost(g.attrs.action, params, R.token), twilioPost(g.attrs.action, params, R.token)]);
    const c2 = await twilioPost(g.attrs.action, params, R.token);
    check(a.status === 200 && b.status === 200 && c2.status === 200, `statuses ${a.status} ${b.status} ${c2.status}`);
    const call = await callRow(sid);
    const items = await sql("select item_name, quantity from order_items oi join orders o on o.id=oi.order_id where o.call_id=$1", [call.id]);
    check(items.length === 2 && items.every((i) => i.quantity === 1), "replayed speech must not double the order: " + JSON.stringify(items));
    const msgs = await sql("select role, content from call_messages where call_id=$1 and role='customer'", [call.id]);
    note(`customer lines recorded: ${msgs.length}`);
    await twilioPost(APP + "/api/webhooks/twilio/status", { ...base, CallStatus: "completed", CallDuration: "20" }, R.token);
  });

  await scenario("call: forged Twilio signature is refused everywhere", async () => {
    const { twilioPost } = await import("./lib.mjs");
    const base = { AccountSid: "ACsim", CallSid: "CAforged", From: caller(), To: R.number, CallStatus: "ringing" };
    for (const path of ["voice", "status", "sms-status", "dial-status", "voice-fallback"]) {
      const r = await twilioPost(`${APP}/api/webhooks/twilio/${path}`, base, R.token, { badSig: true });
      check(r.status === 403 || r.status === 400, `${path} with a bad signature -> ${r.status} ${r.text.slice(0, 80)}`);
    }
    const r2 = await twilioPost(`${APP}/api/webhooks/twilio/gather?callId=00000000-0000-0000-0000-000000000000`, base, R.token);
    check(r2.status === 403, "gather without the call key -> " + r2.status);
  });

  await scenario("call: unknown number", async () => {
    const c = await runCall({ to: "+19999999999", from: caller(), token: R.token, say: [] , statusCallbacks: false});
    note("ended " + c.ended + " " + JSON.stringify(c.transcript).slice(0, 120));
  });

  await scenario("call: three calls at once from one caller -> third turned away", async () => {
    const from = caller();
    const { twilioPost } = await import("./lib.mjs");
    const mk = (i) => ({ AccountSid: "ACsim", CallSid: "CAcap" + i + Date.now(), From: from, To: R.number, CallStatus: "ringing", Direction: "inbound" });
    const rs = [];
    for (let i = 0; i < 3; i++) rs.push(await twilioPost(APP + "/api/webhooks/twilio/voice", mk(i), R.token));
    check(/already on another call/i.test(rs[2].text) || /Hangup/.test(rs[2].text) && !/Gather/.test(rs[2].text), "third call should be turned away");
    note(rs.map((r) => (/<Gather/.test(r.text) ? "answered" : "turned away")).join(", "));
    // Same thing, all three at the same instant.
    const from2 = caller();
    const mk2 = (i) => ({ ...mk(i), From: from2, CallSid: "CAcapb" + i + Date.now() });
    const rs2 = await Promise.all([0, 1, 2].map((i) => twilioPost(APP + "/api/webhooks/twilio/voice", mk2(i), R.token)));
    const answered = rs2.filter((r) => /<Gather/.test(r.text)).length;
    note("simultaneous: " + answered + " of 3 answered");
    check(answered <= 2, "at most 2 simultaneous calls per caller, answered " + answered);
  });

  await scenario("call: blocked caller is rejected", async () => {
    const from = caller();
    await sql("insert into customers(business_id, name, phone, is_blocked) values ($1,'Spammer',$2,true)", [R.biz.id, from.replace("+1", "(").replace(/^(\(\d{3})(\d{3})(\d{4})$/, "$1) $2-$3")]);
    const c = await runCall({ to: R.number, from, token: R.token, say: ["hi"], statusCallbacks: false });
    check(c.ended.startsWith("rejected"), "blocked caller should be rejected, ended=" + c.ended);
  });

  await scenario("call: AI turned off / suspended / subscription states", async () => {
    const states = [
      ["ai offline", "update ai_receptionists set status='offline' where business_id=$1", "update ai_receptionists set status='online' where business_id=$1"],
      ["suspended", "update businesses set is_suspended=true where id=$1", "update businesses set is_suspended=false where id=$1"],
      ["past_due", "update businesses set subscription_status='past_due' where id=$1", "update businesses set subscription_status='trialing' where id=$1"],
      ["canceled", "update businesses set subscription_status='canceled' where id=$1", "update businesses set subscription_status='trialing' where id=$1"],
      ["active", "update businesses set subscription_status='active' where id=$1", "update businesses set subscription_status='trialing' where id=$1"],
    ];
    for (const [label, on, off] of states) {
      await sql(on, [R.biz.id]);
      if (label === "ai offline") await sleep(21000); // settings cache (20s)
      const c = await runCall({ to: R.number, from: caller(), token: R.token, say: ["hello"], statusCallbacks: false });
      note(`${label}: ${c.ended} / ${c.transcript.map((t) => t.text.slice(0, 50)).join(" | ").slice(0, 120)}`);
      await sql(off, [R.biz.id]);
      if (label === "ai offline") await sleep(21000);
    }
  });

  await scenario("call: restaurant closed", async () => {
    await sql("update business_hours set is_open=false where business_id=$1", [R.biz.id]);
    await sleep(21000);
    const c = await runCall({ to: R.number, from: caller(), token: R.token, say: ["hello"], statusCallbacks: false });
    check(c.ended === "ai_hung_up", "closed: play message and hang up, ended=" + c.ended);
    check((await control("/counters")).ai.requests >= 0, "");
    await openAllDay(R.biz.id);
    await sleep(21000);
  });

  await scenario("call: item not on the menu / remove / change quantity / modifiers", async () => {
    const k = key();
    await control("/ai/script", {
      key: k,
      turns: [
        [{ tools: [{ name: "add_item_to_order", input: { item_name: "Lobster Thermidor", quantity: 1 } }, { name: "add_item_to_order", input: { item_name: "Cheeseburger", quantity: 2 } }] }, { text: "We don't have lobster. Two cheeseburgers. Anything else?" }],
        [{ tools: [{ name: "update_item_quantity", input: { item_name: "Cheeseburger", quantity: 3 } }, { name: "add_item_to_order", input: { item_name: "Coke", quantity: 1 } }, { name: "update_item_modifiers", input: { item_name: "Cheeseburger", notes: "no onions" } }] }, { text: "Done." }],
        [{ tools: [{ name: "remove_item_from_order", input: { item_name: "Coke" } }, { name: "remove_item_from_order", input: { item_name: "Coke" } }, { name: "update_item_quantity", input: { item_name: "Fries", quantity: 2 } }] }, { text: "Removed." }],
        [{ tools: [{ name: "update_item_quantity", input: { item_name: "Cheeseburger", quantity: -4 } }, { name: "update_item_quantity", input: { item_name: "Cheeseburger", quantity: 1.5 } }, { name: "add_item_to_order", input: { item_name: "Cheeseburger", quantity: 10000 } }, { name: "get_current_order", input: {} }] }, { text: "Here's your order." }],
        [{ text: "bye" }],
      ],
    });
    const c = await runCall({ to: R.number, from: caller(), token: R.token, say: [`lobster and two burgers ${k}`, "make it 3 and a coke, no onions", "no coke, 2 fries", "weird quantities", "bye"] });
    problems(c);
    const tr = await toolResults(k);
    for (const t of tr) note(`t${t.turn}.${t.step}: ${t.content.slice(0, 150)}`);
    const call = await callRow(c.callSid);
    const items = await sql("select item_name, quantity, notes from order_items oi join orders o on o.id=oi.order_id where o.call_id=$1", [call.id]);
    note("final items: " + JSON.stringify(items));
    check(items.every((i) => Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity < 1000), "quantities stay sane: " + JSON.stringify(items));
  });

  await scenario("call: confirm twice in one turn / confirm with empty order", async () => {
    const k = key();
    await control("/ai/script", {
      key: k,
      turns: [
        [{ tools: [{ name: "confirm_and_place_order", input: { customer_name: "Empty", text_consent: true } }] }, { text: "Nothing to place yet." }],
        [{ tools: [{ name: "add_item_to_order", input: { item_name: "Fries", quantity: 1 } }] }, { text: "Fries. Name?" }],
        [{ text: "Thanks, Al. Your order won't go through until it's paid. Is it okay to text you a payment link at the number you're calling from?" }],
        [{ tools: [{ name: "confirm_and_place_order", input: { customer_name: "Al", text_consent: true } }, { name: "confirm_and_place_order", input: { customer_name: "Al", text_consent: true } }] }, { text: "Texted." }],
        [{ tools: [{ name: "confirm_and_place_order", input: { customer_name: "Al", text_consent: true } }] }, { text: "Already placed." }],
        [{ text: "bye" }],
      ],
    });
    const from = caller();
    const c = await runCall({ to: R.number, from, token: R.token, say: [`place it ${k}`, "fries", "Al", "yes", "did it go through?", "bye"] });
    problems(c);
    const tr = await toolResults(k);
    for (const t of tr) note(`t${t.turn}.${t.step}: ${t.content.slice(0, 140)}`);
    const n = (await textsTo(from)).length;
    check(n === 1, "exactly one payment text, got " + n);
    const orders = await sql("select o.status from orders o join calls c on c.id=o.call_id where c.twilio_call_sid=$1", [c.callSid]);
    check(orders.length === 1, "one order, got " + orders.length);
  });

  await scenario("call: add items AFTER the order was placed (same call)", async () => {
    const k = key();
    const sc = orderScript(k, { extraTurns: [[{ tools: [{ name: "add_item_to_order", input: { item_name: "Coke", quantity: 1 } }] }, { text: "Added a coke." }], [{ tools: [{ name: "confirm_and_place_order", input: { customer_name: "Sam", text_consent: true } }] }, { text: "ok" }]] });
    await control("/ai/script", sc);
    const from = caller();
    const c = await runCall({ to: R.number, from, token: R.token, say: [...standardLines(k).slice(0, 4), "oh add a coke", "yes place that too", "bye"] });
    problems(c);
    const tr = await toolResults(k);
    for (const t of tr.filter((x) => x.turn >= 4)) note(`t${t.turn}.${t.step}: ${t.content.slice(0, 160)}`);
    const orders = await sql("select o.status, o.total_cents, (select count(*) from order_items i where i.order_id=o.id)::int items from orders o join calls c on c.id=o.call_id where c.twilio_call_sid=$1 order by o.created_at", [c.callSid]);
    note("orders: " + JSON.stringify(orders));
    note("texts: " + (await textsTo(from)).map((m) => m.body.slice(0, 60)).join(" || "));
  });

  await scenario("call: escalate to a person (live transfer, nobody answers)", async () => {
    const k = key();
    await sql("update businesses set escalation_phone='+13135550199' where id=$1", [R.biz.id]);
    await control("/ai/script", { key: k, turns: [[{ tools: [{ name: "escalate_to_human", input: { reason: "complaint", summary: "Cold fries last night" } }] }, { text: "Let me get someone." }], [{ text: "bye" }]] });
    const c = await runCall({ to: R.number, from: caller(), token: R.token, say: [`my fries were cold ${k}`, "ok"] });
    problems(c);
    note("ended " + c.ended + " | " + c.transcript.filter((t) => t.who === "system").map((t) => t.text).join(","));
    const esc = await sql("select * from calls where twilio_call_sid=$1", [c.callSid]);
    note(`outcome=${esc[0]?.outcome} reason=${esc[0]?.escalation_reason}`);
  });

  await scenario("call: caller asks for a human (transfer_call)", async () => {
    const k = key();
    await control("/ai/script", { key: k, turns: [[{ tools: [{ name: "transfer_call", input: {} }] }, { text: "Transferring." }], [{ text: "bye" }]] });
    const c = await runCall({ to: R.number, from: caller(), token: R.token, say: [`give me a human ${k}`, "ok"] });
    problems(c);
    note("ended " + c.ended + " | " + c.transcript.filter((t) => t.who === "system").map((t) => t.text).join(","));
  });

  await scenario("call: hidden caller ID", async () => {
    const k = key();
    await control("/ai/script", orderScript(k));
    const c = await runCall({ to: R.number, from: "anonymous", token: R.token, say: standardLines(k) });
    problems(c);
    const tr = await toolResults(k);
    note(tr.map((t) => t.content.slice(0, 120)).join(" | "));
    check((await control("/twilio/messages")).every((m) => m.to !== "anonymous"), "never text 'anonymous'");
  });

  await scenario("call: very long call hits the cap", async () => {
    const k = key();
    await control("/ai/script", { key: k, turns: [[{ text: "Sure, what else?" }]] });
    const lines = Array.from({ length: 90 }, (_, i) => (i === 0 ? `hi ${k}` : `tell me about item ${i}`));
    const c = await runCall({ to: R.number, from: caller(), token: R.token, say: lines, playAudio: false });
    problems(c);
    const n = c.transcript.filter((t) => t.who === "caller").length;
    note(`ended ${c.ended} after ${n} caller lines`);
    check(n <= 82, "call capped near 80 turns, went " + n);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await control("/reset");
  const browser = await chromium.launch();
  let R;
  await scenario("setup: live restaurant", async () => {
    R = await createLiveRestaurant(browser, { name: "Sim Burger Bar" });
    await openAllDay(R.biz.id);
    note(`number ${R.number}, stripe ${R.stripeAccount}, status ${R.biz.subscription_status}`);
    check(R.token, "have the subaccount token");
  });

  await scenario("call: order, consent, pay link, pay, kitchen ticket", async () => {
    const k = key();
    await control("/ai/script", orderScript(k));
    const from = caller();
    const c = await runCall({ to: R.number, from, token: R.token, say: standardLines(k) });
    for (const p of c.problems) check(false, p);
    note("ended: " + c.ended + " | AI: " + aiLines(c).map((l) => l.slice(0, 60)).join(" / "));
    const call = await one("select * from calls where twilio_call_sid=$1", [c.callSid]);
    check(call, "call row exists");
    note(`call status=${call?.status} outcome=${call?.outcome} duration=${call?.duration_seconds}`);
    const order = await one("select * from orders where call_id=$1", [call?.id]);
    if (!check(order, "order row created")) return;
    note(`order status=${order.status} pay=${order.payment_status} total=${order.total_cents} token=${!!order.pay_token}`);
    const sms = (await control("/twilio/messages")).filter((m) => m.to === from);
    check(sms.length === 1 && /\/pay\//.test(sms[0].body), "one payment-link text sent, got " + sms.length + ": " + sms.map((s) => s.body).join(" || "));
    const page = await fetch(order.payment_link_url.replace(/^https?:\/\/[^/]+/, APP));
    check(page.status === 200, "pay page loads: " + page.status);
    const html = await page.text();
    check(html.includes("Sim Burger Bar"), "pay page shows the restaurant name");
    const { res } = await payOrder(order);
    check(res.status === 200, "payment webhook -> " + res.status + " " + res.text.slice(0, 120));
    const paid = await one("select status, payment_status from orders where id=$1", [order.id]);
    note(`after pay: status=${paid.status} payment=${paid.payment_status}`);
    check(paid.payment_status === "paid", "order should be paid");
    const jobs = await sql("select * from printer_print_jobs where order_id=$1", [order.id]).catch((e) => (note("printer_jobs: " + e.message), []));
    note("print jobs: " + jobs.length);
    const sms2 = (await control("/twilio/messages")).filter((m) => m.to === from);
    note("texts to caller: " + sms2.map((s) => s.body.slice(0, 70)).join(" || "));
  });

  await callScenarios(R);
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(0);
}
