// Fake Stripe, Twilio, Anthropic, ElevenLabs, Resend, Turnstile and ScrapingBee,
// served over HTTPS on 127.0.0.1:443 (the app process is pointed here by hook.cjs).
// Everything is in memory; /__* endpoints let the simulator inspect and steer it.
import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";

const CERT = { key: fs.readFileSync("/home/claude/sim/certs/srv.key"), cert: fs.readFileSync("/home/claude/sim/certs/srv.crt") };
const rid = (p, n = 24) => p + crypto.randomBytes(n).toString("base64url").replace(/[-_]/g, "x").slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- steering ----------
const config = {
  latency: { stripe: 0, twilio: 0, anthropic: 0, elevenlabs: 0, resend: 0, turnstile: 0, scrapingbee: 0 },
  jitter: 0, // +/- fraction of latency
  // fail[service] = { status, prob, count, match } — count: fail next N requests; prob: random share
  fail: {},
};
const log = []; // every request: {service, method, path, status, ms, at}
const counters = {};
function pickLatency(svc) {
  const base = config.latency[svc] || 0;
  if (!base) return 0;
  const j = config.jitter || 0;
  return Math.max(0, Math.round(base * (1 + (Math.random() * 2 - 1) * j)));
}
function shouldFail(svc, path, method) {
  const f = config.fail[svc];
  if (!f) return null;
  if (f.match && !path.includes(f.match)) return null;
  if (f.method && f.method !== method) return null;
  if (typeof f.count === "number") {
    if (f.count <= 0) return null;
    f.count--;
    return f;
  }
  if (typeof f.prob === "number" && Math.random() < f.prob) return f;
  return null;
}

// ---------- body parsing ----------
function parseForm(str) {
  const root = {};
  for (const part of str.split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const key = decodeURIComponent((i < 0 ? part : part.slice(0, i)).replace(/\+/g, " "));
    const val = decodeURIComponent((i < 0 ? "" : part.slice(i + 1)).replace(/\+/g, " "));
    const segs = key.replace(/\]/g, "").split("[");
    let cur = root;
    segs.forEach((seg, j) => {
      if (seg === "") seg = String(Object.keys(cur).length);
      if (j === segs.length - 1) {
        if (cur[seg] === undefined) cur[seg] = val;
        else cur[seg] = [].concat(cur[seg], val);
      } else {
        if (typeof cur[seg] !== "object") cur[seg] = {};
        cur = cur[seg];
      }
    });
  }
  const fix = (o) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return o;
    for (const k of Object.keys(o)) o[k] = fix(o[k]);
    const ks = Object.keys(o);
    return ks.length && ks.every((k, n) => k === String(n)) ? ks.map((k) => o[k]) : o;
  };
  return fix(root);
}
const readBody = (req) =>
  new Promise((resolve) => {
    const c = [];
    req.on("data", (d) => c.push(d));
    req.on("end", () => resolve(Buffer.concat(c).toString()));
  });
function json(res, status, obj, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(obj));
}

// ---------- Stripe ----------
const stripe = {
  invoiceItems: [],
  accounts: new Map(),
  pis: new Map(),
  charges: new Map(),
  refunds: new Map(),
  fees: new Map(),
  sessions: new Map(),
  domains: [],
  subs: new Map(),
  idem: new Map(),
  calls: [],
};
const now = () => Math.floor(Date.now() / 1000);
function stripeErr(res, status, type, message, code, extra = {}) {
  return json(res, status, { error: { type, message, code, ...extra } });
}
function expandPi(pi, expand) {
  const o = { ...pi };
  if ((expand || []).some((e) => e === "latest_charge" || e.startsWith("latest_charge")) && pi.latest_charge) {
    o.latest_charge = { ...stripe.charges.get(pi.latest_charge) };
  }
  return o;
}
export function succeedPi(piId, { amount } = {}) {
  const pi = stripe.pis.get(piId);
  if (!pi) return null;
  if (pi.status === "succeeded") return pi;
  if (pi.status === "canceled") return { error: "canceled" };
  const ch = {
    id: rid("ch_"), object: "charge", amount: amount ?? pi.amount, amount_captured: amount ?? pi.amount, amount_refunded: 0,
    currency: pi.currency, payment_intent: pi.id, paid: true, refunded: false, status: "succeeded", created: now(),
    application_fee: null, application_fee_amount: pi.application_fee_amount || null, metadata: pi.metadata,
    billing_details: { name: "Sim Payer", email: null, phone: null }, payment_method_details: { type: "card", card: { brand: "visa", last4: "4242" } },
  };
  if (pi.application_fee_amount) {
    const fee = { id: rid("fee_"), object: "application_fee", amount: pi.application_fee_amount, amount_refunded: 0, charge: ch.id, account: pi._account };
    stripe.fees.set(fee.id, fee);
    ch.application_fee = fee.id;
  }
  stripe.charges.set(ch.id, ch);
  Object.assign(pi, { status: "succeeded", latest_charge: ch.id, amount_received: ch.amount });
  return pi;
}

