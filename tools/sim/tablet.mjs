// Kitchen tablet: pairing, polling/printing, PIN, refunds, discounts, added
// items (addendum charges), cross-restaurant access, and racing taps.
import { APP, sql, one, scenario, check, note, control, sleep } from "./lib.mjs";
import { payOrder, textsTo } from "./calls.mjs";
import { placeOrder } from "./pay.mjs";
import { newBrowserPage, createLiveRestaurant } from "./journey.mjs";

const api = async (path, { token, method = "GET", body, money, ip } = {}) => {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = "Bearer " + token;
  if (money) headers["x-money-action-token"] = money;
  if (ip) headers["x-real-ip"] = ip;
  const r = await fetch(APP + "/api/printer-app" + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  let j = null;
  const t = await r.text();
  try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 200) }; }
  return { status: r.status, body: j };
};

export async function pairTablet(page) {
  await page.goto(APP + "/dashboard/integrations");
  await page.waitForLoadState("networkidle");
  await page.click('button:has-text("Get pairing code")');
  const codeEl = page.locator(".font-mono.text-\\[24px\\]");
  await codeEl.waitFor({ timeout: 10000 });
  const code = (await codeEl.innerText()).trim();
  const r = await api("/pair", { method: "POST", body: { code }, ip: "10.9.9.9" });
  return { code, ...r };
}
export async function setPin(page, pin = "4321") {
  await page.goto(APP + "/dashboard/settings");
  await page.waitForLoadState("networkidle");
  await page.click('button:has-text("Your account"), [role=tab]:has-text("Your account")');
  await page.locator("#pin").pressSequentially(pin);
  await page.locator("#pin-confirm").pressSequentially(pin);
  await page.click('button:has-text("Set PIN"), button:has-text("Change PIN")');
  await sleep(1500);
}

