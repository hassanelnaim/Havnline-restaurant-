// Every dashboard and admin page: loads cleanly (no 5xx, console errors, crashes),
// fits a phone screen, and every non-destructive button can be pressed.
import { APP, sql, one, scenario, check, note, control, sleep } from "./lib.mjs";
import { newBrowserPage, logIn, adminPage } from "./journey.mjs";

const OWNER_PAGES = ["/dashboard", "/dashboard/orders", "/dashboard/menu", "/dashboard/customers", "/dashboard/escalations", "/dashboard/ai-employee", "/dashboard/knowledge", "/dashboard/test-receptionist", "/dashboard/integrations", "/dashboard/billing", "/dashboard/settings", "/dashboard/end-of-day"];
const PUBLIC_PAGES = ["/", "/login", "/signup", "/forgot-password", "/reset-password", "/terms", "/privacy", "/policies", "/sms-terms", "/review", "/order-confirmation", "/order-addendum-confirmation", "/does-not-exist"];
const ADMIN_PAGES = ["/admin", "/admin/businesses", "/admin/health", "/admin/providers", "/admin/reviews"];
const SKIP = /log ?out|sign ?out|delete|unpair|release|change number|get new number|cancel subscription|remove|suspend|deactivate|disconnect|reconnect stripe|open stripe|connect stripe|finish setup|manage billing|start free trial|get pairing code|get a new code|send to havnline|mark texting|mark as not|refund|void|block|seal|run now|retry|close call|dismiss|delete unverified|return fee|accept|decline/i;

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
async function visit(page, path, label) {
  const r = await page.goto(APP + path).catch((e) => ({ status: () => "ERR " + e.message }));
  await page.waitForLoadState("networkidle").catch(() => {});
  const st = typeof r?.status === "function" ? r.status() : "?";
  const text = await page.innerText("body").catch(() => "");
  const crashed = /Application error|Something went wrong|Unhandled Runtime Error|This page couldn.t load/i.test(text);
  return { st, crashed, text, url: page.url() };
}

async function clickEverything(page, path) {
  const done = new Set();
  const out = [];
  for (let round = 0; round < 60; round++) {
    await page.goto(APP + path);
    await page.waitForLoadState("networkidle").catch(() => {});
    const buttons = await page.locator("button:visible, [role=tab]:visible, [role=switch]:visible, summary:visible").evaluateAll((es) => es.map((e, i) => ({ i, t: (e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 50), dis: e.disabled || !!e.closest("[inert]") })));
    const next = buttons.find((b) => !b.dis && b.t && !done.has(b.t) && !SKIP.test(b.t));
    if (!next) break;
    done.add(next.t);
    const before = page._problems.length;
    try {
      await page.locator("button:visible, [role=tab]:visible, [role=switch]:visible, summary:visible").nth(next.i).click({ timeout: 3000 });
      await sleep(700);
      await page.keyboard.press("Escape").catch(() => {});
    } catch (e) {
      out.push(`could not click "${next.t}": ${e.message.split("\n")[0].slice(0, 80)}`);
    }
    const errs = page._problems.slice(before);
    if (errs.length) out.push(`"${next.t}" -> ${errs.join(" ; ").slice(0, 200)}`);
  }
  return { clicked: [...done], out };
}

export default async function ui(R, browser) {
  const owner = R.page;
  await scenario("ui: every owner page loads cleanly (desktop)", async () => {
    for (const p of OWNER_PAGES) {
      const v = await visit(owner, p);
      check(v.st === 200 && !v.crashed, `${p} -> ${v.st}${v.crashed ? " CRASHED" : ""} (${v.url.replace(APP, "")})`);
    }
    for (const x of owner._problems.splice(0)) check(false, x);
  });

  await scenario("ui: every owner page fits a phone screen", async () => {
    const phone = await newBrowserPage(browser, "phone", { viewport: { width: 390, height: 844 } });
    await logIn(phone, R.email);
    for (const p of OWNER_PAGES) {
      await visit(phone, p);
      const o = await overflow(phone);
      check(o <= 1, `${p} scrolls sideways on a phone by ${o}px`);
    }
    for (const p of PUBLIC_PAGES) {
      await visit(phone, p);
      const o = await overflow(phone);
      check(o <= 1, `${p} scrolls sideways on a phone by ${o}px`);
    }
    for (const x of phone._problems.splice(0)) check(false, x);
    await phone.context().close();
  });

  await scenario("ui: public pages load (logged out)", async () => {
    const anon = await newBrowserPage(browser, "anon");
    for (const p of PUBLIC_PAGES) {
      const v = await visit(anon, p);
      const ok = p === "/does-not-exist" ? v.st === 404 : v.st === 200;
      check(ok && !v.crashed, `${p} -> ${v.st}${v.crashed ? " CRASHED" : ""} (${v.url.replace(APP, "")})`);
    }
    for (const p of [...OWNER_PAGES, ...ADMIN_PAGES]) {
      const v = await visit(anon, p);
      check(/\/login/.test(v.url) || v.st === 404 || /Access restricted/.test(v.text), `logged-out ${p} should go to login or be restricted, got ${v.url.replace(APP, "")} (${v.st})`);
      check(!/Sim Burger Bar|trialing/.test(v.text) || /\/login/.test(v.url), `logged-out ${p} must not show restaurant data`);
    }
    for (const x of anon._problems.splice(0)) check(false, x);
    await anon.context().close();
  });

  await scenario("ui: owner can't open admin pages", async () => {
    for (const p of ADMIN_PAGES) {
      const v = await visit(owner, p);
      check(!/\/admin/.test(v.url) || v.st === 404 || /Access restricted|not authori|forbidden/i.test(v.text), `owner on ${p} -> ${v.url.replace(APP, "")} (${v.st})`);
    }
    owner._problems.splice(0);
  });

  await scenario("ui: admin pages load", async () => {
    const admin = await adminPage(browser);
    for (const p of [...ADMIN_PAGES, "/admin/businesses/" + R.biz.id]) {
      const v = await visit(admin, p);
      check(v.st === 200 && !v.crashed, `${p} -> ${v.st}${v.crashed ? " CRASHED" : ""} (${v.url.replace(APP, "")})`);
    }
    for (const x of admin._problems.splice(0)) check(false, x);
    globalThis.adminP = admin;
  });

  await scenario("ui: press every non-destructive button on every owner page", async () => {
    for (const p of OWNER_PAGES) {
      const { clicked, out } = await clickEverything(owner, p);
      note(`${p}: ${clicked.length} buttons`);
      for (const o of out) check(false, `${p}: ${o}`);
    }
    for (const x of owner._problems.splice(0)) check(false, x);
  });

  await scenario("ui: press every non-destructive button on admin pages", async () => {
    const admin = globalThis.adminP;
    for (const p of [...ADMIN_PAGES, "/admin/businesses/" + R.biz.id]) {
      const { clicked, out } = await clickEverything(admin, p);
      note(`${p}: ${clicked.length} buttons`);
      for (const o of out) check(false, `${p}: ${o}`);
    }
    for (const x of admin._problems.splice(0)) check(false, x);
  });
}
