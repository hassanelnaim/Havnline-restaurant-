// Runs simulation groups: node run.mjs [calls] [pay] ...
import { createRequire } from "node:module";
import { scenario, check, note, control, results } from "./lib.mjs";
import { createLiveRestaurant } from "./journey.mjs";
import { callScenarios, openAllDay } from "./calls.mjs";
import { payScenarios } from "./pay.mjs";
import fs from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");
const groups = process.argv.slice(2);
await control("/reset");
const browser = await chromium.launch();
let R;
await scenario("setup: live restaurant", async () => {
  R = await createLiveRestaurant(browser, { name: "Sim Burger Bar" });
  await openAllDay(R.biz.id);
  note(`number ${R.number}, stripe ${R.stripeAccount}`);
});
globalThis.R = R;
globalThis.browser = browser;
if (groups.includes("calls")) await callScenarios(R);
if (groups.includes("pay")) await payScenarios(R);
for (const g of groups.filter((g) => !["calls", "pay"].includes(g))) {
  const mod = await import(`./${g}.mjs`);
  await mod.default(R, browser);
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.writeFileSync(`/home/claude/sim/results-${groups.join("-") || "setup"}.json`, JSON.stringify(results, null, 2));
process.exit(0);
