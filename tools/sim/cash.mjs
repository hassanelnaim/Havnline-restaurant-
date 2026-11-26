// Cash at pickup: the AI's card-or-cash choice, kitchen ticket, tablet Paid in cash / No-show,
// card-only after a no-show, Settings (off, limit), the nightly 3% billing, and the menu Combo box.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { APP, sql, one, scenario, check, note, control, pool, results, runCall, sleep } from "./lib.mjs";
import { createLiveRestaurant } from "./journey.mjs";
import { key, caller, openAllDay, orderFor, toolResults, textsTo } from "./calls.mjs";
import { pairTablet } from "./tablet.mjs";

const browser = await chromium.launch();
const settle = () => sleep(21000); // business details are cached 20s per server
let R, device;

const api = async (path, { method = "GET", body } = {}) => {
  const r = await fetch(APP + "/api/printer-app" + path, { method, headers: { "content-type": "application/json", authorization: "Bearer " + device }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

function cashScript(k, { pay = "cash", name = "Sam" } = {}) {
  return {
    key: k,
    turns: [
      [{ tools: [{ name: "add_item_to_order", input: { item_name: "Cheeseburger", quantity: 1 } }, { name: "add_item_to_order", input: { item_name: "Fries", quantity: 1 } }] }, { text: "Got it. Anything else?" }],
      [{ text: "Okay. Can I get a name for the order?" }],
      [{ text: `Thanks, ${name}. Would you like to pay by card now, or cash when you pick it up?` }],
      [{ tools: [{ name: "confirm_and_place_order", input: { customer_name: name, payment_method: pay } }] }, { text: "You're all set." }],
      [{ text: "Thanks for calling. Goodbye!" }],
    ],
  };
}
const cashLines = (k) => [`Hi, I'd like a cheeseburger and fries ${k}`, "That's it", "Sam", "Cash", "Thanks, bye"];
async function cashCall(from = caller()) {
  const k = key();
  await control("/ai/script", cashScript(k));
  const c = await runCall({ to: R.number, from, token: R.token, say: cashLines(k) });
  const order = await orderFor(c.callSid);
  const results = (await toolResults(k)).map((t) => t.content);
  return { c, order, from, k, confirm: results[results.length - 1] || "" };
}

await scenario("cash: set up", async () => {
  R = await createLiveRestaurant(browser, { name: "Cash Diner", label: "cash" });
  await openAllDay(R.biz.id);
  await sql("update businesses set stripe_customer_id='cus_simcash', subscription_status='active', platform_fee_bps=300 where id=$1", [R.biz.id]);
  const p = await pairTablet(R.page);
  device = p.body?.deviceToken;
  check(device, "tablet paired");
  const b = await one("select accepts_cash, cash_max_cents from businesses where id=$1", [R.biz.id]);
  check(b.accepts_cash === true && b.cash_max_cents === null, "defaults: cash on, no limit " + JSON.stringify(b));
  await settle();
});

let paidOrder, noShowOrder, noShowFrom;
await scenario("cash: the AI asks card or cash; a cash order prints straight away", async () => {
  const { c, order, from } = await cashCall();
  paidOrder = order;
  check(c.problems.length === 0, c.problems.join("; "));
  const sys = (await control("/ai/last-system")).system;
  check(sys.includes("Would you like to pay by card now, or cash when you pick it up?"), "prompt doesn't offer card or cash");
  check(order?.payment_method === "cash" && order.payment_status === "not_required", "order " + JSON.stringify(order && { pm: order.payment_method, ps: order.payment_status, st: order.status }));
  check(order?.status === "submitted", "cash order not sent to kitchen: " + order?.status);
  check(order?.cash_fee_cents === Math.round(order.total_cents * 0.03), `fee ${order?.cash_fee_cents} for total ${order?.total_cents}`);
  const job = await one("select ticket_text from printer_print_jobs where order_id=$1", [order.id]);
  check(job && job.ticket_text.includes(`CASH - COLLECT $${(order.total_cents / 100).toFixed(2)} AT PICKUP`), "ticket banner missing: " + job?.ticket_text?.slice(0, 200));
  check(job && job.ticket_text.includes("NOT PAID - CASH AT PICKUP"), "ticket footer missing");
  check((await textsTo(from)).length === 0, "a cash order sent a text");
  check(!(await one("select 1 as x from sms_consents where order_id=$1", [order.id])), "recorded a text consent for a cash order");
  check(c.transcript.some((t) => t.who === "ai" && /moment/i.test(t.text)), "no \"one moment\" before placing the order");
});

await scenario("cash: tablet shows it, Paid in cash closes it", async () => {
  const list = await api("/today-orders");
  const o = list.body.orders.find((x) => x.id === paidOrder.id);
  check(o?.payment_method === "cash" && !o.cash_collected_at, "tablet order " + JSON.stringify(o && { pm: o.payment_method }));
  check(!("pay_token" in (o || {})), "tablet list leaks other order fields");
  check(list.body.summary.cashOutstandingCents === paidOrder.total_cents, "summary cash to collect " + list.body.summary.cashOutstandingCents);
  const r = await api(`/today-orders/${paidOrder.id}/cash`, { method: "POST", body: { action: "paid" } });
  check(r.status === 200, "paid -> " + r.status + " " + JSON.stringify(r.body));
  const again = await api(`/today-orders/${paidOrder.id}/cash`, { method: "POST", body: { action: "paid" } });
  check(again.status === 409, "second paid should be refused, " + again.status);
  const ns = await api(`/today-orders/${paidOrder.id}/cash`, { method: "POST", body: { action: "no_show" } });
  check(ns.status === 409, "no-show after paid should be refused, " + ns.status);
  const row = await one("select payment_status, cash_collected_at from orders where id=$1", [paidOrder.id]);
  check(row.payment_status === "paid" && row.cash_collected_at, "row " + JSON.stringify(row));
  const s = (await api("/today-orders")).body.summary;
  check(s.cashOutstandingCents === 0 && s.cashCents === paidOrder.total_cents, "summary after paid " + JSON.stringify(s));
});

await scenario("cash: no-show cancels it and makes that number card-only", async () => {
  noShowFrom = caller();
  const { order } = await cashCall(noShowFrom);
  noShowOrder = order;
  const r = await api(`/today-orders/${order.id}/cash`, { method: "POST", body: { action: "no_show" } });
  check(r.status === 200, "no-show -> " + r.status);
  const row = await one("select status, no_show_at from orders where id=$1", [order.id]);
  check(row.status === "cancelled" && row.no_show_at, "row " + JSON.stringify(row));
  const cust = await one("select card_only_since from customers where business_id=$1 and phone=$2", [R.biz.id, noShowFrom]);
  check(cust?.card_only_since, "customer not card-only");
  const again = await cashCall(noShowFrom);
  check(again.order?.status === "building", "a card-only number placed a cash order: " + again.order?.status);
  check(/can only pay by card/.test(again.confirm), "AI not told card-only: " + again.confirm.slice(0, 150));
});

await scenario("cash: restaurant clears card-only on the Customers page", async () => {
  await R.page.goto(APP + "/dashboard/customers");
  await R.page.waitForLoadState("networkidle");
  check((await R.page.getByText("Card only", { exact: true }).count()) >= 1, "no Card only badge");
  await R.page.locator("tr", { hasText: noShowFrom }).first().click();
  await R.page.getByRole("button", { name: /Allow cash at pickup again/ }).click({ timeout: 8000 });
  await sleep(1500);
  const cust = await one("select card_only_since from customers where business_id=$1 and phone=$2", [R.biz.id, noShowFrom]);
  check(!cust.card_only_since, "still card-only");
});

await scenario("cash: Settings limit and switch", async () => {
  const p = R.page;
  await p.goto(APP + "/dashboard/settings");
  await p.waitForLoadState("networkidle");
  await p.fill("#cash-max", "5");
  await p.getByRole("button", { name: "Save cash settings" }).click();
  await p.getByText("Saved", { exact: true }).first().waitFor({ timeout: 8000 });
  check((await one("select cash_max_cents from businesses where id=$1", [R.biz.id])).cash_max_cents === 500, "limit not saved");
  await settle();
  const over = await cashCall();
  check(over.order?.status === "building", "over-limit cash order placed");
  check(/only for orders up to \$5\.00/.test(over.confirm), "limit reason: " + over.confirm.slice(0, 160));
  check((await control("/ai/last-system")).system.includes("Cash is only for orders up to $5.00"), "prompt doesn't state the limit");

  await p.goto(APP + "/dashboard/settings");
  await p.waitForLoadState("networkidle");
  await p.locator("#accepts-cash").click();
  await p.getByRole("button", { name: "Save cash settings" }).click();
  await p.getByText("Saved", { exact: true }).first().waitFor({ timeout: 8000 });
  check((await one("select accepts_cash from businesses where id=$1", [R.biz.id])).accepts_cash === false, "switch not saved");
  await settle();
  const off = await cashCall();
  check(off.order?.status === "building", "cash order placed with cash off");
  check(/doesn't take cash/.test(off.confirm), "cash-off reason: " + off.confirm.slice(0, 120));
  const sys = (await control("/ai/last-system")).system;
  check(!sys.includes("or cash when you pick it up"), "prompt still offers cash");
  check(sys.includes("no pay-at-pickup option"), "card-only payment rule missing");
  await sql("update businesses set accepts_cash=true, cash_max_cents=null where id=$1", [R.biz.id]);
});

await scenario("cash: nightly job bills 3% on collected cash orders, not no-shows, once", async () => {
  await sql("update orders set created_at=now()-interval '2 days' where id = any($1)", [[paidOrder.id, noShowOrder.id]]);
  const before = (await control("/stripe/invoice-items")).length;
  const run = async () => fetch(APP + "/api/cron/cash-fees", { headers: { authorization: "Bearer sim-cron-secret" } }).then((r) => r.json());
  const res = await run();
  note(JSON.stringify(res));
  const items = (await control("/stripe/invoice-items")).slice(before);
  check(items.length === 1, "invoice items " + items.length);
  check(items[0]?.customer === "cus_simcash" && items[0]?.amount === paidOrder.cash_fee_cents, "item " + JSON.stringify(items[0]));
  const rows = await sql("select id, cash_fee_billed_at, cash_fee_invoice_item from orders where id = any($1)", [[paidOrder.id, noShowOrder.id]]);
  const paid = rows.find((r) => r.id === paidOrder.id), ns = rows.find((r) => r.id === noShowOrder.id);
  check(paid.cash_fee_invoice_item === items[0]?.id, "paid order not marked billed");
  check(ns.cash_fee_invoice_item === "not_charged", "no-show should be marked not charged: " + ns.cash_fee_invoice_item);
  await run();
  check((await control("/stripe/invoice-items")).length === before + 1, "second run billed again");
  const unauth = await fetch(APP + "/api/cron/cash-fees");
  check(unauth.status === 401, "cron without secret " + unauth.status);
});

await scenario("cash: card orders still work and say paid by card", async () => {
  const { placeOrder } = await import("./pay.mjs");
  const { order } = await placeOrder(R);
  check(order?.payment_status === "awaiting_payment" && order.payment_method === "card", "card order " + JSON.stringify(order && { ps: order.payment_status, pm: order.payment_method }));
  await control("/stripe/succeed", { pi: order.stripe_payment_intent_id });
  await fetch(`${APP}/pay/${order.pay_token}`); // the pay page's reload after paying records it
  await sleep(2500);
  const job = await one("select ticket_text from printer_print_jobs where order_id=$1", [order.id]);
  check(job && job.ticket_text.includes("PAID BY CARD") && !job.ticket_text.includes("CASH - COLLECT"), "card ticket: " + job?.ticket_text?.slice(-120));
});

await scenario("combo: menu editor combo price; AI sees the combo add-on", async () => {
  const p = R.page;
  const item = await one("select id, name, price_cents from menu_items where business_id=$1 and name='Cheeseburger'", [R.biz.id]);
  await p.goto(APP + "/dashboard/menu");
  await p.waitForLoadState("networkidle");
  await p.getByText("Cheeseburger", { exact: true }).first().click();
  await p.getByRole("button", { name: /Sold as a combo too/ }).first().click();
  await p.fill(`#combo-price-${item.id}`, ((item.price_cents - 100) / 100).toFixed(2));
  await p.getByRole("button", { name: "Save combo" }).click();
  await p.getByText(/combo price has to be more/).waitFor({ timeout: 8000 });
  await p.fill(`#combo-price-${item.id}`, ((item.price_cents + 700) / 100).toFixed(2));
  await p.fill(`#combo-with-${item.id}`, "fries & a drink");
  await p.getByRole("button", { name: "Save combo" }).click();
  await sleep(2000);
  const mod = await one("select m.name, m.price_delta_cents, g.is_required from modifiers m join modifier_groups g on g.id=m.modifier_group_id where g.menu_item_id=$1 and g.name='Combo'", [item.id]);
  check(mod?.name === "Make it a combo (fries & a drink)" && mod.price_delta_cents === 700 && mod.is_required === false, "combo option " + JSON.stringify(mod));
  check((await one("select price_cents from menu_items where id=$1", [item.id])).price_cents === item.price_cents, "item price changed");
  await settle();
  const k = key();
  await control("/ai/script", { key: k, turns: [[{ text: "Sure." }]] });
  await runCall({ to: R.number, from: caller(), token: R.token, say: [`hi ${k}`] });
  const sys = (await control("/ai/last-system")).system;
  check(/combo\/meal add-on[^\n]*Cheeseburger/.test(sys), "AI not told Cheeseburger has a combo");
  check(sys.includes("Never lower a price yourself"), "combo pricing rule missing");
});

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
await browser.close();
await pool.end();