async function handleStripe(req, res, url, body) {
  const p = url.pathname;
  const method = req.method;
  const acct = req.headers["stripe-account"] || null;
  const idemKey = req.headers["idempotency-key"];
  const params = method === "GET" ? Object.fromEntries(url.searchParams) : parseForm(body);
  const expand = [].concat(params.expand || [], url.searchParams.getAll("expand[]"));
  stripe.calls.push({ method, path: p, account: acct, params, idemKey, at: Date.now() });
  if (!String(req.headers.authorization || "").includes("sk_test_sim")) return stripeErr(res, 401, "invalid_request_error", "Invalid API Key provided");

  if (idemKey && method === "POST") {
    const k = `${acct}|${idemKey}`;
    const prev = stripe.idem.get(k);
    if (prev) {
      if (prev.path !== p) return stripeErr(res, 400, "idempotency_error", "Keys for idempotent requests can only be used for the same endpoint");
      res.writeHead(prev.status, { "content-type": "application/json", "idempotent-replayed": "true" });
      return res.end(prev.body);
    }
    const origEnd = res.end.bind(res);
    const origHead = res.writeHead.bind(res);
    let st = 200;
    res.writeHead = (s, h) => ((st = s), origHead(s, h));
    res.end = (b) => {
      if (st < 500) stripe.idem.set(k, { path: p, status: st, body: b });
      return origEnd(b);
    };
  }

  let m;
  // Accounts
  if (p === "/v1/accounts" && method === "POST") {
    const a = {
      id: rid("acct_", 16), object: "account", type: params.type || undefined, controller: params.controller || { type: "application" },
      charges_enabled: false, payouts_enabled: false, details_submitted: false, email: params.email, business_profile: params.business_profile || {},
      metadata: params.metadata || {}, capabilities: { card_payments: "inactive", transfers: "inactive" }, requirements: { currently_due: ["external_account"], disabled_reason: "requirements.past_due" },
      created: now(),
    };
    if (a.controller?.stripe_dashboard?.type === "full") a.type = "standard";
    stripe.accounts.set(a.id, a);
    return json(res, 200, a);
  }
  if ((m = p.match(/^\/v1\/accounts\/(acct_\w+)$/)) && method === "GET") {
    const a = stripe.accounts.get(m[1]);
    return a ? json(res, 200, a) : stripeErr(res, 404, "invalid_request_error", `No such account: '${m[1]}'`, "resource_missing");
  }
  if (p === "/v1/account_links" && method === "POST") {
    if (!stripe.accounts.has(params.account)) return stripeErr(res, 400, "invalid_request_error", `No such account: '${params.account}'`, "resource_missing");
    return json(res, 200, { object: "account_link", url: `https://connect.stripe.com/setup/sim/${params.account}`, expires_at: now() + 300 });
  }
  if (p === "/v1/payment_method_domains" && method === "POST") {
    const d = { id: rid("pmd_"), object: "payment_method_domain", domain_name: params.domain_name, enabled: true, account: acct };
    stripe.domains.push(d);
    return json(res, 200, d);
  }
  // PaymentIntents (direct charges: on the connected account)
  if (p === "/v1/payment_intents" && method === "POST") {
    if (!acct) return stripeErr(res, 400, "invalid_request_error", "Direct charge expected a Stripe-Account header (sim check)");
    const a = stripe.accounts.get(acct);
    if (!a) return stripeErr(res, 400, "invalid_request_error", `No such account: '${acct}'`, "resource_missing");
    if (!a.charges_enabled) return stripeErr(res, 400, "invalid_request_error", "Your destination account needs to have at least one of the following capabilities enabled: card_payments", "account_invalid");
    if (a.type === "express" || a.type === "custom") return stripeErr(res, 400, "invalid_request_error", "Direct charges with type=express are not supported for new platforms");
    const amount = Number(params.amount);
    if (!Number.isInteger(amount) || amount < 50) return stripeErr(res, 400, "invalid_request_error", "Amount must be at least $0.50 usd", "amount_too_small", { param: "amount" });
    if (amount > 99999999) return stripeErr(res, 400, "invalid_request_error", "Amount must be no more than $999,999.99", "amount_too_large", { param: "amount" });
    const fee = params.application_fee_amount !== undefined ? Number(params.application_fee_amount) : null;
    if (fee !== null && fee > amount) return stripeErr(res, 400, "invalid_request_error", "The application fee amount must be less than or equal to the amount", "parameter_invalid_integer");
    const pi = {
      id: rid("pi_"), object: "payment_intent", amount, currency: params.currency || "usd", status: "requires_payment_method",
      client_secret: "", application_fee_amount: fee, metadata: params.metadata || {}, description: params.description || null,
      payment_method_types: [].concat(params.payment_method_types || ["card"]), latest_charge: null, created: now(), canceled_at: null, cancellation_reason: null, _account: acct,
    };
    pi.client_secret = `${pi.id}_secret_${crypto.randomBytes(8).toString("hex")}`;
    stripe.pis.set(pi.id, pi);
    return json(res, 200, pi);
  }
  if ((m = p.match(/^\/v1\/payment_intents\/(pi_\w+)$/)) && method === "GET") {
    const pi = stripe.pis.get(m[1]);
    if (!pi || (pi._account && pi._account !== acct)) return stripeErr(res, 404, "invalid_request_error", `No such payment_intent: '${m[1]}'`, "resource_missing");
    return json(res, 200, expandPi(pi, expand));
  }
  if ((m = p.match(/^\/v1\/payment_intents\/(pi_\w+)\/cancel$/)) && method === "POST") {
    const pi = stripe.pis.get(m[1]);
    if (!pi || pi._account !== acct) return stripeErr(res, 404, "invalid_request_error", `No such payment_intent: '${m[1]}'`, "resource_missing");
    if (pi.status === "succeeded" || pi.status === "canceled")
      return stripeErr(res, 400, "invalid_request_error", `You cannot cancel this PaymentIntent because it has a status of ${pi.status}.`, "payment_intent_unexpected_state", { payment_intent: expandPi(pi, []) });
    Object.assign(pi, { status: "canceled", canceled_at: now(), cancellation_reason: params.cancellation_reason || null });
    return json(res, 200, pi);
  }
  // Refunds
  if (p === "/v1/refunds" && method === "POST") {
    const pi = stripe.pis.get(params.payment_intent || "");
    if (!pi || pi._account !== acct) return stripeErr(res, 404, "invalid_request_error", `No such payment_intent: '${params.payment_intent}'`, "resource_missing");
    if (pi.status !== "succeeded") return stripeErr(res, 400, "invalid_request_error", "This PaymentIntent does not have a successful charge to refund.", "charge_not_refundable");
    const ch = stripe.charges.get(pi.latest_charge);
    const left = ch.amount - ch.amount_refunded;
    const amt = params.amount !== undefined ? Number(params.amount) : left;
    if (left <= 0) return stripeErr(res, 400, "invalid_request_error", `Charge ${ch.id} has already been refunded.`, "charge_already_refunded");
    if (amt > left) return stripeErr(res, 400, "invalid_request_error", `Refund amount ($${(amt / 100).toFixed(2)}) is greater than unrefunded amount on charge ($${(left / 100).toFixed(2)})`, "amount_too_large");
    if (amt <= 0) return stripeErr(res, 400, "invalid_request_error", "Invalid positive integer", "parameter_invalid_integer");
    ch.amount_refunded += amt;
    ch.refunded = ch.amount_refunded >= ch.amount;
    if (params.refund_application_fee === "true" && ch.application_fee) {
      const fee = stripe.fees.get(ch.application_fee);
      const share = Math.round((fee.amount * amt) / ch.amount);
      fee.amount_refunded = Math.min(fee.amount, fee.amount_refunded + share);
    }
    const r = { id: rid("re_"), object: "refund", amount: amt, charge: ch.id, payment_intent: pi.id, status: "succeeded", created: now(), metadata: params.metadata || {} };
    stripe.refunds.set(r.id, r);
    return json(res, 200, r);
  }
  if ((m = p.match(/^\/v1\/application_fees\/(fee_\w+)$/)) && method === "GET") {
    const f = stripe.fees.get(m[1]);
    return f ? json(res, 200, f) : stripeErr(res, 404, "invalid_request_error", `No such application fee: '${m[1]}'`, "resource_missing");
  }
  if ((m = p.match(/^\/v1\/application_fees\/(fee_\w+)\/refunds$/)) && method === "POST") {
    const f = stripe.fees.get(m[1]);
    if (!f) return stripeErr(res, 404, "invalid_request_error", `No such application fee: '${m[1]}'`, "resource_missing");
    const amt = params.amount !== undefined ? Number(params.amount) : f.amount - f.amount_refunded;
    if (amt > f.amount - f.amount_refunded) return stripeErr(res, 400, "invalid_request_error", "Refund amount is greater than unrefunded amount on fee", "amount_too_large");
    f.amount_refunded += amt;
    return json(res, 200, { id: rid("fr_"), object: "fee_refund", amount: amt, fee: f.id });
  }
  // Checkout (legacy order links + platform subscription)
  if (p === "/v1/checkout/sessions" && method === "POST") {
    const s = { id: rid("cs_test_"), object: "checkout.session", url: `https://checkout.stripe.com/c/pay/sim`, status: "open", mode: params.mode, metadata: params.metadata || {}, customer: params.customer || null, client_reference_id: params.client_reference_id || null, _account: acct };
    stripe.sessions.set(s.id, s);
    return json(res, 200, s);
  }
  if ((m = p.match(/^\/v1\/checkout\/sessions\/(cs_\w+)\/expire$/)) && method === "POST") {
    const s = stripe.sessions.get(m[1]);
    if (!s) return stripeErr(res, 404, "invalid_request_error", `No such checkout.session: '${m[1]}'`, "resource_missing");
    if (s.status !== "open") return stripeErr(res, 400, "invalid_request_error", `Only Checkout Sessions with a status in ["open"] can be expired.`);
    s.status = "expired";
    return json(res, 200, s);
  }
  if (p === "/v1/invoiceitems" && method === "POST") {
    const item = { id: rid("ii_"), object: "invoiceitem", customer: params.customer, amount: Number(params.amount), currency: params.currency, description: params.description, metadata: params.metadata || {} };
    stripe.invoiceItems.push(item);
    return json(res, 200, item);
  }
  if (p === "/v1/billing_portal/sessions" && method === "POST") return json(res, 200, { id: rid("bps_"), url: "https://billing.stripe.com/p/session/sim" });
  if ((m = p.match(/^\/v1\/customers\/(cus_\w+)$/))) return json(res, 200, { id: m[1], object: "customer", email: "owner@example.test", deleted: false });
  if (p === "/v1/invoices") return json(res, 200, { object: "list", data: [], has_more: false });
  if (p === "/v1/subscriptions") {
    const list = [...stripe.subs.values()].filter((x) => !params.customer || x.customer === params.customer);
    return json(res, 200, { object: "list", data: list, has_more: false });
  }
  if ((m = p.match(/^\/v1\/subscriptions\/(sub_\w+)$/))) {
    const sub = stripe.subs.get(m[1]);
    return sub ? json(res, 200, sub) : stripeErr(res, 404, "invalid_request_error", `No such subscription: '${m[1]}'`, "resource_missing");
  }
  if (p === "/v1/tax/calculations" && method === "POST") {
    const lines = [].concat(params.line_items || []);
    const sub = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
    const tax = Math.round(sub * 0.06);
    return json(res, 200, { id: rid("taxcalc_"), object: "tax.calculation", amount_total: sub + tax, tax_amount_exclusive: tax, tax_amount_inclusive: 0 });
  }
  return stripeErr(res, 404, "invalid_request_error", `Unrecognized request URL (${method}: ${p}) [sim]`);
}