export default async function tablet(R, browser) {
  let device, money;

  await scenario("tablet: pair with the dashboard code; code works once", async () => {
    const r = await pairTablet(R.page);
    check(r.status === 200 && r.body.deviceToken, "pairing -> " + r.status + " " + JSON.stringify(r.body).slice(0, 120));
    device = r.body.deviceToken;
    const again = await api("/pair", { method: "POST", body: { code: r.code }, ip: "10.9.9.8" });
    check(again.status === 400, "reusing a code is refused, got " + again.status);
    const row = await one("select printer_app_paired_at from businesses where id=$1", [R.biz.id]);
    check(row.printer_app_paired_at, "business marked paired");
  });

  await scenario("tablet: pairing code brute force is rate limited", async () => {
    const ip = "10.7.7.7";
    const codes = [];
    for (let i = 0; i < 14; i++) codes.push((await api("/pair", { method: "POST", body: { code: String(100000 + i) }, ip })).status);
    note(codes.join(","));
    check(codes.includes(429), "should hit 429 within 14 tries");
    const bad = await api("/pair", { method: "POST", body: "not json", ip: "10.7.7.8" });
    check(bad.status === 400, "garbage body -> 400, got " + bad.status);
  });

  await scenario("tablet: every route refuses a missing or wrong device token", async () => {
    const paths = [["/orders"], ["/today-orders"], ["/dashboard"], ["/menu"], ["/day-summary?date=2026-11-19"], ["/printer-ip", "POST"], ["/verify-pin", "POST"], ["/orders/00000000-0000-0000-0000-000000000000", "POST"], ["/today-orders/00000000-0000-0000-0000-000000000000/refund", "POST"], ["/today-orders/00000000-0000-0000-0000-000000000000/items", "POST"]];
    for (const [p, m] of paths) {
      for (const tok of [undefined, "garbage", device + "x"]) {
        const r = await api(p, { token: tok, method: m || "GET", body: m ? {} : undefined });
        check(r.status === 401, `${m || "GET"} ${p} token=${String(tok).slice(0, 8)} -> ${r.status}`);
      }
    }
  });

  await scenario("tablet: paid order prints once, even with two tablets polling", async () => {
    const { order } = await placeOrder(R);
    await payOrder(order);
    const o = await one("select status from orders where id=$1", [order.id]);
    note("order after pay: " + o.status);
    const polls = await Promise.all([api("/orders", { token: device }), api("/orders", { token: device }), api("/orders", { token: device })]);
    const got = polls.map((p) => (p.body.jobs || p.body.orders || []).length);
    note("jobs per poll: " + got.join(","));
    check(got.reduce((a, b) => a + b, 0) === 1, "the job is handed out exactly once");
    const job = polls.map((p) => (p.body.jobs || p.body.orders || [])[0]).find(Boolean);
    if (job) {
      const ack = await api("/orders/" + (job.id || job.jobId), { token: device, method: "POST", body: { status: "printed" } });
      check(ack.status === 200, "ack printed -> " + ack.status + " " + JSON.stringify(ack.body).slice(0, 100));
      const ack2 = await api("/orders/" + (job.id || job.jobId), { token: device, method: "POST", body: { status: "failed", error: "late" } });
      note("late 'failed' after 'printed' -> " + ack2.status + " " + JSON.stringify(ack2.body).slice(0, 80));
      const st = await one("select status, printed_at from printer_print_jobs where id=$1", [job.id || job.jobId]).catch((e) => ({ err: e.message }));
      note("job row: " + JSON.stringify(st));
    }
  });

  await scenario("tablet: money PIN — set in Settings, wrong PIN limits, token needed for refunds", async () => {
    await setPin(R.page, "4321");
    const set = await one("select count(*)::int n from businesses where id=$1", [R.biz.id]);
    let r = await api("/verify-pin", { token: device, method: "POST", body: { pin: "0000" } });
    check(r.status === 401, "wrong PIN -> 401, got " + r.status);
    r = await api("/verify-pin", { token: device, method: "POST", body: { pin: "4321" } });
    check(r.status === 200 && r.body.token, "right PIN -> token, got " + r.status + " " + JSON.stringify(r.body).slice(0, 100));
    money = r.body.token;
    const statuses = [];
    for (let i = 0; i < 10; i++) statuses.push((await api("/verify-pin", { token: device, method: "POST", body: { pin: String(1000 + i) } })).status);
    note("10 wrong PINs: " + statuses.join(","));
    check(statuses.includes(429), "wrong PINs get locked out");
    const lockEmail = (await control("/emails")).filter((e) => /PIN/i.test(e.subject || ""));
    note("lockout emails: " + lockEmail.length);
    r = await api("/verify-pin", { token: device, method: "POST", body: { pin: "4321" } });
    note("right PIN while locked -> " + r.status);
    await sql("delete from rate_limit_hits where rate_key like 'money_pin%'");
  });

  await scenario("tablet: refunds — partial, full, too much, twice at once, without PIN token", async () => {
    const { order } = await placeOrder(R);
    await payOrder(order);
    const o = await one("select total_cents from orders where id=$1", [order.id]);
    const today = await api("/today-orders", { token: device });
    check(today.status === 200, "today-orders -> " + today.status);
    let r = await api(`/today-orders/${order.id}/refund`, { token: device, method: "POST", body: { actionType: "refund", amountCents: 100, reason: "test" } });
    check(r.status === 401 && r.body.needsPin, "refund without PIN token refused: " + r.status);
    r = await api(`/today-orders/${order.id}/refund`, { token: device, method: "POST", money: "forged.token", body: { actionType: "refund", amountCents: 100 } });
    check(r.status === 401, "forged PIN token refused: " + r.status);
    r = await api(`/today-orders/${order.id}/refund`, { token: device, method: "POST", money, body: { actionType: "refund", amountCents: o.total_cents + 500, reason: "too much" } });
    check(r.status === 400, "refund above the total refused: " + r.status + " " + JSON.stringify(r.body).slice(0, 120));
    r = await api(`/today-orders/${order.id}/refund`, { token: device, method: "POST", money, body: { actionType: "refund", amountCents: -500 } });
    check(r.status === 400, "negative amount refused (it used to mean a full refund): " + r.status + " " + JSON.stringify(r.body).slice(0, 100));
    for (const bad of [0, "5.00", 0.4]) {
      const x = await api(`/today-orders/${order.id}/refund`, { token: device, method: "POST", money, body: { actionType: "refund", amountCents: bad } });
      if (bad === null) note("amountCents null -> " + x.status);
      else check(x.status === 400, `amountCents ${JSON.stringify(bad)} refused: ${x.status}`);
    }
    r = await api(`/today-orders/${order.id}/refund`, { token: device, method: "POST", money, body: { actionType: "discount", amountCents: 200, reason: "late" } });
    check(r.status === 200, "discount $2 -> " + r.status + " " + JSON.stringify(r.body).slice(0, 120));
    // Two staff tap "refund the rest" at the same moment.
    const rest = await Promise.all([1, 2, 3].map(() => api(`/today-orders/${order.id}/refund`, { token: device, method: "POST", money, body: { actionType: "refund", reason: "double tap" } })));
    note("3 simultaneous full refunds: " + rest.map((x) => x.status + ":" + (x.body.error || "ok").slice(0, 50)).join(" | "));
    const after = await one("select payment_status, amount_refunded_cents, total_cents from orders where id=$1", [order.id]);
    const pi = await control("/stripe/pi?id=" + order.stripe_payment_intent_id);
    const ch = await control("/stripe/charge?id=" + pi.latest_charge);
    note(`order refunded ${after.amount_refunded_cents}/${after.total_cents} (${after.payment_status}); Stripe refunded ${ch.amount_refunded}/${ch.amount}`);
    check(ch.amount_refunded <= ch.amount, "Stripe never refunds more than the charge");
    check(after.amount_refunded_cents === ch.amount_refunded, `our record matches Stripe: ${after.amount_refunded_cents} vs ${ch.amount_refunded}`);
    check(after.payment_status === "refunded", "fully refunded at the end, is " + after.payment_status);
  });

  await scenario("tablet: add items to a paid order (addendum charge) and pay for them", async () => {
    const { order, from } = await placeOrder(R);
    await payOrder(order);
    const menu = await api("/menu", { token: device });
    check(menu.status === 200, "menu -> " + menu.status);
    const items = menu.body.items || menu.body.menu?.flatMap((c) => c.items) || [];
    const coke = JSON.stringify(menu.body).match(/"id":"([0-9a-f-]{36})","[^}]*?"name":"Coke"/)?.[1] || (await one("select id from menu_items where business_id=$1 and name='Coke'", [R.biz.id])).id;
    let r = await api(`/today-orders/${order.id}/items`, { token: device, method: "POST", body: { menuItemId: coke, quantity: 2, mode: "charge" } });
    note("add 2 cokes -> " + r.status + " " + JSON.stringify(r.body).slice(0, 160));
    const charge = await one("select * from order_addendum_charges where order_id=$1 order by created_at desc limit 1", [order.id]);
    if (charge) {
      note(`addendum ${charge.status} ${charge.amount_cents}c token=${!!charge.pay_token}`);
      const t = (await textsTo(from)).slice(-1)[0];
      note("text: " + t?.body.slice(0, 90));
      const pi = await control("/stripe/succeed", { pi: charge.stripe_payment_intent_id });
      const { stripeEvent, stripeWebhook, CONNECT_WHSEC } = await import("./lib.mjs");
      const h = await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("payment_intent.succeeded", pi, { account: charge.stripe_connect_account_id || order.stripe_connect_account_id }), CONNECT_WHSEC);
      const c2 = await one("select status from order_addendum_charges where id=$1", [charge.id]);
      check(c2.status === "paid", "addendum paid after webhook, is " + c2.status + " (hook " + h.status + ")");
    }
    // Odd inputs
    for (const body of [{ menuItemId: coke, quantity: 0 }, { menuItemId: coke, quantity: -3 }, { menuItemId: coke, quantity: 1e9 }, { menuItemId: "00000000-0000-0000-0000-000000000000" }, { special: { name: "Extra sauce", amountCents: 50 }, mode: "charge" }, { special: { name: "Free thing", amountCents: -500 }, mode: "charge" }, { special: { name: "x".repeat(2000), amountCents: 100 }, mode: "charge" }, { special: { name: "Huge", amountCents: 1e9 }, mode: "charge" }, { menuItemId: coke, quantity: 5 }]) {
      const x = await api(`/today-orders/${order.id}/items`, { token: device, method: "POST", body });
      note(`${JSON.stringify(body).slice(0, 60)} -> ${x.status} ${JSON.stringify(x.body).slice(0, 90)}`);
      check(x.status < 500, "no server error for " + JSON.stringify(body).slice(0, 60));
    }
  });

  await scenario("tablet: one restaurant's tablet can't touch another restaurant's orders", async () => {
    const R2 = await createLiveRestaurant(browser, { name: "Other Place", label: "owner2" });
    const { openAllDay } = await import("./calls.mjs");
    await openAllDay(R2.biz.id);
    const { order } = await placeOrder(R2);
    await payOrder(order);
    const r1 = await api(`/today-orders/${order.id}/refund`, { token: device, method: "POST", money, body: { actionType: "refund", amountCents: 100 } });
    check(r1.status === 404 || r1.status === 400 || r1.status === 403, "refund on another restaurant's order refused: " + r1.status + " " + JSON.stringify(r1.body).slice(0, 80));
    const r2 = await api(`/today-orders/${order.id}/items`, { token: device, method: "POST", body: { special: { name: "x", priceCents: 100 } } });
    check(r2.status >= 400, "adding to another restaurant's order refused: " + r2.status);
    const job = await one("select id from printer_print_jobs where order_id=$1", [order.id]);
    if (job) {
      const r3 = await api(`/orders/${job.id}`, { token: device, method: "POST", body: { status: "printed" } });
      check(r3.status >= 400, "acking another restaurant's print job refused: " + r3.status);
    }
    const o = await one("select amount_refunded_cents from orders where id=$1", [order.id]);
    check(o.amount_refunded_cents === 0, "other order untouched");
    globalThis.R2 = R2;
  });

  await scenario("tablet: unpair from dashboard kills the device token", async () => {
    await R.page.goto(APP + "/dashboard/integrations");
    await R.page.waitForLoadState("networkidle");
    await R.page.click('button:has-text("Unpair tablet")');
    await sleep(1500);
    const r = await api("/orders", { token: device });
    check(r.status === 401, "old token refused after unpair: " + r.status);
  });
}
