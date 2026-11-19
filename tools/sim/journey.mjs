// Owner journey in a real browser: sign up, confirm email, onboarding, every
// dashboard page. Collects console errors, failed requests and 5xx responses.
import { createRequire } from "node:module";
import { APP, authEmails, sql, one, scenario, check, note, results, control, stripeEvent, stripeWebhook, PLATFORM_WHSEC, CONNECT_WHSEC, sleep } from "./lib.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

export async function newBrowserPage(browser, label, { ip, viewport = { width: 1280, height: 900 } } = {}) {
  // Each browser is its own visitor network (Vercel sets x-real-ip from the real connection).
  ip = ip || `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const ctx = await browser.newContext({ viewport, extraHTTPHeaders: { "x-real-ip": ip } });
  // A returning visitor who already chose "Decline" (the banner itself is tested separately).
  await ctx.addInitScript(() => { try { localStorage.setItem("havnline_cookie_consent", "declined"); } catch {} });
  const page = await ctx.newPage();
  page._problems = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource: net::ERR_(NAME_NOT_RESOLVED|FAILED)|the server responded with a status of 404|tawk|stripe\.com|cloudflare|ERR_BLOCKED|Content Security Policy|fonts\.g/i.test(m.text())) page._problems.push(`[${label}] console: ${m.text().slice(0, 200)} @ ${page.url()}`);
  });
  page.on("pageerror", (e) => /Failed to load Stripe\.js/.test(e.message) || page._problems.push(`[${label}] page error: ${e.message.slice(0, 200)} @ ${page.url()}`));
  page.on("response", (r) => {
    if (r.status() >= 500 && r.url().startsWith(APP)) page._problems.push(`[${label}] HTTP ${r.status()} ${r.request().method()} ${r.url().replace(APP, "")}`);
  });
  // No real third-party scripts in the sim.
  await ctx.route(/^(?!http:\/\/(localhost:3000|127\.0\.0\.1:54321)).*/, (route) => route.abort());
  return page;
}
const flush = (page) => {
  const p = page._problems.splice(0);
  for (const x of p) check(false, x);
  return p;
};

export async function dismissCookies(page) {
  const d = page.locator('[aria-labelledby="cookie-consent-title"] button:has-text("Decline")');
  if (await d.count()) await d.first().click();
}
export async function signUpAndConfirm(page, { email, password = "Sim-password-123", fullName = "Sim Owner" }) {
  await page.goto(APP + "/signup");
  await dismissCookies(page);
  await page.fill("#fullName", fullName);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.check("#acceptTerms");
  await Promise.all([page.waitForURL((u) => u.pathname !== "/signup" || u.search.includes("error"), { timeout: 20000 }), page.click('button[type=submit]:has-text("Create account")')]);
  const after = page.url();
  const mails = (await authEmails()).filter((m) => m.to === email.toLowerCase() && m.type === "signup");
  check(mails.length === 1, `signup should send exactly 1 confirmation email, sent ${mails.length} (landed on ${after})`);
  if (!mails.length) return false;
  await page.goto(`${APP}/auth/confirm?token_hash=${mails[mails.length - 1].token_hash}&type=signup`);
  await page.waitForLoadState("networkidle");
  return true;
}

export async function logIn(page, email, password = "Sim-password-123") {
  await page.goto(APP + "/login");
  await dismissCookies(page);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForNavigation().catch(() => {}), page.click('button[type=submit]:has-text("Log in")')]);
  await page.waitForLoadState("networkidle");
}

export async function onboard(page, { name = "Sim Diner", ein = "38-1234567", menu = [["Cheeseburger", "9.99", "Burgers"], ["Fries", "3.50", "Sides"], ["Coke", "2.25", "Drinks"]] } = {}) {
  const cont = () => page.locator('button:has-text("Continue")').last();
  await page.goto(APP + "/onboarding/business-info");
  await page.fill("#businessName", name);
  await page.selectOption("#businessType", { index: 1 });
  await page.fill("#address", "100 Main St");
  await page.fill("#addressCity", "Detroit");
  await page.fill("#addressState", "MI");
  await page.fill("#addressZip", "48201");
  await page.fill("#phone", "(313) 555-0199");
  await page.check('input[name=entityType][value="business"]');
  await page.fill("#legalBusinessName", name + " LLC");
  if (ein !== null) await page.fill("#ein", ein);
  await page.selectOption("#timezone", "America/New_York");
  await page.fill("#description", "Burgers and fries.");
  check(await cont().isEnabled(), "business-info Continue should be enabled with every field filled");
  await Promise.all([page.waitForURL(/onboarding\/hours/, { timeout: 15000 }).catch(() => {}), cont().click()]);
  const err1 = await page.locator(".text-danger").allInnerTexts();
  if (!check(page.url().includes("/onboarding/hours"), `business-info did not move on: ${page.url()} ${err1.join(" | ")}`)) return null;
  await Promise.all([page.waitForURL(/onboarding\/menu/), cont().click()]);
  for (let i = 0; i < menu.length; i++) {
    if (i > 0) await page.click('button:has-text("Add another item")');
    const row = (ph) => page.locator(`input[placeholder="${ph}"]`).nth(i);
    await row("Item name").fill(menu[i][0]);
    await row("Price").fill(menu[i][1]);
    await row("Category").fill(menu[i][2]);
  }
  await Promise.all([page.waitForURL(/onboarding\/voice/), cont().click()]);
  await page.waitForLoadState("networkidle");
  await Promise.all([page.waitForURL(/onboarding\/complete/), cont().click()]);
  await page.click('button:has-text("Save & continue")');
  await page.waitForSelector('button:has-text("Start free trial"), .text-danger', { timeout: 20000 });
  const err2 = await page.locator(".text-danger").allInnerTexts();
  check(err2.length === 0, "complete step error: " + err2.join(" | "));
  const biz = await one("select b.* from businesses b join business_members m on m.business_id=b.id join auth.users u on u.id=m.user_id where u.email=$1", [page._email]);
  return biz;
}

export async function startTrial(page, biz) {
  await page.click('button:has-text("Start free trial")');
  await sleep(1500);
  const sessions = await control("/stripe/session");
  const cs = sessions.reverse().find((x) => x.mode === "subscription");
  if (!check(cs, "Start free trial should create a subscription Checkout session")) return;
  const subId = "sub_sim" + biz.id.replace(/-/g, "").slice(0, 16);
  const cus = "cus_sim" + biz.id.replace(/-/g, "").slice(0, 12);
  const sub = await control("/stripe/subscription", { id: subId, customer: cus, status: "trialing", metadata: { business_id: biz.id } });
  let r = await stripeWebhook("/api/webhooks/stripe", stripeEvent("checkout.session.completed", { ...cs, status: "complete", customer: cus, subscription: subId, client_reference_id: cs.client_reference_id || biz.id }), PLATFORM_WHSEC);
  check(r.status === 200, "checkout.session.completed webhook -> " + r.status + " " + r.text.slice(0, 100));
  r = await stripeWebhook("/api/webhooks/stripe", stripeEvent("customer.subscription.created", sub), PLATFORM_WHSEC);
  check(r.status === 200, "customer.subscription.created webhook -> " + r.status + " " + r.text.slice(0, 100));
  const b = await one("select subscription_status from businesses where id=$1", [biz.id]);
  check(b.subscription_status === "trialing", "subscription_status should be trialing, is " + b.subscription_status);
}

export async function getNumber(page, areaCode = "313", label = "Get a number") {
  await page.goto(APP + "/dashboard/integrations");
  await page.waitForLoadState("networkidle");
  await page.locator("#area-code-input").pressSequentially(areaCode);
  const btn = page.locator(`button:has-text("${label}")`).last();
  await btn.click({ timeout: 5000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Getting number"), null, { timeout: 20000 }).catch(() => {});
  await sleep(500);
}

export async function connectStripe(page, biz) {
  await page.goto(APP + "/dashboard/integrations");
  await page.waitForLoadState("networkidle");
  await page.click('button:has-text("Connect Stripe")');
  await sleep(2000);
  const b = await one("select stripe_connect_account_id from businesses where id=$1", [biz.id]);
  if (!check(b.stripe_connect_account_id, "Connect Stripe should create and save a connected account")) return null;
  const acct = await control("/stripe/account", { id: b.stripe_connect_account_id, charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [], disabled_reason: null } });
  check(acct.controller?.stripe_dashboard?.type === "full", "new account should be a full-dashboard account, controller=" + JSON.stringify(acct.controller));
  const r = await stripeWebhook("/api/webhooks/stripe-connect", stripeEvent("account.updated", acct, { account: acct.id }), CONNECT_WHSEC);
  check(r.status === 200, "account.updated webhook -> " + r.status);
  const after = await one("select stripe_connect_charges_enabled from businesses where id=$1", [biz.id]);
  check(after.stripe_connect_charges_enabled === true, "charges should be enabled after account.updated");
  return acct.id;
}

export async function approveTexting(adminPage, biz) {
  await adminPage.goto(APP + "/admin/businesses/" + biz.id);
  await adminPage.waitForLoadState("networkidle");
  await adminPage.reload();
  await adminPage.waitForLoadState("networkidle");
  const btn = adminPage.locator('button:has-text("Mark texting approved")');
  if (!check(await btn.count(), "admin page should show Mark texting approved")) return;
  await btn.click();
  await adminPage.waitForSelector('button:has-text("Mark as not approved")', { timeout: 10000 }).catch(() => {});
}

export async function turnAiOn(page) {
  await page.goto(APP + "/dashboard");
  const sw = page.locator('[aria-label="AI order-taker is off. Turn it on"]').first();
  if (await sw.count()) {
    await sw.click();
    await page.waitForSelector('[aria-label="AI order-taker is on. Turn it off"]', { timeout: 10000 }).catch(() => {});
  }
  await sleep(1500);
  const errs = await page.locator(".text-danger").allInnerTexts();
  return errs;
}

/** Full owner path to a restaurant that answers calls. Returns what the call simulations need. */
export async function createLiveRestaurant(browser, { name = "Sim Diner", texting = true, label = "owner" } = {}) {
  const page = await newBrowserPage(browser, label);
  const email = `${label}+${Date.now()}${Math.floor(Math.random() * 1000)}@example.test`;
  page._email = email;
  await signUpAndConfirm(page, { email });
  const biz0 = await onboard(page, { name });
  if (!biz0) throw new Error("onboarding failed");
  await startTrial(page, biz0);
  await getNumber(page);
  const acct = await connectStripe(page, biz0);
  if (texting) {
    const admin = await adminPage(browser);
    await approveTexting(admin, biz0);
    await admin.context().close();
  }
  await turnAiOn(page);
  const biz = await one("select * from businesses where id=$1", [biz0.id]);
  const integ = await one("select metadata from integrations where business_id=$1 and provider='twilio'", [biz.id]);
  const sub = await fetch("http://127.0.0.1:4010/twilio/numbers").then((r) => r.json());
  const acctRow = (await fetch("http://127.0.0.1:4010/stripe/state").then((r) => r.json())).accounts;
  const token = await subaccountToken(integ.metadata.subaccount_sid);
  return { page, email, biz, number: integ.metadata.phone_number, subSid: integ.metadata.subaccount_sid, token, stripeAccount: acct };
}
async function subaccountToken(sid) {
  // The fake Twilio knows the token it issued; same as the restaurant's real subaccount token.
  const r = await fetch("http://127.0.0.1:4010/twilio/account?sid=" + sid).then((x) => x.json());
  return r.auth_token;
}
export async function adminPage(browser) {
  const admin = await newBrowserPage(browser, "admin");
  const adminEmail = "admin@havnline.test";
  if (!(await one("select id from auth.users where email=$1", [adminEmail]))) await signUpAndConfirm(admin, { email: adminEmail });
  else await logIn(admin, adminEmail);
  return admin;
}

export async function describeForm(page) {
  return page.$$eval("form input:not([type=hidden]), form select, form textarea, button", (es) =>
    es.filter((e) => e.offsetParent !== null).map((e) => `${e.tagName.toLowerCase()}[${e.type || ""}] name=${e.name || ""} id=${e.id || ""} ${e.tagName === "BUTTON" ? '"' + e.innerText.trim().slice(0, 40) + '"' : e.placeholder ? "ph=" + e.placeholder : ""}`)
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const browser = await chromium.launch();
  const page = await newBrowserPage(browser, "owner");
  const email = `owner+${Date.now()}@example.test`;
  page._email = email;
  await scenario("sign up and confirm email", async () => {
    await signUpAndConfirm(page, { email });
    note("landed on " + page.url());
    flush(page);
  });
  await scenario("onboarding: all steps", async () => {
    const biz = await onboard(page);
    check(biz, "business row exists after onboarding");
    if (biz) note(`business ${biz.id} status=${biz.subscription_status} ein=${String(biz.ein).slice(0, 12)}`);
    const items = biz ? await sql("select name, price_cents from menu_items where business_id=$1", [biz.id]) : [];
    check(items.length === 3, "3 menu items saved, got " + items.length);
    flush(page);
  });
  const biz = await one("select b.* from businesses b join business_members m on m.business_id=b.id join auth.users u on u.id=m.user_id where u.email=$1", [email]);
  await scenario("go live: trial, number, Stripe, texting, AI on", async () => {
    await startTrial(page, biz);
    await getNumber(page);
    const integ = await one("select metadata from integrations where business_id=$1 and provider='twilio'", [biz.id]);
    check(integ?.metadata?.phone_number, "a phone number should be saved");
    note("number " + integ?.metadata?.phone_number + " token sealed=" + String(integ?.metadata?.subaccount_auth_token).startsWith("enc:"));
    await connectStripe(page, biz);
    const admin = await newBrowserPage(browser, "admin");
    const adminEmail = "admin@havnline.test";
    if (!(await one("select id from auth.users where email=$1", [adminEmail]))) await signUpAndConfirm(admin, { email: adminEmail });
    else await logIn(admin, adminEmail);
    await approveTexting(admin, biz);
    const sms = await one("select status from integrations where business_id=$1 and provider='twilio_sms'", [biz.id]).catch(() => null);
    note("texting integration: " + JSON.stringify(sms));
    const errs = await turnAiOn(page);
    check(errs.length === 0, "AI toggle errors: " + errs.join(" | "));
    const ai = await one("select status from ai_receptionists where business_id=$1", [biz.id]);
    check(ai?.status === "online", "AI should be online, is " + ai?.status);
    flush(page); flush(admin);
  });
  await browser.close();
  process.exit(0);
}