// ---------- Twilio ----------
const twilio = { accounts: new Map(), numbers: [], messages: [], calls: [] };
const TWILIO_MAIN = { sid: "ACsimmain0000000000000000000000000", token: "simmaintoken000000000000000000000" };
twilio.accounts.set(TWILIO_MAIN.sid, { sid: TWILIO_MAIN.sid, auth_token: TWILIO_MAIN.token, friendly_name: "main", status: "active" });
export function addTwilioSubaccount(sid, token) {
  twilio.accounts.set(sid, { sid, auth_token: token, friendly_name: "sim sub", status: "active", owner_account_sid: TWILIO_MAIN.sid });
}
function twilioAuth(req) {
  const h = String(req.headers.authorization || "");
  if (!h.startsWith("Basic ")) return null;
  const [user, pass] = Buffer.from(h.slice(6), "base64").toString().split(":");
  const a = twilio.accounts.get(user);
  if (a && a.auth_token === pass) return a;
  return null;
}
const twErr = (res, status, code, message) => json(res, status, { code, message, more_info: `https://www.twilio.com/docs/errors/${code}`, status });
let numberSeq = 5000000 + Math.floor((Date.now() / 1000) % 900000);
async function handleTwilio(req, res, url, body) {
  const p = url.pathname;
  const params = req.method === "GET" ? Object.fromEntries(url.searchParams) : parseForm(body);
  const who = twilioAuth(req);
  if (!who) return twErr(res, 401, 20003, "Authenticate");
  let m;
  if (p === "/2010-04-01/Accounts.json" && req.method === "POST") {
    const sid = rid("AC", 32), token = crypto.randomBytes(16).toString("hex");
    const a = { sid, auth_token: token, friendly_name: params.FriendlyName, status: "active", owner_account_sid: who.sid, date_created: new Date().toUTCString() };
    twilio.accounts.set(sid, a);
    return json(res, 201, a);
  }
  if ((m = p.match(/^\/2010-04-01\/Accounts\/(AC\w+)\.json$/))) {
    const a = twilio.accounts.get(m[1]);
    if (!a) return twErr(res, 404, 20404, "The requested resource was not found");
    if (req.method === "POST" && params.Status) a.status = params.Status;
    return json(res, 200, a);
  }
  if ((m = p.match(/^\/2010-04-01\/Accounts\/(AC\w+)\/AvailablePhoneNumbers\/US\/Local\.json$/))) {
    const nums = Array.from({ length: 3 }, () => ({ phone_number: `+1313${numberSeq++}`, friendly_name: "(313) sim", locality: "Detroit", region: "MI", capabilities: { voice: true, sms: true } }));
    return json(res, 200, { available_phone_numbers: nums });
  }
  if ((m = p.match(/^\/2010-04-01\/Accounts\/(AC\w+)\/IncomingPhoneNumbers\.json$/))) {
    if (req.method === "POST") {
      const n = { sid: rid("PN", 32), account_sid: m[1], phone_number: params.PhoneNumber, voice_url: params.VoiceUrl, voice_fallback_url: params.VoiceFallbackUrl, sms_url: params.SmsUrl, status_callback: params.StatusCallback };
      twilio.numbers.push(n);
      return json(res, 201, n);
    }
    const list = twilio.numbers.filter((n) => n.account_sid === m[1] && (!params.PhoneNumber || n.phone_number === params.PhoneNumber));
    return json(res, 200, { incoming_phone_numbers: list, next_page_uri: null });
  }
  if ((m = p.match(/^\/2010-04-01\/Accounts\/(AC\w+)\/IncomingPhoneNumbers\/(PN\w+)\.json$/))) {
    const n = twilio.numbers.find((x) => x.sid === m[2]);
    if (!n) return twErr(res, 404, 20404, "The requested resource was not found");
    if (req.method === "DELETE") { twilio.numbers.splice(twilio.numbers.indexOf(n), 1); n.released = true; twilio.released = (twilio.released || []).concat(n); res.writeHead(204); return res.end(); }
    if (req.method === "POST") Object.assign(n, { voice_url: params.VoiceUrl ?? n.voice_url, voice_fallback_url: params.VoiceFallbackUrl ?? n.voice_fallback_url, sms_url: params.SmsUrl ?? n.sms_url, status_callback: params.StatusCallback ?? n.status_callback });
    return json(res, 200, n);
  }
  if ((m = p.match(/^\/2010-04-01\/Accounts\/(AC\w+)\/Messages\.json$/)) && req.method === "POST") {
    if (who.sid !== m[1] && twilio.accounts.get(m[1])?.owner_account_sid !== who.sid) return twErr(res, 403, 20003, "Permission denied");
    if (!params.To || !params.Body) return twErr(res, 400, 21604, "A 'To' phone number is required.");
    if (!/^\+1\d{10}$/.test(params.To)) return twErr(res, 400, 21211, `The 'To' number ${params.To} is not a valid phone number.`);
    if (params.To.endsWith("0000021610")) return twErr(res, 400, 21610, "Attempt to send to unsubscribed recipient");
    if (params.Body.length > 1600) return twErr(res, 400, 21617, "The concatenated message body exceeds the 1600 character limit.");
    const msg = { sid: rid("SM", 32), account_sid: m[1], to: params.To, from: params.From, body: params.Body, status: "queued", status_callback: params.StatusCallback || null, date_created: new Date().toUTCString(), num_segments: String(Math.ceil(params.Body.length / 153)) };
    twilio.messages.push(msg);
    return json(res, 201, msg);
  }
  if ((m = p.match(/^\/2010-04-01\/Accounts\/(AC\w+)\/Calls\/(CA\w+)\.json$/))) {
    twilio.calls.push({ sid: m[2], params });
    return json(res, 200, { sid: m[2], status: params.Status || "in-progress" });
  }
  if ((m = p.match(/^\/2010-04-01\/Accounts\/(AC\w+)\/Balance\.json$/))) return json(res, 200, { account_sid: m[1], balance: "20.00", currency: "USD" });
  return twErr(res, 404, 20404, `The requested resource ${p} was not found [sim]`);
}

