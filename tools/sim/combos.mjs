// Double clicks and two-tab races on the actions that create things that cost
// money or can't be undone.
import { APP, sql, one, scenario, check, note, control, sleep } from "./lib.mjs";
import { newBrowserPage, signUpAndConfirm, onboard, startTrial, logIn } from "./journey.mjs";

async function burst(page, label, n = 3) {
  // Several clicks before React re-renders: what an impatient double/triple click does.
  await sleep(300);
  const btn = page.locator("button", { hasText: label }).last();
  await btn.waitFor({ timeout: 5000 }).catch(() => {});
  if (!(await btn.isEnabled().catch(() => false))) note(`"${label}" was disabled`);
  await btn.evaluate((el, n) => { for (let i = 0; i < n; i++) el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }, n).catch((e) => note("burst failed: " + e.message.slice(0, 80)));
}

export default async function combos(R, browser) {
  await scenario("double click: onboarding Continue / Save & continue", async () => {
    const page = await newBrowserPage(browser, "dbl");
    const email = `dbl+${Date.now()}@example.test`;
    page._email = email;
    await signUpAndConfirm(page, { email });
    await page.goto(APP + "/onboarding/business-info");
    await page.waitForLoadState("networkidle");
    await page.fill("#businessName", "Double Click Deli");
    await page.fill("#addressCity", "Detroit");
    await page.fill("#addressState", "MI");
    await page.fill("#addressZip", "48201");
    await page.fill("#phone", "(313) 555-0100");
    await page.check('input[name=entityType][value="business"]');
    await page.fill("#legalBusinessName", "Double Click Deli LLC");
    await page.fill("#ein", "38-7654321");
    await burst(page, "Continue", 4);
    await sleep(3000);
    const n = await one("select count(*)::int n from business_members m join auth.users u on u.id=m.user_id where u.email=$1", [email]);
    check(n.n === 1, "one restaurant after 4 fast clicks, got " + n.n);
    // Finish onboarding with a triple click on Save & continue.
    await page.waitForURL(/onboarding\/hours/, { timeout: 10000 }).catch(() => {});
    const cont = () => page.locator('button:has-text("Continue")').last();
    await Promise.all([page.waitForURL(/onboarding\/menu/), cont().click()]);
    await page.locator('input[placeholder="Item name"]').first().fill("Sandwich");
    await page.locator('input[placeholder="Price"]').first().fill("7.00");
    await Promise.all([page.waitForURL(/onboarding\/voice/), cont().click()]);
    await page.waitForLoadState("networkidle");
    await Promise.all([page.waitForURL(/onboarding\/complete/), cont().click()]);
    await page.waitForLoadState("networkidle");
    await burst(page, "Save & continue", 3);
    await sleep(3000);
    const n2 = await one("select count(*)::int n from business_members m join auth.users u on u.id=m.user_id where u.email=$1", [email]);
    const ai = await one("select count(*)::int n from ai_receptionists a join business_members m on m.business_id=a.business_id join auth.users u on u.id=m.user_id where u.email=$1", [email]);
    check(n2.n === 1 && ai.n === 1, `still one restaurant and one AI row: ${n2.n} / ${ai.n}`);
    globalThis.dblPage = page;
  });

  await scenario("double click: Start free trial, Get a number, Connect Stripe", async () => {
    const page = globalThis.dblPage;
    const biz = await one("select b.* from businesses b join business_members m on m.business_id=b.id join auth.users u on u.id=m.user_id where u.email=$1", [page._email]);
    await page.goto(APP + "/onboarding/complete");
    await page.waitForLoadState("networkidle");
    const before = (await control("/stripe/session")).length;
    await burst(page, "Start free trial", 3);
    await sleep(2000);
    const sessions = (await control("/stripe/state")).accounts; // not used
    note("checkout sessions created by 3 clicks: " + ((await fetch("http://127.0.0.1:4010/stripe/calls?n=50").then((r) => r.json())).filter((c) => c.path === "/v1/checkout/sessions" && Date.now() - c.at < 5000).length));
    await startTrial(page, biz).catch(() => {});
    await sql("update businesses set subscription_status='trialing' where id=$1", [biz.id]);
    // Get a number x3, on the live restaurant with its number removed
    const RP = R.page;
    const saved = await one("select metadata from integrations where business_id=$1 and provider='twilio'", [R.biz.id]);
    await sql("delete from integrations where business_id=$1 and provider='twilio'", [R.biz.id]);
    const numsBefore = (await control("/twilio/numbers")).active.length;
    await RP.goto(APP + "/dashboard/integrations");
    await RP.waitForLoadState("networkidle");
    await RP.locator("#area-code-input").pressSequentially("313");
    await burst(RP, "Get a number", 3);
    await sleep(4000);
    const numsAfter = (await control("/twilio/numbers")).active.length;
    note(`numbers bought by 3 fast clicks: ${numsAfter - numsBefore}`);
    check(numsAfter - numsBefore === 1, `one phone number bought, got ${numsAfter - numsBefore} (each extra one is billed monthly)`);
    // Two tabs pressing Get a number at the same moment (a fresh request, not the one above)
    await sql("delete from integrations where business_id=$1 and provider='twilio'", [R.biz.id]);
    await sql("delete from rate_limit_hits where rate_key like 'number_request:%'");
    const p2 = await RP.context().newPage();
    const nb = (await control("/twilio/numbers")).active.length;
    await Promise.all([RP.goto(APP + "/dashboard/integrations"), p2.goto(APP + "/dashboard/integrations")]);
    await Promise.all([RP.waitForLoadState("networkidle"), p2.waitForLoadState("networkidle")]);
    await RP.locator("#area-code-input").pressSequentially("248");
    await p2.locator("#area-code-input").pressSequentially("248");
    await Promise.all([burst(RP, "Get a number", 1), burst(p2, "Get a number", 1)]);
    await sleep(4000);
    const twoTabs = (await control("/twilio/numbers")).active.length - nb;
    note(`two tabs -> numbers bought: ${twoTabs}`);
    check(twoTabs === 1, "two tabs at once should still buy one number, bought " + twoTabs);
    const finalRow = await one("select metadata from integrations where business_id=$1 and provider='twilio'", [R.biz.id]);
    R.number = finalRow.metadata.phone_number;
    R.subSid = finalRow.metadata.subaccount_sid;
    R.token = (await fetch("http://127.0.0.1:4010/twilio/account?sid=" + R.subSid).then((r) => r.json())).auth_token;
    await p2.close();
    // Connect Stripe x3
    await sql("update businesses set stripe_connect_account_id=null where id=$1", [biz.id]);
    const acctBefore = (await control("/stripe/state")).accounts.length;
    await page.goto(APP + "/dashboard/integrations");
    await page.waitForLoadState("networkidle");
    await burst(page, "Connect Stripe", 3);
    await sleep(3000);
    const acctAfter = (await control("/stripe/state")).accounts.length;
    note(`Stripe accounts created by 3 fast clicks: ${acctAfter - acctBefore}`);
    check(acctAfter - acctBefore === 1, `one Stripe account, got ${acctAfter - acctBefore}`);
  });

  await scenario("change number when no new number is available keeps the old one", async () => {
    const page = R.page;
    await sql("delete from rate_limit_hits where rate_key like 'number_request:%'");
    const before = await one("select metadata->>'phone_number' n, status from integrations where business_id=$1 and provider='twilio'", [R.biz.id]);
    await control("/config", { fail: { twilio: { status: 400, count: 1, match: "IncomingPhoneNumbers.json", method: "POST" } } });
    await page.goto(APP + "/dashboard/integrations");
    await page.waitForLoadState("networkidle");
    const change = page.locator('button:has-text("Change number")');
    if (await change.count()) {
      await change.first().click();
      await page.locator("#area-code-input").pressSequentially("212");
      await page.click('button:has-text("Get new number")');
      await sleep(3000);
    }
    await control("/config", { fail: {} });
    const after = await one("select metadata->>'phone_number' n, status from integrations where business_id=$1 and provider='twilio'", [R.biz.id]);
    note(`before ${before.n}/${before.status} -> after ${after?.n}/${after?.status}`);
    const released = (await control("/twilio/numbers")).released.map((n) => n.phone_number);
    check(after?.n === before.n && !released.includes(before.n), "a failed number change must not lose the working number");
  });
}
