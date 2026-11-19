// Load test: many full phone orders at once against the real app, with the
// outside services answering at realistic speeds. Measures how long the
// caller waits on each step, errors, database work per call and server CPU.
//   node loadtest.mjs <restaurants> <level,level,...> [thinkMs]
import { createRequire } from "node:module";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { sql, one, control, runCall, sleep, GATEWAY } from "./lib.mjs";
import { createLiveRestaurant } from "./journey.mjs";
import { openAllDay, orderScript, standardLines, key, payOrder, orderFor } from "./calls.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");

const nRest = Number(process.argv[2] || 3);
const levels = (process.argv[3] || "10,25,50").split(",").map(Number);
const think = Number(process.argv[4] || 2500);
const LAT = { anthropic: 1100, elevenlabs: 450, stripe: 400, twilio: 300, resend: 200, turnstile: 100, scrapingbee: 1000, ...JSON.parse(process.env.LAT || "{}") };
const FAIL = JSON.parse(process.env.FAIL || "{}");

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const appPid = () => Number(execSync("pgrep -f 'next-server|next start' | head -1").toString().trim());
const cpuTicks = (pid) => {
  const f = fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
  return Number(f[11]) + Number(f[12]); // utime + stime (clock ticks)
};
const rssMb = (pid) => Math.round(Number(fs.readFileSync(`/proc/${pid}/statm`, "utf8").split(" ")[1]) * 4096 / 1048576);
const pgConns = async () => (await one("select count(*)::int n from pg_stat_activity where datname='havnline'")).n;

async function setup() {
  const cache = "/home/claude/sim/load-restaurants.json";
  if (fs.existsSync(cache) && process.env.REUSE) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const browser = await chromium.launch();
  const out = [];
  for (let i = 0; i < nRest; i++) {
    const R = await createLiveRestaurant(browser, { name: `Load Diner ${i + 1}`, label: `load${i}` });
    await openAllDay(R.biz.id);
    out.push({ number: R.number, token: R.token, biz: { id: R.biz.id }, stripeAccount: R.stripeAccount });
    await R.page.context().close();
  }
  await browser.close();
  fs.writeFileSync(cache, JSON.stringify(out));
  return out;
}

async function oneCall(R, i, level) {
  const k = key();
  await control("/ai/script", orderScript(k));
  const from = "+1734" + String(1000000 + level * 10000 + i).slice(-7);
  const t0 = Date.now();
  const c = await runCall({ to: R.number, from, token: R.token, say: standardLines(k), think });
  let paid = false;
  const o = await orderFor(c.callSid).catch(() => null);
  if (o?.stripe_payment_intent_id) {
    const r = await payOrder(o).catch((e) => ({ res: { status: "ERR " + e.message } }));
    paid = r.res?.status === 200;
  }
  return { ...c, total: Date.now() - t0, ordered: Boolean(o?.pay_token), paid };
}

const restaurants = await setup();
console.log(`restaurants: ${restaurants.length}, think time ${think}ms, outside latency ${JSON.stringify(LAT)}`);
const report = [];
for (const level of levels) {
  await control("/reset");
  await control("/config", { latency: LAT, jitter: 0.35, fail: JSON.parse(JSON.stringify(FAIL)) });
  await fetch(GATEWAY + "/__auth/reset");
  await sql("delete from rate_limit_hits");
  const pid = appPid();
  const cpu0 = cpuTicks(pid);
  let maxConns = 0, maxRss = 0;
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      maxConns = Math.max(maxConns, await pgConns());
      maxRss = Math.max(maxRss, rssMb(pid));
      await sleep(500);
    }
  })();
  const started = Date.now();
  // All calls start within ~3 seconds, like a dinner rush across restaurants.
  const calls = await Promise.all(
    Array.from({ length: level }, async (_, i) => {
      await sleep(Math.random() * 3000);
      try {
        return await oneCall(restaurants[i % restaurants.length], i, level);
      } catch (e) {
        return { problems: ["THREW " + e.message], timings: [], ended: "threw", ordered: false, paid: false };
      }
    })
  );
  const wall = Date.now() - started;
  sampling = false;
  await sampler;
  const cpuMs = ((cpuTicks(pid) - cpu0) * 1000) / 100;
  const counters = await control("/counters");
  const gw = await fetch(GATEWAY + "/__auth/stats").then((r) => r.json());
  const by = {};
  for (const c of calls) for (const t of c.timings) (by[t.path] ||= []).push(t);
  const routes = Object.fromEntries(
    Object.entries(by).map(([p, ts]) => [p, { n: ts.length, p50: pct(ts.map((t) => t.ms), 50), p95: pct(ts.map((t) => t.ms), 95), max: Math.max(...ts.map((t) => t.ms)), errors: ts.filter((t) => t.status !== 200).length, over15s: ts.filter((t) => t.ms > 15000).length }])
  );
  const problems = calls.flatMap((c) => c.problems);
  const row = {
    level, wallSec: Math.round(wall / 1000), ordered: calls.filter((c) => c.ordered).length, paid: calls.filter((c) => c.paid).length,
    ended: calls.reduce((m, c) => ((m[c.ended] = (m[c.ended] || 0) + 1), m), {}),
    problems: problems.length, problemSamples: [...new Set(problems.map((p) => p.replace(/[0-9a-f-]{36}|CA\w+/g, "…").slice(0, 120)))].slice(0, 6),
    serverCpuMs: Math.round(cpuMs), cpuPerCallMs: Math.round(cpuMs / level), cpuBusyPct: Math.round((cpuMs / wall) * 100),
    dbKbPerCall: Math.round((gw.restBytes || 0) / 1024 / level), dbRequests: gw.rest, dbPerCall: Math.round(gw.rest / level), dbErrors5xx: gw.restErrors, maxDbConns: maxConns, maxRssMb: maxRss,
    aiByModel: counters.ai.byModel, aiRequests: counters.ai.requests, tts: counters.tts.requests, sms: counters.sms, routes,
  };
  report.push(row);
  console.log(`\n=== ${level} calls at once: ${row.ordered}/${level} ordered, ${row.paid} paid, ${row.problems} problems, wall ${row.wallSec}s`);
  console.log(`    server CPU ${row.serverCpuMs}ms (${row.cpuPerCallMs}ms/call, ${row.cpuBusyPct}% busy), DB ${row.dbRequests} requests (${row.dbPerCall}/call, ${row.dbKbPerCall} KB/call, ${row.dbErrors5xx} 5xx), max DB conns ${row.maxDbConns}, RSS ${row.maxRssMb}MB, AI ${row.aiRequests} ${JSON.stringify(row.aiByModel)}, TTS ${row.tts}, SMS ${row.sms}`);
  for (const [p, r] of Object.entries(routes)) console.log(`    ${p.padEnd(40)} n=${String(r.n).padStart(5)} p50=${String(r.p50).padStart(5)}ms p95=${String(r.p95).padStart(5)}ms max=${String(r.max).padStart(6)}ms errors=${r.errors} >15s=${r.over15s}`);
  if (row.problemSamples.length) console.log("    problems: " + row.problemSamples.join("\n              "));
  await sleep(3000);
}
fs.writeFileSync("/home/claude/sim/load-report.json", JSON.stringify(report, null, 2));
process.exit(0);
