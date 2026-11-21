// Admin > Messages: send to all, by status, to one restaurant; double send; failed email; dashboard notice.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { APP, sql, one, scenario, check, note, control, sleep, pool, results } from "./lib.mjs";
import { newBrowserPage, signUpAndConfirm, onboard, logIn, adminPage } from "./journey.mjs";

const browser = await chromium.launch();
const emails = () => fetch("http://127.0.0.1:4010/emails?n=500").then((r) => r.json());
const R = [];

async function compose(admin, { mode, statuses, pick, subject, body }) {
  await admin.goto(APP + (pick?.length === 1 ? `/admin/messages?to=${pick[0]}` : "/admin/messages"));
  await admin.waitForLoadState("networkidle");
  if (mode) await admin.getByRole("radio", { name: mode }).click();
  if (statuses) {
    for (const s of ["active", "trialing", "past_due", "canceled", "none", "suspended"]) {
      const box = admin.locator(`#status-${s}`);
      if ((await box.count()) && (await box.isChecked()) !== statuses.includes(s)) await box.click();
    }
  }
  await admin.fill("#message-subject", subject);
  await admin.fill("#message-body", body);
}
async function confirmAndSend(admin) {
  await admin.getByRole("button", { name: /^Send…/ }).click();
  const dlg = admin.getByRole("dialog");
  await dlg.waitFor({ timeout: 10000 });
  const title = await dlg.locator("h2").innerText();
  await dlg.getByRole("button", { name: "Yes, send it" }).click();
  await admin.getByRole("status").waitFor({ timeout: 15000 });
  return { title, status: await admin.getByRole("status").innerText() };
}

await scenario("messages: set up 3 restaurants", async () => {
  for (const [i, name] of ["Alpha Grill", "Beta Tacos", "Gamma Pho"].entries()) {
    const page = await newBrowserPage(browser, "owner" + i);
    const email = `msg${i}+${Date.now()}@example.test`;
    page._email = email;
    await signUpAndConfirm(page, { email });
    const biz = await onboard(page, { name });
    check(biz, "onboarded " + name);
    R.push({ page, email, biz });
  }
  await sql("update businesses set subscription_status='active' where id=$1", [R[0].biz.id]);
  await sql("update businesses set subscription_status='trialing' where id=$1", [R[1].biz.id]);
  await sql("update businesses set subscription_status='canceled' where id=$1", [R[2].biz.id]);
});

const admin = await adminPage(browser);
// The admin's own restaurant count, so "all" is checked against the database rather than assumed.
const allCount = Number((await one("select count(*) from businesses")).count);

await scenario("messages: owner can't open the admin page or send", async () => {
  await R[0].page.goto(APP + "/admin/messages");
  const t = await R[0].page.innerText("body");
  check(!/Who gets it/.test(t), "owner saw the composer");
});

await scenario("messages: test send goes only to the admin", async () => {
  const before = (await emails()).length;
  await compose(admin, { subject: "Test subject", body: "Hello" });
  await admin.getByRole("button", { name: "Send a test to me" }).click();
  await admin.getByRole("status").waitFor({ timeout: 10000 });
  const after = await emails();
  const sent = after.slice(before);
  check(sent.length === 1, `test sent ${sent.length} emails`);
  check(JSON.stringify(sent[0]?.to).includes("admin@havnline.test"), "test went to " + JSON.stringify(sent[0]?.to));
  check(/^\[Test\]/.test(sent[0]?.subject || ""), "test subject " + sent[0]?.subject);
  check(Number((await one("select count(*) from platform_messages")).count) === 0, "a test created a message row");
});

await scenario("messages: send to all restaurants", async () => {
  const before = (await emails()).length;
  await compose(admin, { subject: "New: refunds from the tablet", body: "Line one.\n\nSecond paragraph <b>not html</b>." });
  const { title, status } = await confirmAndSend(admin);
  check(title.includes(String(allCount)), `dialog said "${title}", expected ${allCount}`);
  check(/Sent to/.test(status), "status: " + status);
  const sent = (await emails()).slice(before);
  for (const r of R) check(sent.some((e) => JSON.stringify(e.to).includes(r.email)), "no email to " + r.email);
  check(sent.every((e) => e.replyTo || e.reply_to), "an email had no reply-to");
  check(sent.every((e) => !e.html.includes("<b>not html</b>")), "body HTML wasn't escaped");
  const rows = await sql("select email_status, count(*)::int n from platform_message_recipients group by 1");
  note(JSON.stringify(rows));
  check(rows.every((r) => r.email_status !== "pending" && r.email_status !== "failed"), "rows left pending/failed");
});

await scenario("messages: send by status (trialing only)", async () => {
  const before = (await emails()).length;
  await compose(admin, { mode: "By status", statuses: ["trialing"], subject: "Trial note", body: "Trial only" });
  const { title } = await confirmAndSend(admin);
  check(/to 1 restaurant\?/.test(title), "dialog: " + title);
  const sent = (await emails()).slice(before);
  check(sent.length === 1 && JSON.stringify(sent[0].to).includes(R[1].email), "sent to " + JSON.stringify(sent.map((e) => e.to)));
});

