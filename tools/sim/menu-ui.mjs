// The rebuilt menu page (categories, list, add/edit panel with combo, sizes, add-ons, special price)
// and the note_allergy step on calls.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { APP, sql, one, scenario, check, note, control, pool, results, runCall, sleep } from "./lib.mjs";
import { createLiveRestaurant, newBrowserPage, logIn } from "./journey.mjs";
import { key, caller, openAllDay, orderFor, toolResults } from "./calls.mjs";

const SHOTS = process.env.SIM_SHOTS || "/tmp";
const browser = await chromium.launch();
let R, p;

async function openMenu() {
  await p.goto(APP + "/dashboard/menu");
  await p.waitForLoadState("networkidle");
}

await scenario("menu: set up", async () => {
  R = await createLiveRestaurant(browser, { name: "Menu Diner", label: "menu" });
  await openAllDay(R.biz.id);
  for (const c of ["Coney Dogs", "Breakfast Specials", "Salads & Wraps"]) await sql("insert into menu_categories(business_id, name) values ($1,$2)", [R.biz.id, c]);
  p = R.page;
  await p.setViewportSize({ width: 1366, height: 900 });
});

await scenario("menu: categories are all the same size", async () => {
  await openMenu();
  const boxes = await p.locator('nav[aria-label="Menu categories"] button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  note(JSON.stringify(boxes));
  check(new Set(boxes.map((b) => b[0])).size === 1, "category widths differ: " + JSON.stringify(boxes));
  check(new Set(boxes.map((b) => b[1])).size === 1, "category heights differ");
  await p.getByRole("button", { name: /Breakfast Specials/ }).click();
  check(/Breakfast Specials/.test(await p.locator("section h2").first().innerText()), "list title doesn't follow the category");
  await p.screenshot({ path: SHOTS + "/menu-new-list.png" });
});

await scenario("menu: add a category from the side", async () => {
  await openMenu();
  await p.getByRole("button", { name: "New category" }).click();
  await p.fill("#new-category-name", "Desserts");
  await p.getByRole("button", { name: "Add", exact: true }).click();
  await p.getByRole("button", { name: /^Desserts/ }).waitFor({ timeout: 8000 });
  check(await one("select 1 as x from menu_categories where business_id=$1 and name='Desserts'", [R.biz.id]), "category not saved");
});

await scenario("menu: add an item with a combo, add-ons and a lower-price option in one go", async () => {
  await openMenu();
  await p.getByRole("button", { name: /^Coney Dogs/ }).click();
  await p.getByRole("button", { name: "Add item" }).first().click();
  const dlg = p.getByRole("dialog");
  await dlg.waitFor();
  check((await dlg.getByRole("radio", { name: "Coney Dogs" }).getAttribute("aria-checked")) === "true", "category not preset from the list");
  await p.fill("#item-name", "Coney Combo Test");
  await p.fill("#item-price", "4.49");
  await p.fill("#item-description", "Chili, mustard, onions");
  await dlg.locator("#opt-combo").click();
  await p.fill("#combo-price", "4.00");
  await dlg.getByRole("button", { name: "Add item" }).click();
  await dlg.getByRole("alert").waitFor();
  check(/has to be more than the item on its own/.test(await dlg.getByRole("alert").innerText()), "combo below price not refused");
  await p.fill("#combo-price", "9.99");
  await p.fill("#combo-with", "fries & a pop");
  check(/adds \$5\.50/.test(await dlg.innerText()), "combo difference not shown");
  await dlg.getByRole("button", { name: /New group/ }).click();
  await p.fill("#addon-group-name", "Extras");
  const opts = dlg.locator('input[placeholder="Option, e.g. Bacon"]');
  const prices = dlg.locator('input[placeholder="+$ (or -1.50)"]');
  await opts.nth(0).fill("Extra chili");
  await prices.nth(0).fill("0.75");
  await dlg.getByRole("button", { name: "Another option" }).click();
  await opts.nth(1).fill("No onions");
  await dlg.getByRole("button", { name: "Add group" }).click();
  check(/Extras/.test(await dlg.innerText()), "pending group not listed");
  await p.screenshot({ path: SHOTS + "/menu-new-panel.png" });
  await dlg.getByRole("button", { name: "Add item" }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  await sleep(1000);
  const item = await one("select id, price_cents, description, category_id from menu_items where business_id=$1 and name='Coney Combo Test'", [R.biz.id]);
  check(item?.price_cents === 449, "price " + item?.price_cents);
  const cat = await one("select name from menu_categories where id=$1", [item?.category_id]);
  check(cat?.name === "Coney Dogs", "category " + cat?.name);
  const combo = await one("select m.name, m.price_delta_cents from modifiers m join modifier_groups g on g.id=m.modifier_group_id where g.menu_item_id=$1 and g.name='Combo'", [item.id]);
  check(combo?.price_delta_cents === 550 && combo.name === "Make it a combo (fries & a pop)", "combo " + JSON.stringify(combo));
  const extras = await sql("select m.name, m.price_delta_cents from modifiers m join modifier_groups g on g.id=m.modifier_group_id where g.menu_item_id=$1 and g.name='Extras' order by m.sort_order", [item.id]);
  check(extras.length === 2 && extras[0].price_delta_cents === 75, "extras " + JSON.stringify(extras));
  const row = p.locator("li", { hasText: "Coney Combo Test" });
  check(/Combo \$9\.99/.test(await row.innerText()), "list tag missing: " + (await row.innerText()));
  check(/1 add-on group/.test(await row.innerText()), "add-on tag missing");
});

await scenario("menu: edit price keeps the combo price; sizes; special price", async () => {
  await openMenu();
  await p.locator("li", { hasText: "Coney Combo Test" }).getByRole("button", { name: /Edit Coney Combo Test/ }).click();
  const dlg = p.getByRole("dialog");
  await dlg.waitFor();
  check((await p.inputValue("#combo-price")) === "9.99", "combo price not loaded");
  await p.fill("#item-price", "4.99");
  await dlg.locator("#opt-special").click();
  await p.fill("#special-price", "3.99");
  await p.fill("#special-start", "07:00");
  await p.fill("#special-end", "11:00");
  await dlg.getByRole("button", { name: "Save changes" }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 });
  await sleep(1000);
  const item = await one("select id, price_cents, special_price_cents from menu_items where business_id=$1 and name='Coney Combo Test'", [R.biz.id]);
  check(item.price_cents === 499 && item.special_price_cents === 399, "item " + JSON.stringify(item));
  const combo = await one("select m.price_delta_cents from modifiers m join modifier_groups g on g.id=m.modifier_group_id where g.menu_item_id=$1 and g.name='Combo'", [item.id]);
  check(combo?.price_delta_cents === 500, "combo should stay $9.99 (delta 500), delta " + combo?.price_delta_cents);

  await openMenu();
  await p.locator("li", { hasText: "Coney Combo Test" }).getByRole("button", { name: /Edit Coney Combo Test/ }).click();
  await dlg.waitFor();
  await dlg.locator("#opt-sizes").click();
  const names = dlg.locator('input[placeholder="Size"], input[aria-label^="Size name"]');
  note("size inputs " + (await names.count()));
  const priceInputs = dlg.locator('input[aria-label^="Price for"], input[placeholder="0.00"]');
  if (await priceInputs.count() >= 2) { await priceInputs.nth(0).fill("4.99"); await priceInputs.nth(1).fill("6.49"); }
  await dlg.getByRole("button", { name: "Save changes" }).click();
  await dlg.waitFor({ state: "detached", timeout: 15000 }).catch(async () => note("panel stayed open: " + (await dlg.innerText()).slice(0, 200)));
  await sleep(1000);
  const sizes = await sql("select m.name, m.price_delta_cents from modifiers m join modifier_groups g on g.id=m.modifier_group_id where g.menu_item_id=$1 and g.name='Size' order by m.sort_order", [item.id]);
  check(sizes.length === 2, "sizes " + JSON.stringify(sizes));
});

await scenario("menu: delete from the panel", async () => {
  await openMenu();
  await p.locator("li", { hasText: "Coney Combo Test" }).getByRole("button", { name: /Edit Coney Combo Test/ }).click();
  const dlg = p.getByRole("dialog");
  await dlg.getByRole("button", { name: "Delete item" }).click();
  await dlg.getByRole("button", { name: "Yes, delete" }).click();
  await dlg.waitFor({ state: "detached", timeout: 10000 });
  await sleep(800);
  check(!(await one("select 1 as x from menu_items where business_id=$1 and name='Coney Combo Test'", [R.biz.id])), "not deleted");
});

await scenario("menu: phone width", async () => {
  const ph = await newBrowserPage(browser, "menu-phone", { viewport: { width: 390, height: 844 } });
  await logIn(ph, R.email);
  await ph.goto(APP + "/dashboard/menu");
  await ph.waitForLoadState("networkidle");
  const o = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(o <= 1, "horizontal overflow " + o);
  await ph.screenshot({ path: SHOTS + "/menu-new-phone.png" });
  await ph.getByRole("button", { name: "Add item" }).first().click();
  await ph.getByRole("dialog").waitFor();
  const o2 = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(o2 <= 1, "panel overflow " + o2);
  await ph.screenshot({ path: SHOTS + "/menu-new-phone-panel.png" });
});

await scenario("allergy: note_allergy writes it and finds tomato in the cheeseburger", async () => {
  await sql("update menu_items set description='American cheese, lettuce, tomato, pickles' where business_id=$1 and name='Cheeseburger'", [R.biz.id]);
  await sleep(21000);
  const k = key();
  await control("/ai/script", {
    key: k,
    turns: [
      [{ tools: [{ name: "add_item_to_order", input: { item_name: "Cheeseburger", quantity: 1 } }] }, { text: "Got it. Any allergies?" }],
      [{ tools: [{ name: "note_allergy", input: { allergy: "tomatoes" } }] }, { text: "Heads up, the cheeseburger comes with tomato." }],
      [{ tools: [{ name: "confirm_and_place_order", input: { customer_name: "Sam", payment_method: "cash" } }] }, { text: "All set." }],
    ],
  });
  const c = await runCall({ to: R.number, from: caller(), token: R.token, say: [`a cheeseburger please ${k}`, "I'm allergic to tomatoes", "cash"] });
  const res = (await toolResults(k)).map((t) => t.content).find((x) => /menu_mentions/.test(x)) || "";
  check(/Cheeseburger: the menu says \\"American cheese, lettuce, tomato, pickles\\" \(tomatoes\)/.test(res), "mention missing: " + res.slice(0, 300));
  const o = await orderFor(c.callSid);
  check(/ALLERGY: tomatoes/.test(o?.special_instructions || ""), "allergy not on the order: " + o?.special_instructions);
  const job = await one("select ticket_text from printer_print_jobs where order_id=$1", [o?.id]);
  note("ticket: " + (job?.ticket_text || "none").split("\n").slice(0, 8).join(" | "));
  if (job) check(/!! ALLERGY: TOMATOES/.test(job.ticket_text), "allergy not at the top of the ticket");
});

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
await browser.close();
await pool.end();
