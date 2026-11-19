// Payment simulations: webhooks in every order and shape, the pay page in
// every state, expiry races, refunds.
import { APP, sql, one, scenario, check, note, control, runCall, stripeEvent, stripeWebhook, CONNECT_WHSEC, sleep } from "./lib.mjs";
import { key, caller, orderScript, standardLines, textsTo, payOrder, orderFor } from "./calls.mjs";

/** Places a phone order through a real simulated call; returns the order row and caller. */
export async function placeOrder(R, opts = {}) {
  const k = key();
  await control("/ai/script", orderScript(k, opts));
  const from = opts.from || caller();
  const c = await runCall({ to: R.number, from, token: R.token, say: standardLines(k) });
  const order = await orderFor(c.callSid);
  return { order, from, call: c };
}
const payPage = async (token) => {
  const r = await fetch(`${APP}/pay/${token}`);
  return { status: r.status, html: await r.text() };
};
const state = (html) => (/Payment received|already paid|been paid/i.test(html) ? "paid" : /expired|no longer|isn't available|can't be paid|cancel/i.test(html) ? "dead" : /data-pay-form|Pay \$|PayForm|client_secret|Pay now/i.test(html) ? "open" : "other");

export async function payScenarios(R) {
  await scenario("pay: webhook never arrives -> pay page reload still records the payment", async () => {
    const { order, from } = await placeOrder(R);
    await control("/stripe/succeed", { pi: order.stripe_payment_intent_id });
    const p = await payPage(order.pay_token); // what the form's reload after paying does
    check(state(p.html) === "paid", "page says paid");
    await sleep(1500);
    const o = await one("select payment_status, status from orders where id=$1", [order.id]);
    check(o.payment_status === "paid", "order recorded as paid without any webhook, is " + o.payment_status);
    const t = (await textsTo(from)).filter((m) => /Payment received/.test(m.body)).length;
    check(t === 1, "confirmation text sent once, got " + t);
    await payPage(order.pay_token);
    const { stripeEvent: ev, stripeWebhook: wh, CONNECT_WHSEC: sec } = await import("./lib.mjs");
    const pi = await control("/stripe/pi?id=" + order.stripe_payment_intent_id);
    await wh("/api/webhooks/stripe-connect", ev("payment_intent.succeeded", pi, { account: order.stripe_connect_account_id }), sec);
    const t2 = (await textsTo(from)).filter((m) => /Payment received/.test(m.body)).length;
    check(t2 === 1, "late webhook + second page load still one text, got " + t2);
  });

  await scenario("pay: webhook never arrives, link expires -> sweep records the payment", async () => {
    const { order } = await placeOrder(R);
    await control("/stripe/succeed", { pi: order.stripe_payment_intent_id });
    await sql("update orders set payment_expires_at = now() - interval '2 minute' where id=$1", [order.id]);
    const r = await fetch(APP + "/api/cron/cleanup", { headers: { authorization: "Bearer sim-cron-secret" } });
    const o = await one("select payment_status, status from orders where id=$1", [order.id]);
    check(o.payment_status === "paid" && o.status !== "cancelled", `sweep finds it paid and records it: ${o.status}/${o.payment_status} (cron ${r.status})`);
  });

  await scenario("pay: duplicate webhook (same event 5x at once) -> one confirmation text, paid once", async () => {
    const { order, from } = await placeOrder(R);
    const pi = await control("/stripe/succeed", { pi: order.stripe_payment_intent_id });
    const ev = stripeEvent("payment_intent.succeeded", pi, { account: order.stripe_connect_account_id });
    const rs = await Promise.all(Array.from({ length: 5 }, () => stripeWebhook("/api/webhooks/stripe-connect", ev, CONNECT_WHSEC)));
    check(rs.every((r) => r.status === 200), "all deliveries 200: " + rs.map((r) => r.status));
    // A different event id for the same payment (Stripe can send both).
    await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("payment_intent.succeeded", pi, { account: order.stripe_connect_account_id }), CONNECT_WHSEC);
    const texts = (await textsTo(from)).filter((m) => /Payment received/.test(m.body));
    check(texts.length === 1, "one 'Payment received' text, got " + texts.length);
    const o = await one("select payment_status, status from orders where id=$1", [order.id]);
    check(o.payment_status === "paid", "paid");
    const jobs = await sql("select id from printer_print_jobs where order_id=$1", [order.id]).catch(() => []);
    note(`print jobs: ${jobs.length} (no tablet paired)`);
  });

  await scenario("pay: webhook from the wrong connected account is ignored", async () => {
    const { order } = await placeOrder(R);
    const pi = await control("/stripe/succeed", { pi: order.stripe_payment_intent_id });
    const r = await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("payment_intent.succeeded", pi, { account: "acct_attacker" }), CONNECT_WHSEC);
    check(r.status === 200, "answered 200 (so Stripe doesn't retry forever): " + r.status);
    const o = await one("select payment_status from orders where id=$1", [order.id]);
    check(o.payment_status === "awaiting_payment", "must stay unpaid, is " + o.payment_status);
  });

  await scenario("pay: webhook amount or intent doesn't match the order", async () => {
    const { order } = await placeOrder(R);
    const pi = await control("/stripe/succeed", { pi: order.stripe_payment_intent_id });
    let r = await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("payment_intent.succeeded", { ...pi, id: "pi_other", amount: 50, amount_received: 50 }, { account: order.stripe_connect_account_id }), CONNECT_WHSEC);
    let o = await one("select payment_status from orders where id=$1", [order.id]);
    check(o.payment_status === "awaiting_payment", "a different intent must not mark it paid, is " + o.payment_status);
    r = await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("payment_intent.succeeded", { ...pi, amount: 50, amount_received: 50 }, { account: order.stripe_connect_account_id }), CONNECT_WHSEC);
    o = await one("select payment_status from orders where id=$1", [order.id]);
    note("same intent, wrong amount -> " + o.payment_status);
  });

  await scenario("pay: forged / missing signature, unknown order, missing marker", async () => {
    const { order } = await placeOrder(R);
    const pi = await control("/stripe/succeed", { pi: order.stripe_payment_intent_id });
    const ev = stripeEvent("payment_intent.succeeded", pi, { account: order.stripe_connect_account_id });
    let r = await stripeWebhook("/api/webhooks/stripe-connect", ev, CONNECT_WHSEC, { badSig: true });
    check(r.status === 400, "bad signature -> 400, got " + r.status);
    r = await stripeWebhook("/api/webhooks/stripe-connect", ev, "whsec_wrong");
    check(r.status === 400, "signed with another secret -> 400, got " + r.status);
    r = await stripeWebhook("/api/webhooks/stripe", ev, CONNECT_WHSEC);
    check(r.status === 400, "connect event sent to the platform endpoint -> 400, got " + r.status);
    r = await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("payment_intent.succeeded", { ...pi, metadata: { ...pi.metadata, order_id: "00000000-0000-0000-0000-000000000000" } }, { account: order.stripe_connect_account_id }), CONNECT_WHSEC);
    check(r.status === 200, "unknown order -> 200, got " + r.status);
    r = await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("payment_intent.succeeded", { ...pi, metadata: { order_id: "not-a-uuid", havnline_pay_page: "1" } }, { account: order.stripe_connect_account_id }), CONNECT_WHSEC);
    note("order_id 'not-a-uuid' -> " + r.status + " " + r.text.slice(0, 80));
    r = await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("payment_intent.succeeded", { ...pi, metadata: { order_id: order.id } }, { account: order.stripe_connect_account_id }), CONNECT_WHSEC);
    const o = await one("select payment_status from orders where id=$1", [order.id]);
    check(o.payment_status === "awaiting_payment", "without the pay-page marker the event is ignored, is " + o.payment_status);
    const garbage = await fetch(APP + "/api/webhooks/stripe-connect", { method: "POST", body: "not json", headers: { "stripe-signature": "t=1,v1=x" } });
    check(garbage.status === 400, "garbage body -> 400, got " + garbage.status);
  });

  await scenario("pay page: every state", async () => {
    const { order } = await placeOrder(R);
    let p = await payPage(order.pay_token);
    check(p.status === 200 && state(p.html) === "open", "open order -> pay form, got " + p.status + " " + state(p.html));
    for (const bad of ["x", "A".repeat(24), "../../etc/passwd", "%27%20or%201%3D1--", "a".repeat(5000), "%00"]) {
      const r = await payPage(bad);
      check(r.status < 500, `token ${bad.slice(0, 20)} -> ${r.status}`);
    }
    await payOrder(order);
    p = await payPage(order.pay_token);
    check(state(p.html) === "paid", "after paying -> paid state, got " + state(p.html));
    check(!/client_secret|pi_\w+_secret/.test(p.html), "paid page must not include the payment secret");
  });

  await scenario("pay: link expires -> page closes it, Stripe intent cancelled, late payment refused", async () => {
    const { order } = await placeOrder(R);
    await sql("update orders set payment_expires_at = now() - interval '1 minute' where id=$1", [order.id]);
    const p = await payPage(order.pay_token);
    note("expired page state: " + state(p.html));
    const o = await one("select status, payment_status from orders where id=$1", [order.id]);
    const pi = await control("/stripe/pi?id=" + order.stripe_payment_intent_id);
    note(`order ${o.status}/${o.payment_status}, intent ${pi.status}`);
    check(pi.status === "canceled", "intent should be cancelled at Stripe");
    check(o.payment_status !== "awaiting_payment", "order should no longer await payment");
    const late = await control("/stripe/succeed", { pi: order.stripe_payment_intent_id });
    check(late.error === "canceled", "a cancelled intent can't be paid");
  });

  await scenario("pay: customer pays at the very moment the link expires", async () => {
    const { order, from } = await placeOrder(R);
    const pi = await control("/stripe/succeed", { pi: order.stripe_payment_intent_id });
    await sql("update orders set payment_expires_at = now() - interval '1 second' where id=$1", [order.id]);
    // Expiry (page load) and the webhook race.
    const ev = stripeEvent("payment_intent.succeeded", pi, { account: order.stripe_connect_account_id });
    const [page, hook] = await Promise.all([payPage(order.pay_token), stripeWebhook("/api/webhooks/stripe-connect", ev, CONNECT_WHSEC)]);
    await sleep(500);
    const o = await one("select status, payment_status, submit_error from orders where id=$1", [order.id]);
    note(`order ${o.status}/${o.payment_status} err=${o.submit_error} page=${state(page.html)} hook=${hook.status}`);
    check(o.payment_status === "paid" && o.status !== "cancelled", "a paid order must never end up cancelled");
    const sent = (await textsTo(from)).filter((m) => /Payment received/.test(m.body)).length;
    check(sent === 1, "one confirmation text, got " + sent);
  });

  await scenario("pay: expired link, webhook arrives FIRST, then the sweep", async () => {
    const { order } = await placeOrder(R);
    const pi = await control("/stripe/succeed", { pi: order.stripe_payment_intent_id });
    await sql("update orders set payment_expires_at = now() - interval '5 minute' where id=$1", [order.id]);
    await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("payment_intent.succeeded", pi, { account: order.stripe_connect_account_id }), CONNECT_WHSEC);
    const cron = await fetch(APP + "/api/cron/cleanup", { headers: { authorization: "Bearer sim-cron-secret" } });
    note("cleanup cron -> " + cron.status);
    const o = await one("select status, payment_status from orders where id=$1", [order.id]);
    check(o.payment_status === "paid" && o.status !== "cancelled", `paid order must survive the sweep: ${o.status}/${o.payment_status}`);
  });

  await scenario("pay: the cleanup sweep closes old unpaid links (and needs its secret)", async () => {
    const { order } = await placeOrder(R);
    await sql("update orders set payment_expires_at = now() - interval '10 minute' where id=$1", [order.id]);
    const no = await fetch(APP + "/api/cron/cleanup");
    check(no.status === 401 || no.status === 403, "cron without secret refused, got " + no.status);
    const wrong = await fetch(APP + "/api/cron/cleanup", { headers: { authorization: "Bearer nope" } });
    check(wrong.status === 401 || wrong.status === 403, "cron with wrong secret refused, got " + wrong.status);
    const ok = await fetch(APP + "/api/cron/cleanup", { headers: { authorization: "Bearer sim-cron-secret" } });
    check(ok.status === 200, "cron with secret -> " + ok.status + " " + (await ok.text()).slice(0, 200));
    const o = await one("select status, payment_status from orders where id=$1", [order.id]);
    const pi = await control("/stripe/pi?id=" + order.stripe_payment_intent_id);
    note(`swept order ${o.status}/${o.payment_status}, intent ${pi.status}`);
    check(pi.status === "canceled", "sweep cancels the intent");
  });

  await scenario("pay: Stripe-side refund (owner refunds in Stripe) updates the order", async () => {
    const { order } = await placeOrder(R);
    const { pi } = await payOrder(order);
    const ch = await control("/stripe/charge?id=" + pi.latest_charge);
    const half = Math.floor(ch.amount / 2);
    const refunded = { ...ch, amount_refunded: half, refunded: false };
    let r = await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("charge.refunded", refunded, { account: order.stripe_connect_account_id }), CONNECT_WHSEC);
    let o = await one("select payment_status, amount_refunded_cents from orders where id=$1", [order.id]);
    check(o.amount_refunded_cents === half, `partial refund recorded: ${o.amount_refunded_cents} vs ${half} (${o.payment_status})`);
    // Same event again (retry) and an older one arriving late.
    await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("charge.refunded", refunded, { account: order.stripe_connect_account_id }), CONNECT_WHSEC);
    await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("charge.refunded", { ...ch, amount_refunded: ch.amount, refunded: true }, { account: order.stripe_connect_account_id }), CONNECT_WHSEC);
    await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("charge.refunded", refunded, { account: order.stripe_connect_account_id }), CONNECT_WHSEC);
    o = await one("select payment_status, amount_refunded_cents from orders where id=$1", [order.id]);
    check(o.amount_refunded_cents === ch.amount && o.payment_status === "refunded", `full refund wins over a late partial: ${o.amount_refunded_cents}/${o.payment_status}`);
    r = await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("charge.dispute.created", { id: "dp_1", object: "dispute", charge: ch.id, payment_intent: pi.id, amount: ch.amount, status: "needs_response", reason: "fraudulent" }, { account: order.stripe_connect_account_id }), CONNECT_WHSEC);
    o = await one("select dispute_status from orders where id=$1", [order.id]);
    note("dispute -> " + r.status + " dispute_status=" + o.dispute_status);
  });

  await scenario("pay: account disconnected / no longer able to charge", async () => {
    const acct = R.stripeAccount;
    await control("/stripe/account", { id: acct, charges_enabled: false });
    const ev = stripeEvent("account.updated", { id: acct, object: "account", charges_enabled: false, controller: { stripe_dashboard: { type: "full" } }, type: "standard" }, { account: acct });
    await stripeWebhook("/api/webhooks/stripe-connect", ev, CONNECT_WHSEC);
    const b = await one("select stripe_connect_charges_enabled from businesses where id=$1", [R.biz.id]);
    check(b.stripe_connect_charges_enabled === false, "charges disabled after account.updated");
    await sleep(21000);
    const k = key();
    await control("/ai/script", orderScript(k));
    const from = caller();
    await runCall({ to: R.number, from, token: R.token, say: standardLines(k) });
    const tr = await control("/ai/toolResults?key=" + encodeURIComponent(k));
    note(tr.map((t) => t.content.slice(0, 100)).join(" | ").slice(0, 400));
    check((await textsTo(from)).length === 0, "no pay link when payments are off");
    await control("/stripe/account", { id: acct, charges_enabled: true });
    await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("account.updated", { id: acct, object: "account", charges_enabled: true, controller: { stripe_dashboard: { type: "full" } }, type: "standard" }, { account: acct }), CONNECT_WHSEC);
    await sleep(21000);
  });

  await scenario("pay: Stripe is down while placing the order", async () => {
    await control("/config", { fail: { stripe: { status: 500, count: 3, match: "/v1/payment_intents" } } });
    const k = key();
    await control("/ai/script", orderScript(k));
    const from = caller();
    const c = await runCall({ to: R.number, from, token: R.token, say: standardLines(k) });
    const tr = await control("/ai/toolResults?key=" + encodeURIComponent(k));
    note(tr.slice(-1).map((t) => t.content.slice(0, 160)).join(""));
    const o = await orderFor(c.callSid);
    note(`order ${o?.status}/${o?.payment_status} texts=${(await textsTo(from)).length}`);
    check(o?.status === "building", "order goes back to building so it can be retried, is " + o?.status);
    await control("/config", { fail: {} });
  });

  await scenario("pay: texting the link fails (carrier rejects)", async () => {
    await control("/config", { fail: { twilio: { status: 400, count: 1, match: "/Messages.json" } } });
    const { order, from, call } = await placeOrder(R);
    await control("/config", { fail: {} });
    note(`order ${order?.status}/${order?.payment_status} sms_status=${order?.payment_link_sms_status} err=${order?.payment_link_sms_error}`);
    const tr = await control("/ai/toolResults");
    note(tr.slice(-1).map((t) => t.content.slice(0, 200)).join(""));
  });
}