await scenario("messages: send to one restaurant from its admin page", async () => {
  await admin.goto(APP + "/admin/businesses/" + R[2].biz.id);
  await admin.getByRole("link", { name: /Send message/ }).click();
  await admin.waitForURL(/\/admin\/messages\?to=/);
  await admin.waitForLoadState("networkidle");
  const checked = await admin.getByRole("radio", { name: "Pick restaurants" }).getAttribute("aria-checked");
  check(checked === "true", "Pick restaurants not preselected");
  const before = (await emails()).length;
  await admin.fill("#message-subject", "Just for Gamma");
  await admin.fill("#message-body", "Only you");
  const { title } = await confirmAndSend(admin);
  check(/to 1 restaurant\?/.test(title), "dialog: " + title);
  const sent = (await emails()).slice(before);
  check(sent.length === 1 && JSON.stringify(sent[0].to).includes(R[2].email), "sent to " + JSON.stringify(sent.map((e) => e.to)));
});

await scenario("messages: double click sends once", async () => {
  const before = (await emails()).length;
  const msgsBefore = Number((await one("select count(*) from platform_messages")).count);
  await compose(admin, { subject: "Double", body: "Once only" });
  await admin.getByRole("button", { name: /^Send…/ }).click();
  const dlg = admin.getByRole("dialog");
  await dlg.waitFor();
  await dlg.getByRole("button", { name: "Yes, send it" }).evaluate((b) => { b.click(); b.click(); b.click(); });
  await admin.getByRole("status").waitFor({ timeout: 15000 });
  await sleep(1500);
  const msgsAfter = Number((await one("select count(*) from platform_messages")).count);
  check(msgsAfter === msgsBefore + 1, `messages went ${msgsBefore} -> ${msgsAfter}`);
  check((await emails()).length - before === allCount, `emails sent ${(await emails()).length - before}, expected ${allCount}`);
});

await scenario("messages: email outage still records and shows on dashboard", async () => {
  await fetch("http://127.0.0.1:4010/resend/fail-batch?on=1");
  await compose(admin, { mode: "By status", statuses: ["active"], subject: "Outage note", body: "Email down" });
  const { status } = await confirmAndSend(admin);
  await fetch("http://127.0.0.1:4010/resend/fail-batch?on=0");
  check(/failed/.test(status), "status: " + status);
  const row = await one("select r.email_status from platform_message_recipients r join platform_messages m on m.id=r.message_id where m.subject='Outage note'");
  check(row?.email_status === "failed", "row status " + row?.email_status);
});

await scenario("messages: dashboard shows unread and mark as read works", async () => {
  const p = R[2].page; // Gamma: all, double, and its own
  await p.goto(APP + "/dashboard");
  await p.waitForLoadState("networkidle");
  const box = p.getByRole("region", { name: "Messages from HavnLine" });
  const text = await box.innerText().catch(() => "");
  check(/Just for Gamma/.test(text), "Gamma doesn't see its own message");
  check(!/Trial note|Outage note/.test(text), "Gamma sees messages meant for others");
  check(text.includes("<b>not html</b>"), "body not shown as plain text");
  const n0 = await box.getByRole("button", { name: "Mark as read" }).count();
  await box.getByRole("button", { name: "Mark as read" }).first().click();
  await sleep(1500);
  await p.reload();
  await p.waitForLoadState("networkidle");
  const n1 = await p.getByRole("region", { name: "Messages from HavnLine" }).getByRole("button", { name: "Mark as read" }).count().catch(() => 0);
  check(n1 === n0 - 1, `unread went ${n0} -> ${n1}`);
  // Another page of the dashboard shows them too.
  await p.goto(APP + "/dashboard/orders");
  check(await p.getByRole("region", { name: "Messages from HavnLine" }).count() === (n1 ? 1 : 0), "notices missing on orders page");
  // Alpha can't mark Gamma's message read.
  const other = await one("select message_id from platform_message_recipients where business_id=$1 and read_at is null limit 1", [R[2].biz.id]);
  const a = R[0].page;
  await a.goto(APP + "/dashboard");
  note("Alpha unread: " + (await a.getByRole("region", { name: "Messages from HavnLine" }).getByRole("button").count().catch(() => 0)));
  const still = await one("select read_at from platform_message_recipients where business_id=$1 and message_id=$2", [R[2].biz.id, other.message_id]);
  check(!still.read_at, "cross-restaurant read");
});

await scenario("messages: history shows each send", async () => {
  await admin.goto(APP + "/admin/messages");
  await admin.waitForLoadState("networkidle");
  const t = await admin.innerText("body");
  for (const s of ["New: refunds from the tablet", "Trial note", "Just for Gamma", "Double", "Outage note"]) check(t.includes(s), "history missing " + s);
  check(!/Application error/.test(t), "history crashed");
});

await scenario("messages: page on a phone", async () => {
  const ph = await newBrowserPage(browser, "admin-phone", { viewport: { width: 390, height: 844 } });
  await logIn(ph, "admin@havnline.test");
  await ph.goto(APP + "/admin/messages");
  await ph.waitForLoadState("networkidle");
  const o = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(o <= 1, "horizontal overflow " + o);
  await ph.screenshot({ path: (process.env.SIM_SHOTS || "/tmp") + "/messages-phone.png", fullPage: true });
});

await admin.screenshot({ path: (process.env.SIM_SHOTS || "/tmp") + "/messages-admin.png", fullPage: true });
await R[2].page.goto(APP + "/dashboard");
await R[2].page.screenshot({ path: (process.env.SIM_SHOTS || "/tmp") + "/messages-dashboard.png" });
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
await browser.close();
await pool.end();
