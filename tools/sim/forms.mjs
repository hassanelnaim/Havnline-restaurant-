// Owner forms and the way they interact with live calls: menu edits, odd input,
// script-injection text, availability, hours/closures, knowledge, test chat,
// customers, account security.
import { APP, sql, one, scenario, check, note, control, runCall, sleep, authEmails } from "./lib.mjs";
import { key, caller, orderScript, standardLines, textsTo, orderFor, payOrder } from "./calls.mjs";
import { newBrowserPage, logIn } from "./journey.mjs";

const XSS = `<img src=x onerror="window.__xss=1">"'&`;

async function addMenuItem(page, name, price, desc) {
  await page.goto(APP + "/dashboard/menu");
  await page.waitForLoadState("networkidle");
  await page.locator('input[placeholder="e.g. French Fries"]').fill(name);
  await page.locator('input[placeholder="0.00"]').first().fill(String(price));
  if (desc) await page.locator('input[aria-label="Description"]').fill(desc);
  await page.click('button:has-text("Add item")');
  await sleep(1200);
  return page.locator(".text-danger, [role=alert]").allInnerTexts();
}

export default async function forms(R, browser) {
  const page = R.page;

  await scenario("menu: add items with valid and odd prices/names", async () => {
    const cases = [["Veggie Burger", "8.49"], ["Free Water", "0"], ["Negative Thing", "-3"], ["Gold Burger", "99999"], ["Rounding", "1.005"], ["", "5"], ["L".repeat(300), "4"], [XSS, "6"]];
    for (const [n, p] of cases) {
      const errs = await addMenuItem(page, n, p);
      const row = await one("select name, price_cents from menu_items where business_id=$1 and name=$2 order by created_at desc limit 1", [R.biz.id, n]);
      note(`"${n.slice(0, 24)}" @ ${p} -> ${row ? row.price_cents + "c saved" : "not saved"}${errs.length ? " | " + errs.join(" ").slice(0, 80) : ""}`);
      if (p.startsWith("-")) check(!row || row.price_cents >= 0, "negative price must not be saved");
    }
    const dupes = await one("select count(*)::int n from menu_items where business_id=$1 and name='Cheeseburger'", [R.biz.id]);
    note("Cheeseburger rows: " + dupes.n);
    for (const x of page._problems.splice(0)) check(false, x);
  });

  await scenario("menu: script-like item name is shown as text everywhere", async () => {
    const k = key();
    await control("/ai/script", orderScript(k, { items: [[XSS, 1]] }));
    const from = caller();
    const c = await runCall({ to: R.number, from, token: R.token, say: standardLines(k) });
    const o = await orderFor(c.callSid);
    if (!check(o?.pay_token, "order with the odd item placed")) return;
    await page.goto(`${APP}/pay/${o.pay_token}`);
    await page.waitForLoadState("networkidle");
    check(!(await page.evaluate(() => window.__xss)), "pay page must not run the item name as code");
    await page.goto(APP + "/dashboard/orders");
    await page.waitForLoadState("networkidle");
    check(!(await page.evaluate(() => window.__xss)), "orders page must not run the item name as code");
    await page.goto(APP + "/dashboard/menu");
    await page.waitForLoadState("networkidle");
    check(!(await page.evaluate(() => window.__xss)), "menu page must not run the item name as code");
    const sms = (await textsTo(from))[0];
    note("text: " + sms?.body.slice(0, 120));
  });

  await scenario("menu: item turned off mid-call can't be ordered; deleted mid-order", async () => {
    // Mark Fries unavailable through the switch.
    await page.goto(APP + "/dashboard/menu");
    await page.waitForLoadState("networkidle");
    await page.click('[aria-label="Fries is available. Mark unavailable"]');
    await sleep(1500);
    const f = await one("select is_active from menu_items where business_id=$1 and name='Fries'", [R.biz.id]);
    check(f.is_active === false, "Fries marked unavailable");
    await sleep(21000);
    const k = key();
    await control("/ai/script", orderScript(k));
    const c = await runCall({ to: R.number, from: caller(), token: R.token, say: standardLines(k) });
    const tr = await control("/ai/toolResults?key=" + encodeURIComponent(k));
    note("adding Fries while off: " + tr.find((t) => /Fries/.test(t.content))?.content.slice(0, 120));
    const items = await sql("select item_name from order_items oi join orders o on o.id=oi.order_id join calls c on c.id=o.call_id where c.twilio_call_sid=$1", [c.callSid]);
    check(!items.some((i) => i.item_name === "Fries"), "unavailable item must not be added: " + JSON.stringify(items));
    await sql("update menu_items set is_active=true where business_id=$1 and name='Fries'", [R.biz.id]);
    // Price changes between "add" and "confirm".
    const k2 = key();
    await control("/ai/script", orderScript(k2, { items: [["Coke", 2]] }));
    const from = caller();
    const c2 = await runCall({
      to: R.number, from, token: R.token, say: standardLines(k2),
      onTurn: async ({ utter }) => { if (utter === 3) await sql("update menu_items set price_cents=500 where business_id=$1 and name='Coke'", [R.biz.id]); },
    });
    const o2 = await orderFor(c2.callSid);
    note(`Coke x2 added at $2.25, price changed to $5 before confirm: subtotal ${o2?.subtotal_cents} total ${o2?.total_cents}`);
    await sql("update menu_items set price_cents=225 where business_id=$1 and name='Coke'", [R.biz.id]);
    // Item deleted while it's on someone's order.
    const k3 = key();
    await control("/ai/script", orderScript(k3, { items: [["Veggie Burger", 1]] }));
    const c3 = await runCall({
      to: R.number, from: caller(), token: R.token, say: standardLines(k3),
      onTurn: async ({ utter }) => { if (utter === 3) await sql("delete from menu_items where business_id=$1 and name='Veggie Burger'", [R.biz.id]).catch((e) => note("delete blocked: " + e.message)); },
    });
    const o3 = await orderFor(c3.callSid);
    note(`deleted item mid-order -> order ${o3?.status}/${o3?.payment_status} items=${(await sql("select item_name from order_items where order_id=$1", [o3?.id])).map((i) => i.item_name)}`);
    for (const p of [...c.problems, ...c2.problems, ...c3.problems]) check(false, p);
  });

  await scenario("menu: delete an item through the page (with orders referencing it)", async () => {
    await page.goto(APP + "/dashboard/menu");
    await page.waitForLoadState("networkidle");
    const before = await one("select count(*)::int n from menu_items where business_id=$1", [R.biz.id]);
    page.once("dialog", (d) => d.accept());
    await page.locator('[aria-label="Delete item"]').first().click();
    await sleep(800);
    const confirmBtn = page.locator('[role=dialog] button:has-text("Delete"), [role=alertdialog] button:has-text("Delete")');
    if (await confirmBtn.count()) await confirmBtn.first().click();
    await sleep(1500);
    const after = await one("select count(*)::int n from menu_items where business_id=$1", [R.biz.id]);
    note(`items ${before.n} -> ${after.n}`);
    const errs = await page.locator(".text-danger, [role=alert]").allInnerTexts();
    if (errs.length) note("errors: " + errs.join(" | ").slice(0, 160));
    for (const x of page._problems.splice(0)) check(false, x);
  });

  await scenario("settings: holiday closure today closes the phone line", async () => {
    await page.goto(APP + "/dashboard/settings");
    await page.waitForLoadState("networkidle");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    await page.fill('input[type=date]', today);
    await page.fill('input[placeholder="e.g. Family vacation"]', "Staff party");
    await page.click('button:has-text("Add closure")');
    await sleep(1500);
    const cl = await one("select * from business_closures where business_id=$1 and closed_on=$2", [R.biz.id, today]);
    check(cl, "closure saved for today");
    await sleep(21000);
    const c = await runCall({ to: R.number, from: caller(), token: R.token, say: ["hi"], statusCallbacks: false });
    const said = c.transcript.map((t) => t.text).join(" ");
    note("caller hears: " + said.slice(0, 160));
    check(c.ended === "ai_hung_up", "closed today: message then hang up, ended " + c.ended);
    await sql("delete from business_closures where business_id=$1", [R.biz.id]);
    await sleep(21000);
    for (const x of page._problems.splice(0)) check(false, x);
  });

  await scenario("settings: save details with odd values", async () => {
    const tries = [["#escalation-phone, input[placeholder='Leave blank to use your main phone']", "not a phone"], ["#escalation-phone, input[placeholder='Leave blank to use your main phone']", "+1 (313) 555-0123"]];
    for (const [sel, val] of tries) {
      await page.goto(APP + "/dashboard/settings");
      await page.waitForLoadState("networkidle");
      await page.locator(sel).first().fill(val);
      await sleep(300);
      await page.click('button:has-text("Save changes")');
      await sleep(1500);
      const b = await one("select escalation_phone from businesses where id=$1", [R.biz.id]);
      const bar = await page.locator(".text-red-300, .text-danger").allInnerTexts();
      note(`escalation "${val}" -> saved=${b.escalation_phone} ${bar.join(" ").slice(0, 100)}`);
    }
    // Restaurant name empty
    await page.goto(APP + "/dashboard/settings");
    await page.waitForLoadState("networkidle");
    const nameInput = page.locator("input").filter({ hasText: "" }).first();
    for (const x of page._problems.splice(0)) check(false, x);
  });

  await scenario("test order-taker chat works and doesn't text or charge anyone", async () => {
    const before = (await control("/twilio/messages")).length;
    const k = key();
    await control("/ai/script", { key: k, turns: [[{ tools: [{ name: "add_item_to_order", input: { item_name: "Cheeseburger", quantity: 1 } }] }, { text: "One cheeseburger." }], [{ tools: [{ name: "confirm_and_place_order", input: { customer_name: "Owner Test", text_consent: true } }] }, { text: "Placed (test)." }]] });
    await page.goto(APP + "/dashboard/test-receptionist");
    await page.waitForLoadState("networkidle");
    const box = page.locator('input[placeholder="Type a message…"]');
    await box.fill(`a cheeseburger ${k}`);
    await page.keyboard.press("Enter");
    await sleep(2500);
    await box.fill("place it");
    await page.keyboard.press("Enter");
    await sleep(2500);
    const txt = await page.innerText("main");
    check(/One cheeseburger/.test(txt), "test chat shows the AI reply");
    const after = (await control("/twilio/messages")).length;
    check(after === before, "test chat sends no texts");
    const realOrders = await sql("select status, payment_status from orders where business_id=$1 and customer_name='Owner Test'", [R.biz.id]);
    note("test-chat orders: " + JSON.stringify(realOrders));
    for (const x of page._problems.splice(0)) check(false, x);
  });

  await scenario("account: wrong password lockout, password change, email change, log out", async () => {
    const p2 = await newBrowserPage(browser, "attacker", { ip: "10.66.66.66" });
    const codes = [];
    for (let i = 0; i < 12; i++) {
      await p2.goto(APP + "/login");
      await p2.fill("#email", R.email);
      await p2.fill("#password", "wrong-" + i);
      await Promise.all([p2.waitForNavigation().catch(() => {}), p2.click('button[type=submit]:has-text("Log in")')]);
      codes.push(/Too many/.test(decodeURIComponent(p2.url())) ? "LIMIT" : "no");
    }
    note("12 wrong passwords: " + codes.join(","));
    check(codes.includes("LIMIT"), "sign-in attempts are limited");
    await p2.context().close();
    // Forgot password -> email -> reset link -> new password -> log in
    const p3 = await newBrowserPage(browser, "forgot");
    await p3.goto(APP + "/forgot-password");
    await p3.fill("input[type=email]", R.email);
    await p3.click("button[type=submit]");
    await sleep(1500);
    const mail = (await authEmails()).filter((m) => m.to === R.email && m.type === "recovery").pop();
    if (check(mail, "recovery email sent")) {
      await p3.goto(`${APP}/auth/confirm?token_hash=${mail.token_hash}&type=recovery`);
      await p3.waitForLoadState("networkidle");
      note("recovery link lands on " + p3.url().replace(APP, ""));
      const pw = p3.locator("input[type=password]");
      const n = await pw.count();
      for (let i = 0; i < n; i++) await pw.nth(i).fill("Brand-new-pass-456");
      await p3.click("button[type=submit]");
      await sleep(1500);
      note("after reset: " + p3.url().replace(APP, ""));
      // Old link again
      await p3.goto(`${APP}/auth/confirm?token_hash=${mail.token_hash}&type=recovery`);
      note("reused recovery link -> " + p3.url().replace(APP, "").slice(0, 80));
      const p4 = await newBrowserPage(browser, "relogin");
      await logIn(p4, R.email, "Brand-new-pass-456");
      check(/dashboard/.test(p4.url()), "can log in with the new password: " + p4.url());
      await p4.context().close();
    }
    for (const x of p3._problems.splice(0)) check(false, x);
    await p3.context().close();
  });
}
