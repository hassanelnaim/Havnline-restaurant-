// The allergy check runs in code: heard in what the caller says, checked
// against the order, and said even when the AI skips note_allergy.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { sql, one, scenario, check, note, control, pool, results, runCall, sleep } from "./lib.mjs";
import { createLiveRestaurant } from "./journey.mjs";
import { key, caller, openAllDay, orderFor, toolResults } from "./calls.mjs";

const browser = await chromium.launch();
let R;

async function aiLines(callSid) {
  const rows = await sql("select m.content from call_messages m join calls c on c.id=m.call_id where c.twilio_call_sid=$1 and m.role='ai' order by m.created_at", [callSid]);
  return rows.map((r) => r.content);
}
const ADD = (name = "Cheeseburger") => ({ tools: [{ name: "add_item_to_order", input: { item_name: name, quantity: 1 } }] });

await scenario("allergy: set up", async () => {
  R = await createLiveRestaurant(browser, { name: "Allergy Diner", label: "allergy" });
  await openAllDay(R.biz.id);
  await sql("update menu_items set description='American cheese, lettuce, tomato, pickles' where business_id=$1 and name='Cheeseburger'", [R.biz.id]);
  await sleep(21000);
});

await scenario("allergy: said after ordering, AI skips note_allergy -> warning still said and on the order", async () => {
  const k = key();
  await control("/ai/script", { key: k, turns: [[ADD(), { text: "Got it. Anything else?" }], [{ text: "Okay, I'll let the staff know." }]] });
  const c = await runCall({ to: R.number, from: caller(), token: R.token, say: [`a cheeseburger please ${k}`, "I'm allergic to tomatoes"] });
  const lines = await aiLines(c.callSid);
  const reply = lines.find((l) => /staff know/.test(l)) || "";
  note("reply: " + reply);
  check(/Heads up, the menu says the Cheeseburger comes with tomato/.test(reply), "warning missing: " + reply);
  check(/noted your allergy/.test(reply), "allergy line missing");
  const o = await orderFor(c.callSid);
  check(/ALLERGY: tomatoes/.test(o?.special_instructions || ""), "not on the order: " + o?.special_instructions);
});

await scenario("allergy: said before ordering -> the cheeseburger is checked when it's added", async () => {
  const k = key();
  await control("/ai/script", { key: k, turns: [[{ text: "Sure, what can I get you?" }], [{ ...ADD(), text: "Got it, one cheeseburger. Anything else?" }, { text: "Got it, one cheeseburger. Anything else?" }]] });
  const c = await runCall({ to: R.number, from: caller(), token: R.token, say: [`hi ${k} I'm allergic to tomatoes`, "a cheeseburger"] });
  const lines = await aiLines(c.callSid);
  note("replies: " + JSON.stringify(lines.slice(-2)));
  check(/noted your allergy/.test(lines.find((l) => /what can I get/.test(l)) || ""), "first reply didn't say it's noted");
  const second = lines.find((l) => /one cheeseburger/.test(l)) || "";
  check(/Heads up, the menu says the Cheeseburger comes with tomato/.test(second), "warning missing on add: " + second);
  const res = (await toolResults(k)).map((t) => t.content).find((x) => /allergy_warning/.test(x)) || "";
  check(/allergy_warning/.test(res), "add_item result had no allergy_warning (first-pass reply not blocked?)");
  const o = await orderFor(c.callSid);
  check(/ALLERGY: tomatoes/.test(o?.special_instructions || ""), "not on the order: " + o?.special_instructions);
  check(!/noted your allergy/.test(second), "allergy line repeated on the add turn: " + second);
  check(!/cheeseburger/i.test(o?.special_instructions || ""), "the order was taken as an allergy: " + o?.special_instructions);
});

await scenario("allergy: 'yes, tomatoes' answering the allergy question", async () => {
  const k = key();
  await control("/ai/script", {
    key: k,
    turns: [[ADD(), { text: "Got it. Anything else?" }], [{ text: "Does anyone have a food allergy the kitchen should know about?" }], [{ text: "Okay." }]],
  });
  const c = await runCall({ to: R.number, from: caller(), token: R.token, say: [`a cheeseburger ${k}`, "that's all", "yes, tomatoes"] });
  const lines = await aiLines(c.callSid);
  const last = lines[lines.length - 1] || "";
  note("reply: " + last);
  check(/comes with tomato/.test(last), "warning missing: " + last);
  const o = await orderFor(c.callSid);
  check(/ALLERGY: tomatoes/.test(o?.special_instructions || ""), "not on the order");
});

await scenario("allergy: nothing on the menu matches -> noted, no false warning", async () => {
  const k = key();
  await control("/ai/script", { key: k, turns: [[ADD(), { text: "Got it. Anything else?" }], [{ text: "Okay." }]] });
  const c = await runCall({ to: R.number, from: caller(), token: R.token, say: [`a cheeseburger ${k}`, "I'm allergic to peanuts"] });
  const lines = await aiLines(c.callSid);
  const last = lines[lines.length - 1] || "";
  check(!/Heads up/.test(last), "false warning: " + last);
  check(/noted your allergy/.test(last), "allergy line missing: " + last);
  const o = await orderFor(c.callSid);
  check(/ALLERGY: peanuts/.test(o?.special_instructions || ""), "not on the order");
});

await scenario("allergy: 'no' to the allergy question -> nothing added", async () => {
  const k = key();
  await control("/ai/script", { key: k, turns: [[ADD(), { text: "Got it. Anything else?" }], [{ text: "Does anyone have a food allergy the kitchen should know about?" }], [{ text: "Great." }]] });
  const c = await runCall({ to: R.number, from: caller(), token: R.token, say: [`a cheeseburger ${k}`, "that's it", "no"] });
  const lines = await aiLines(c.callSid);
  check(lines[lines.length - 1] === "Great.", "reply changed: " + lines[lines.length - 1]);
  const o = await orderFor(c.callSid);
  check(!/ALLERGY/.test(o?.special_instructions || ""), "allergy added: " + o?.special_instructions);
});

await scenario("allergy: AI does it right itself -> nothing doubled", async () => {
  const k = key();
  await control("/ai/script", {
    key: k,
    turns: [[ADD(), { text: "Got it. Anything else?" }], [{ tools: [{ name: "note_allergy", input: { allergy: "tomatoes" } }] }, { text: "Heads up, the cheeseburger comes with tomato. I've noted your allergy for the kitchen. Want it without?" }]],
  });
  const c = await runCall({ to: R.number, from: caller(), token: R.token, say: [`a cheeseburger ${k}`, "I'm allergic to tomatoes"] });
  const lines = await aiLines(c.callSid);
  const last = lines[lines.length - 1] || "";
  check(last === "Heads up, the cheeseburger comes with tomato. I've noted your allergy for the kitchen. Want it without?", "reply changed: " + last);
  const o = await orderFor(c.callSid);
  check((o?.special_instructions || "").match(/ALLERGY: tomatoes/gi)?.length === 1, "allergy line count: " + o?.special_instructions);
});

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
await browser.close();
await pool.end();