// ---------- Anthropic ----------
// Scripted conversations. A script is chosen by a phrase in the first user
// message; turn = which caller utterance this is, step = which model call
// within that turn (after tool results). Stateless, so retries replay safely.
const ai = { scripts: [], requests: 0, toolResults: [], unscripted: 0, byModel: {} };
function textOf(content) {
  if (typeof content === "string") return content;
  return (content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}
const hasToolResult = (m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result");
async function handleAnthropic(req, res, url, body) {
  if (url.pathname !== "/v1/messages") return json(res, 404, { type: "error", error: { type: "not_found_error", message: "sim: " + url.pathname } });
  if (!String(req.headers["x-api-key"] || "").startsWith("sk-ant-sim")) return json(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
  const reqBody = JSON.parse(body);
  if (reqBody.tools) ai.lastSystem = typeof reqBody.system === "string" ? reqBody.system : JSON.stringify(reqBody.system || "");
  ai.requests++;
  ai.byModel[reqBody.model] = (ai.byModel[reqBody.model] || 0) + 1;
  const msgs = reqBody.messages || [];
  const plainUsers = msgs.map((m, i) => ({ m, i })).filter(({ m }) => m.role === "user" && !hasToolResult(m));
  const first = plainUsers[0] ? textOf(plainUsers[0].m.content) : "";
  const lastPlainIdx = plainUsers.length ? plainUsers[plainUsers.length - 1].i : -1;
  const turn = plainUsers.length - 1;
  const step = msgs.slice(lastPlainIdx + 1).filter(hasToolResult).length;
  const last = msgs[msgs.length - 1];
  if (last && hasToolResult(last)) {
    for (const b of last.content.filter((x) => x.type === "tool_result")) ai.toolResults.push({ first: first.slice(0, 80), turn, step, tool_use_id: b.tool_use_id, content: typeof b.content === "string" ? b.content : JSON.stringify(b.content) });
  }
  const script = ai.scripts.find((s) => first.includes(s.key));
  let out;
  if (!script) {
    ai.unscripted++;
    out = { text: reqBody.tools ? "Sure. What else can I get you?" : "{}" };
    // Website import and other non-call prompts get a JSON-ish reply.
    if (!reqBody.tools && /menu|website|extract/i.test(JSON.stringify(reqBody.system || "").slice(0, 2000))) out = { text: JSON.stringify({ categories: [] }) };
  } else {
    const t = script.turns[Math.min(turn, script.turns.length - 1)] || [];
    out = t[step] || t[t.length - 1] || { text: "Okay." };
    script.seen = script.seen || [];
    script.seen.push({ turn, step, user: textOf(plainUsers[plainUsers.length - 1]?.m.content || "").slice(0, 300) });
  }
  const content = [];
  if (out.text) content.push({ type: "text", text: out.text });
  for (const t of out.tools || []) content.push({ type: "tool_use", id: rid("toolu_"), name: t.name, input: t.input || {} });
  return json(res, 200, {
    id: rid("msg_"), type: "message", role: "assistant", model: reqBody.model, content,
    stop_reason: (out.tools || []).length ? "tool_use" : "end_turn", stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 },
  });
}

// ---------- ElevenLabs / Resend / Turnstile / ScrapingBee ----------
const tts = { requests: 0, chars: 0 };
const emails = [];
async function handleEleven(req, res, url, body) {
  if (url.pathname.startsWith("/v1/text-to-speech/")) {
    tts.requests++;
    try { tts.chars += (JSON.parse(body).text || "").length; } catch {}
    res.writeHead(200, { "content-type": "audio/mpeg" });
    return res.end(Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), crypto.randomBytes(1200)]));
  }
  if (url.pathname === "/v1/voices") return json(res, 200, { voices: [
    { voice_id: "sim-voice-1", name: "Sim Sarah", labels: { gender: "female" }, preview_url: "https://example.invalid/p.mp3" },
    { voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", category: "premade", labels: { accent: "american" }, preview_url: "https://example.invalid/sarah.mp3" },
  ] });
  if (url.pathname === "/v1/user") return json(res, 200, { subscription: { character_count: 100, character_limit: 100000 } });
  return json(res, 404, { detail: "sim: " + url.pathname });
}
async function handleResend(req, res, url, body) {
  if (url.pathname === "/emails" && req.method === "POST") {
    const e = JSON.parse(body);
    const rec = { id: rid("em_"), to: e.to, from: e.from, subject: e.subject, at: new Date().toISOString(), html: String(e.html || "").slice(0, 20000), text: e.text };
    emails.push(rec);
    return json(res, 200, { id: rec.id });
  }
  if (url.pathname === "/emails/batch" && req.method === "POST") {
    const list = JSON.parse(body);
    if (!Array.isArray(list) || list.length > 100) return json(res, 422, { name: "validation_error", message: "batch must be 1-100 emails" });
    if (globalThis.__failBatch) return json(res, 500, { name: "application_error", message: "sim batch failure" });
    const data = list.map((e) => {
      const rec = { id: rid("em_"), to: e.to, from: e.from, subject: e.subject, replyTo: e.reply_to, at: new Date().toISOString(), html: String(e.html || "").slice(0, 20000), text: e.text, batch: true };
      emails.push(rec);
      return { id: rec.id };
    });
    return json(res, 200, { data });
  }
  return json(res, 404, { message: "sim: " + url.pathname });
}
async function handleTurnstile(req, res, url, body) {
  const p = new URLSearchParams(body);
  let token = p.get("response");
  if (!token) { try { token = JSON.parse(body).response; } catch {} }
  return json(res, 200, token && token !== "fail" ? { success: true, hostname: "localhost", "error-codes": [] } : { success: false, "error-codes": ["invalid-input-response"] });
}

