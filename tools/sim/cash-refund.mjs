// Refunding a cash order on the tablet, behind the manager PIN: only after
// "Paid in cash", part or full, once per tap, HavnLine's 3% follows, and the
// drawer total on the tablet goes down by what was given back.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { APP, sql, one, scenario, check, note, control, pool, results, runCall, sleep } from "./lib.mjs";
import { createLiveRestaurant } from "./journey.mjs";
import { key, caller, openAllDay, orderFor, textsTo } from "./calls.mjs";
import { pairTablet, setPin } from "./tablet.mjs";

const browser = await chromium.launch();
let R, device, money, order, from;

const api = async (path, { method = "GET", body, pin = true } = {}) => {
  const headers = { "content-type": "application/json", authorization: "Bearer " + device };
  if (pin && money) headers["x-money-action-token"] = money;
  const r = await fetch(APP + "/api/printer-app" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const refund = (body, opts) => api(`/today-orders/${order.id}/refund`, { method: "POST", body, ...opts });
const row = () => one("select payment_status, amount_refunded_cents, cash_fee_cents, total_cents, refund_reason from orders where id=$1", [order.id]);

await scenario("cash refund: set up (cash order, tablet, PIN)", async () => {
  R = await createLiveRestaurant(browser, { name: "Refund Diner", label: "cashrefund" });
  await openAllDay(R.biz.id);
  await sql("update businesses set stripe_customer_id='cus_simrefund', subscription_status='active', platform_fee_bps=300 where id=$1", [R.biz.id]);
  device = (await pairTablet(R.page)).body?.deviceToken;
  await setPin(R.page, "4321");
  await sleep(21000);
  const k = key();
  await control("/ai/script", {
    key: k,
    turns: [
      [{ tools: [{ name: "add_item_to_order", input: { item_name: "Cheeseburger", quantity: 2 } }] }, { text: "Got it. Anything else?" }],
      [{ tools: [{ name: "confirm_and_place_order", input: { customer_name: "Sam", payment_method: "cash" } }] }, { text: "You're all set." }],
    ],
  });
  from = caller();
  const c = await runCall({ to: R.number, from, token: R.token, say: [`two cheeseburgers ${k}`, "cash, Sam"] });
  order = await orderFor(c.callSid);
  check(order?.payment_method === "cash" && order.cash_fee_cents > 0, "cash order " + JSON.stringify(order && { pm: order.payment_method, fee: order.cash_fee_cents }));
  note(`total ${order?.total_cents}, fee ${order?.cash_fee_cents}`);
});

await scenario("cash refund: needs the PIN", async () => {
  const r = await refund({ actionType: "refund", amountCents: 100 }, { pin: false });
  check(r.status === 401 && r.body?.needsPin, "no PIN -> " + r.status + " " + JSON.stringify(r.body));
  const v = await api("/verify-pin", { method: "POST", body: { pin: "4321" }, pin: false });
  money = v.body?.token;
  check(money, "PIN verified");
});

await scenario("cash refund: refused before Paid in cash", async () => {
  const r = await refund({ actionType: "refund", amountCents: 100 });
  check(r.status === 400 && /Paid in cash/.test(r.body?.error || ""), "before paid -> " + r.status + " " + r.body?.error);
  check((await row()).amount_refunded_cents === 0, "something was recorded");
});

await scenario("cash refund: part refund records it, lowers the 3%, no text, owner emailed", async () => {
  await api(`/today-orders/${order.id}/cash`, { method: "POST", body: { action: "paid" } });
  const before = await row();
  const emailsBefore = (await control("/emails")).length;
  const r = await refund({ actionType: "refund", amountCents: 200, reason: "Missing fries" });
  check(r.status === 200 && r.body?.success && r.body.cash === true && r.body.refundedCents === 200, "refund -> " + r.status + " " + JSON.stringify(r.body));
  const after = await row();
  check(after.payment_status === "partially_refunded" && after.amount_refunded_cents === 200, "order " + JSON.stringify(after));
  const wantFee = Math.round((before.cash_fee_cents * (before.total_cents - 200)) / before.total_cents);
  check(after.cash_fee_cents === wantFee, `fee ${before.cash_fee_cents} -> ${after.cash_fee_cents}, wanted ${wantFee}`);
  check(after.refund_reason === "Missing fries", "reason " + after.refund_reason);
  const log = await one("select action, amount_cents from tablet_money_actions where order_id=$1 order by created_at desc limit 1", [order.id]);
  check(log?.amount_cents === 200, "audit row " + JSON.stringify(log));
  check((await textsTo(from)).every((t) => !/refund/i.test(t.body || t.Body || "")), "customer got a card-refund text");
  await sleep(1500);
  const emails = (await control("/emails")).slice(emailsBefore);
  check(emails.some((e) => /refunded in cash/.test(JSON.stringify(e))), "owner email missing or says card: " + JSON.stringify(emails).slice(0, 200));
});

await scenario("cash refund: tablet shows it and the drawer total goes down", async () => {
  const list = await api("/today-orders");
  const o = list.body.orders.find((x) => x.id === order.id);
  check(o?.amount_refunded_cents === 200 && o.payment_status === "partially_refunded", "tablet order " + JSON.stringify(o && { r: o.amount_refunded_cents, ps: o.payment_status }));
  const s = list.body.summary;
  check(s.cashCents === order.total_cents - 200, `drawer ${s.cashCents}, wanted ${order.total_cents - 200}`);
  check(s.refundedCents === 200, "refunded " + s.refundedCents);
});

await scenario("cash refund: a double tap refunds once; can't go over", async () => {
  const left = order.total_cents - 200;
  const [a, b] = await Promise.all([refund({ actionType: "discount", amountCents: 100 }), refund({ actionType: "discount", amountCents: 100 })]);
  note(`double tap -> ${a.status}, ${b.status}`);
  check([a.status, b.status].filter((s) => s === 200).length === 1, "both or neither went through");
  check((await row()).amount_refunded_cents === 300, "refunded " + (await row()).amount_refunded_cents);
  const over = await refund({ actionType: "refund", amountCents: left });
  check(over.status === 400 && /more than/.test(over.body?.error || ""), "over-refund -> " + over.status + " " + over.body?.error);
});

await scenario("cash refund: the rest -> fully refunded, no 3% left, nothing billed", async () => {
  const r = await refund({ actionType: "refund" });
  check(r.status === 200 && r.body.fullyRefunded, "full refund -> " + JSON.stringify(r.body));
  const after = await row();
  check(after.payment_status === "refunded" && after.amount_refunded_cents === after.total_cents && after.cash_fee_cents === 0, "order " + JSON.stringify(after));
  const again = await refund({ actionType: "refund" });
  check(again.status === 400, "refund after full -> " + again.status);
  const s = (await api("/today-orders")).body.summary;
  check(s.cashCents === 0, "drawer " + s.cashCents);
  await sql("update orders set created_at = now() - interval '2 days' where id=$1", [order.id]);
  const cron = await fetch(APP + "/api/cron/cash-fees", { headers: { authorization: "Bearer sim-cron-secret" } }).then((x) => x.json());
  note("cron " + JSON.stringify(cron).slice(0, 200));
  const billed = await one("select cash_fee_invoice_item from orders where id=$1", [order.id]);
  check(billed.cash_fee_invoice_item === "not_charged", "fee billed on a refunded order: " + billed.cash_fee_invoice_item);
});

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
await browser.close();
await pool.end();
