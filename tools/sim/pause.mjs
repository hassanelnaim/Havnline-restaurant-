// Admin > Pause AI: scheduled and immediate pauses, forwarding calls, resume one / all, cancel, dashboard lock.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { APP, sql, one, scenario, check, note, sleep, pool, results, runCall } from "./lib.mjs";
import { newBrowserPage, signUpAndConfirm, onboard, adminPage, createLiveRestaurant, logIn } from "./journey.mjs";

const SHOTS = process.env.SIM_SHOTS || "/tmp";
const browser = await chromium.launch();
const emails = () => fetch("http://127.0.0.1:4010/emails?n=500").then((r) => r.json());
const caller = () => "+1248" + String(Math.floor(1e6 + Math.random() * 8.9e6));
async function openAllDay(bizId) {
  await sql("delete from business_hours where business_id=$1", [bizId]);
  for (const d of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
    await sql("insert into business_hours(business_id, weekday, is_open, open_time, close_time) values ($1,$2,true,'00:00','23:59')", [bizId, d]);
}

let A; // live restaurant that takes calls
const others = [];
const call = (from = caller()) => runCall({ to: A.number, from, token: A.token, say: [] });
const dialed = (c) => c.transcript.find((t) => t.who === "system" && t.text.startsWith("DIAL"));
const aiAnswered = (c) => !dialed(c) && c.ended === "caller_hung_up" && c.problems.length === 0;

async function banner(page) {
  await page.goto(APP + "/dashboard");
  await page.waitForLoadState("networkidle");
  const paused = await page.getByRole("region", { name: "AI paused by HavnLine" }).innerText().catch(() => null);
  const upcoming = await page.getByRole("region", { name: "Upcoming AI pause" }).innerText().catch(() => null);
  return { paused, upcoming };
}
async function openComposer(admin, path = "/admin/pause") {
  await admin.goto(APP + path);
  await admin.waitForLoadState("networkidle");
}
async function confirmPause(admin, { triple = false } = {}) {
  await admin.getByRole("button", { name: /^Pause…/ }).click();
  const dlg = admin.getByRole("dialog");
  await dlg.waitFor({ timeout: 10000 });
  const title = await dlg.locator("h2").innerText();
  const btn = dlg.getByRole("button", { name: "Yes, pause" });
  if (triple) await btn.evaluate((b) => { b.click(); b.click(); b.click(); });
  else await btn.click();
  await admin.getByRole("status").waitFor({ timeout: 15000 });
  return { title, status: await admin.getByRole("status").innerText() };
}

await scenario("pause: set up restaurants", async () => {
  A = await createLiveRestaurant(browser, { name: "Alpha Grill", label: "alpha" });
  await openAllDay(A.biz.id);
  for (const [i, name] of ["Beta Tacos", "Gamma Pho"].entries()) {
    const page = await newBrowserPage(browser, "owner" + i);
    const email = `pause${i}+${Date.now()}@example.test`;
    page._email = email;
    await signUpAndConfirm(page, { email });
    const biz = await onboard(page, { name });
    check(biz, "onboarded " + name);
    others.push({ page, email, biz });
  }
  await sql("update businesses set subscription_status='active' where id=$1", [A.biz.id]);
  await sql("update businesses set subscription_status='trialing' where id=$1", [others[0].biz.id]);
  await sql("update businesses set subscription_status='canceled' where id=$1", [others[1].biz.id]);
  const c = await call();
  check(aiAnswered(c), "AI didn't answer before any pause: " + JSON.stringify({ ended: c.ended, problems: c.problems, d: dialed(c) }));
});

const admin = await adminPage(browser);
const allCount = Number((await one("select count(*) from businesses")).count);

await scenario("pause: owner can't open the page", async () => {
  await A.page.goto(APP + "/admin/pause");
  check(!/Which restaurants/.test(await A.page.innerText("body")), "owner saw the pause composer");
});

await scenario("pause: schedule one restaurant from its admin page, with a message", async () => {
  await admin.goto(APP + "/admin/businesses/" + A.biz.id);
  await admin.locator(`a[href="/admin/pause?to=${A.biz.id}"]`).click();
  await admin.waitForURL(/\/admin\/pause\?to=/);
  await admin.waitForLoadState("networkidle");
  check((await admin.getByRole("radio", { name: "Pick restaurants" }).getAttribute("aria-checked")) === "true", "restaurant not preselected");
  const subj = await admin.inputValue("#pause-subject");
  const body = await admin.inputValue("#pause-body");
  check(/pause for an update on/.test(subj), "subject not prefilled: " + subj);
  check(/ring your restaurant's phone/.test(body), "body not prefilled");
  const before = (await emails()).length;
  const { title, status } = await confirmPause(admin);
  check(/for 1 restaurant\?/.test(title), "dialog: " + title);
  check(/Scheduled a pause for 1 restaurant/.test(status) && /Message sent/.test(status), "status: " + status);
  const sent = (await emails()).slice(before);
  check(sent.length === 1 && JSON.stringify(sent[0].to).includes(A.email), "message went to " + JSON.stringify(sent.map((e) => e.to)));
  const p = await one("select * from ai_pauses order by created_at desc limit 1");
  check(p && p.message_id, "pause not linked to its message");
  check(p && new Date(p.starts_at) > new Date(), "start not in the future");
  check(p && p.ends_at && new Date(p.ends_at) - new Date(p.starts_at) === 2 * 3600e3, "end isn't start + 2h");
  globalThis.p1 = p;
  const b = await banner(A.page);
  check(b.upcoming && /Planned update/.test(b.upcoming), "no upcoming banner: " + JSON.stringify(b));
  check(!b.paused, "shows paused before it starts");
  const c = await call();
  check(aiAnswered(c), "AI didn't answer before the scheduled start");
});

await scenario("pause: when the start time comes, calls ring the restaurant", async () => {
  await sql("update ai_pauses set starts_at=now()-interval '1 minute' where id=$1", [globalThis.p1.id]);
  const c = await call();
  const d = dialed(c);
  check(d && d.text.includes("+13135550199"), "didn't dial the restaurant: " + JSON.stringify(c.transcript));
  check(c.transcript.some((t) => /connect you to the restaurant/.test(t.text)), "no hold line");
  check(c.transcript.some((t) => /no one is available/.test(t.text)), "no-answer leg didn't apologise");
  check(c.problems.length === 0, "problems: " + c.problems.join("; "));
  check(Number((await one("select count(*) from calls where twilio_call_sid=$1", [c.callSid])).count) === 0, "paused call ran the AI");
  const b = await banner(A.page);
  check(b.paused && /paused your AI order-taker/.test(b.paused), "no paused banner");
  const sw = A.page.getByRole("switch", { name: /paused by HavnLine/ }).first();
  check(await sw.isDisabled().catch(() => false), "toggle not locked");
  await admin.goto(APP + "/admin/businesses/" + A.biz.id);
  check(/AI paused until/.test(await admin.innerText("body")), "admin page doesn't show paused");
  const ai = await one("select status from ai_receptionists where business_id=$1", [A.biz.id]);
  check(ai.status === "online", "pause changed the restaurant's own setting: " + ai.status);
});

await scenario("pause: the restaurant's own phone calling in isn't forwarded to itself", async () => {
  const c = await call("+13135550199");
  check(!dialed(c), "dialed the restaurant from itself");
  check(c.transcript.some((t) => /try again a little later/.test(t.text)), "no short-update line: " + JSON.stringify(c.transcript));
});

await scenario("pause: when the end time comes, the AI answers again", async () => {
  await sql("update ai_pauses set starts_at=now()-interval '3 hours', ends_at=now()-interval '1 minute' where id=$1", [globalThis.p1.id]);
  const c = await call();
  check(aiAnswered(c), "AI didn't come back: " + JSON.stringify({ ended: c.ended, d: dialed(c) }));
  const b = await banner(A.page);
  check(!b.paused && !b.upcoming, "banner still showing");
  check(await A.page.getByRole("switch", { name: /AI order-taker is on/ }).first().isEnabled(), "toggle still locked");
});

await scenario("pause: all restaurants now, until resumed, no message", async () => {
  await openComposer(admin);
  await admin.getByRole("radio", { name: "Now" }).click();
  await admin.getByRole("radio", { name: "Resume by hand" }).click();
  await admin.uncheck("#pause-send-message");
  const before = (await emails()).length;
  const { title, status } = await confirmPause(admin, { triple: true });
  check(title.includes(`for ${allCount} restaurants`), `dialog "${title}" expected ${allCount}`);
  check(/Paused the AI for/.test(status), "status: " + status);
  await sleep(1000);
  check((await emails()).length === before, "emailed with the message unticked");
  check(Number((await one("select count(*) from ai_pauses where ends_at is null and cancelled_at is null")).count) === 1, "triple click made more than one pause");
  check(!aiAnswered(await call()), "Alpha still answered");
  check((await banner(others[0].page)).paused, "Beta has no paused banner");
});

await scenario("pause: resume one restaurant, then everyone", async () => {
  await openComposer(admin);
  const row = admin.locator("li[data-pause-id]").filter({ hasText: "Paused now" }).first();
  await row.getByRole("button", { name: "Show restaurants" }).click();
  await row.locator("li").filter({ hasText: "Alpha Grill" }).getByRole("button", { name: "Resume" }).click();
  await sleep(1500);
  check(aiAnswered(await call()), "Alpha not back after Resume");
  check((await banner(others[0].page)).paused, "Beta resumed too");
  await openComposer(admin);
  await admin.locator("li[data-pause-id]").filter({ hasText: "Paused now" }).first().getByRole("button", { name: "Resume all now" }).click();
  await sleep(1500);
  check(!(await banner(others[0].page)).paused, "Beta still paused after Resume all");
  await openComposer(admin);
  check(!(await admin.locator("li[data-pause-id]").filter({ hasText: "Paused now" }).count()), "list still shows a live pause");
});

await scenario("pause: cancel a scheduled pause for a status group", async () => {
  await openComposer(admin);
  await admin.getByRole("radio", { name: "By status" }).click();
  for (const s of ["active", "trialing", "past_due", "canceled", "none", "suspended"]) {
    const box = admin.locator(`#status-${s}`);
    if ((await box.isChecked()) !== (s === "trialing")) await box.click();
  }
  await admin.uncheck("#pause-send-message");
  const { title } = await confirmPause(admin);
  check(/for 1 restaurant\?/.test(title), "dialog: " + title);
  check((await banner(others[0].page)).upcoming, "Beta has no upcoming banner");
  check(!(await banner(A.page)).upcoming, "Alpha got a pause meant for trialing");
  await openComposer(admin);
  await admin.locator("li[data-pause-id]").filter({ hasText: "Scheduled" }).first().getByRole("button", { name: "Cancel pause" }).click();
  await sleep(1500);
  check(!(await banner(others[0].page)).upcoming, "still upcoming after cancel");
  await openComposer(admin);
  check(/Cancelled/.test(await admin.innerText("body")), "list doesn't show Cancelled");
});

await scenario("pause: bad times are refused", async () => {
  await openComposer(admin);
  const start = await admin.inputValue("#pause-start");
  await admin.fill("#pause-end", start);
  check(/end has to be after the start/.test(await admin.innerText("body")), "no error for end = start");
  check(await admin.getByRole("button", { name: /^Pause…/ }).isDisabled(), "Pause… enabled with bad times");
  await admin.fill("#pause-start", "2020-01-01T02:00");
  check(/start time is in the past/.test(await admin.innerText("body")), "no error for past start");
});

await scenario("pause: messages page still works after the picker was shared", async () => {
  await admin.goto(APP + "/admin/messages");
  await admin.waitForLoadState("networkidle");
  await admin.getByRole("radio", { name: "By status" }).click();
  check(await admin.locator("#status-trialing").count(), "status boxes missing on Messages");
  check(/will get this/.test(await admin.innerText("body")), "count line missing on Messages");
});

await scenario("pause: page on a phone", async () => {
  const ph = await newBrowserPage(browser, "admin-phone", { viewport: { width: 390, height: 844 } });
  await logIn(ph, "admin@havnline.test");
  await ph.goto(APP + "/admin/pause");
  await ph.waitForLoadState("networkidle");
  const o = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(o <= 1, "horizontal overflow " + o);
  await ph.screenshot({ path: SHOTS + "/pause-phone.png", fullPage: true });
});

// Screenshots: an active pause on Alpha for the dashboard picture.
await openComposer(admin, `/admin/pause?to=${A.biz.id}`);
await admin.getByRole("radio", { name: "Now" }).click();
await admin.uncheck("#pause-send-message");
await confirmPause(admin);
await openComposer(admin);
await admin.screenshot({ path: SHOTS + "/pause-admin.png", fullPage: true });
await A.page.goto(APP + "/dashboard");
await A.page.waitForLoadState("networkidle");
await A.page.screenshot({ path: SHOTS + "/pause-dashboard.png" });

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
await browser.close();
await pool.end();