const services = {
  "api.stripe.com": ["stripe", handleStripe],
  "api.twilio.com": ["twilio", handleTwilio],
  "messaging.twilio.com": ["twilio", handleTwilio],
  "monitor.twilio.com": ["twilio", async (req, res) => json(res, 200, { alerts: [], meta: { next_page_url: null } })],
  "marketplace.twilio.com": ["twilio", async (req, res) => json(res, 200, { installed_add_ons: [], meta: { next_page_url: null } })],
  "api.anthropic.com": ["anthropic", handleAnthropic],
  "api.elevenlabs.io": ["elevenlabs", handleEleven],
  "api.resend.com": ["resend", handleResend],
  "challenges.cloudflare.com": ["turnstile", handleTurnstile],
  "app.scrapingbee.com": ["scrapingbee", async (req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end("<html><body><h1>Sim Diner</h1><p>Burger $9.99</p></body></html>"); }],
};

https
  .createServer(CERT, async (req, res) => {
    const host = String(req.headers.host || "").split(":")[0];
    const url = new URL(req.url, `https://${host}`);
    const svc = services[host];
    const body = await readBody(req);
    const started = Date.now();
    if (!svc) return json(res, 502, { error: "sim: no fake for host " + host });
    const [name, handler] = svc;
    counters[name] = (counters[name] || 0) + 1;
    const lat = pickLatency(name);
    if (lat) await sleep(lat);
    const f = shouldFail(name, url.pathname, req.method);
    if (f) {
      log.push({ service: name, method: req.method, path: url.pathname, status: f.status, ms: Date.now() - started, injected: true, at: started });
      if (f.hang) return; // never answer: exercises the caller's timeout
      return json(res, f.status || 500, name === "anthropic" ? { type: "error", error: { type: f.status === 429 ? "rate_limit_error" : "overloaded_error", message: "sim injected" } } : { error: { message: "sim injected failure", type: "api_error" } });
    }
    const origEnd = res.end.bind(res);
    res.end = (b) => {
      log.push({ service: name, method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started, at: started });
      return origEnd(b);
    };
    try {
      await handler(req, res, url, body);
    } catch (e) {
      console.error("[fakes]", host, url.pathname, e);
      json(res, 500, { error: String(e) });
    }
  })
  .listen(443, "127.0.0.1", () => console.log("fakes on 443"));

