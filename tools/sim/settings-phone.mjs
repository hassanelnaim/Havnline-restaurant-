// Settings refuses the restaurant's own HavnLine number as its main or escalation phone.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { APP, one, scenario, check, pool, results, sleep } from "./lib.mjs";
import { createLiveRestaurant } from "./journey.mjs";
const browser = await chromium.launch();
const R = await createLiveRestaurant(browser, { name: "Phone Check", label: "ph", texting: false });
const p = R.page;
async function trySave(field, value) {
  await p.goto(APP + "/dashboard/settings");
  await p.waitForLoadState("networkidle");
  await p.fill(field, value);
  await p.getByRole("button", { name: "Save changes" }).click();
  await sleep(2500);
  return p.innerText("body");
}
const local = R.number.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");
await scenario("settings: main phone can't be the HavnLine number", async () => {
  const t = await trySave("#phone", local);
  check(/That's your HavnLine number/.test(t), "no error shown");
  check((await one("select phone from businesses where id=$1", [R.biz.id])).phone !== local, "saved anyway");
});
await scenario("settings: escalation phone can't be the HavnLine number", async () => {
  const t = await trySave("#esc-phone", local);
  check(/can't be your HavnLine number/.test(t), "no error shown");
  check(!(await one("select escalation_phone from businesses where id=$1", [R.biz.id])).escalation_phone, "saved anyway");
});
await scenario("settings: a normal escalation phone still saves", async () => {
  await trySave("#esc-phone", "(248) 555-0123");
  check((await one("select escalation_phone from businesses where id=$1", [R.biz.id])).escalation_phone === "+12485550123", "didn't save");
});
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
await browser.close(); await pool.end();