// Control plane (plain HTTP, simulator only)
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const body = await readBody(req);
    const p = url.pathname;
    const data = body ? JSON.parse(body) : {};
    if (p === "/config" && req.method === "POST") { Object.assign(config, data); if (data.fail) config.fail = data.fail; return json(res, 200, config); }
    if (p === "/config") return json(res, 200, config);
    if (p === "/log") return json(res, 200, log.slice(-Number(url.searchParams.get("n") || 500)));
    if (p === "/counters") return json(res, 200, { counters, ai: { requests: ai.requests, unscripted: ai.unscripted, byModel: ai.byModel }, tts, emails: emails.length, sms: twilio.messages.length });
    if (p === "/reset") {
      log.length = 0; for (const k in counters) delete counters[k];
      ai.scripts = []; ai.toolResults = []; ai.requests = 0; ai.unscripted = 0; ai.byModel = {};
      twilio.messages.length = 0; emails.length = 0; tts.requests = 0; tts.chars = 0; stripe.calls.length = 0;
      config.fail = {}; for (const k in config.latency) config.latency[k] = 0; config.jitter = 0;
      return json(res, 200, { ok: true });
    }
    // Stripe
    if (p === "/stripe/account" && req.method === "POST") { // create/modify an account directly (e.g. finish onboarding)
      let a = data.id && stripe.accounts.get(data.id);
      if (!a) { a = { id: data.id || rid("acct_", 16), object: "account", created: now(), metadata: {}, capabilities: {}, requirements: { currently_due: [] } }; stripe.accounts.set(a.id, a); }
      Object.assign(a, data);
      return json(res, 200, a);
    }
    if (p === "/stripe/subscription" && req.method === "POST") {
      const prev = stripe.subs.get(data.id) || { object: "subscription", items: { data: [{ id: rid("si_"), current_period_end: now() + 14 * 86400 }] }, cancel_at_period_end: false, metadata: {} };
      const sub = { ...prev, ...data };
      stripe.subs.set(sub.id, sub);
      return json(res, 200, sub);
    }
    if (p === "/stripe/invoice-items") return json(res, 200, stripe.invoiceItems);
    if (p === "/stripe/session") return json(res, 200, [...stripe.sessions.values()].slice(-5));
    if (p === "/stripe/succeed" && req.method === "POST") return json(res, 200, succeedPi(data.pi, data) || { error: "no such pi" });
    if (p === "/stripe/pi") return json(res, 200, stripe.pis.get(url.searchParams.get("id")) || null);
    if (p === "/stripe/charge") return json(res, 200, stripe.charges.get(url.searchParams.get("id")) || null);
    if (p === "/stripe/fee") return json(res, 200, stripe.fees.get(url.searchParams.get("id")) || null);
    if (p === "/stripe/calls") return json(res, 200, stripe.calls.slice(-Number(url.searchParams.get("n") || 200)));
    if (p === "/stripe/state") return json(res, 200, { accounts: [...stripe.accounts.values()], pis: [...stripe.pis.values()].slice(-50), refunds: [...stripe.refunds.values()].slice(-50), domains: stripe.domains });
    // Twilio
    if (p === "/twilio/subaccount" && req.method === "POST") { addTwilioSubaccount(data.sid, data.token); return json(res, 200, { ok: true }); }
    if (p === "/twilio/account") return json(res, 200, twilio.accounts.get(url.searchParams.get("sid")) || null);
    if (p === "/twilio/numbers") return json(res, 200, { active: twilio.numbers, released: twilio.released || [], accounts: [...twilio.accounts.values()].length });
    if (p === "/twilio/messages") return json(res, 200, twilio.messages.slice(-Number(url.searchParams.get("n") || 200)));
    // AI
    if (p === "/ai/script" && req.method === "POST") { ai.scripts = ai.scripts.filter((s) => s.key !== data.key); ai.scripts.push(data); return json(res, 200, { ok: true, n: ai.scripts.length }); }
    if (p === "/ai/scripts") return json(res, 200, ai.scripts);
    if (p === "/ai/last-system") return json(res, 200, { system: ai.lastSystem || "" });
    if (p === "/ai/toolResults") { const k = url.searchParams.get("key"); return json(res, 200, ai.toolResults.filter((t) => !k || t.first.includes(k))); }
    // Email
    if (p === "/resend/fail-batch") { globalThis.__failBatch = url.searchParams.get("on") === "1"; return json(res, 200, { ok: true }); }
    if (p === "/emails") return json(res, 200, emails.slice(-Number(url.searchParams.get("n") || 200)));
    return json(res, 404, { error: "unknown " + p });
  })
  .listen(4010, "127.0.0.1", () => console.log("control on 4010"));
