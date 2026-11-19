// N tablets polling like the real app (orders every 4s, today-orders every 15s) for 60s.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { sql, sleep, APP, GATEWAY } from "./lib.mjs";
const N = Number(process.argv[2] || 20);
const rests = JSON.parse(fs.readFileSync("/home/claude/sim/load-restaurants.json", "utf8"));
const tokens = [];
for (let i = 0; i < N; i++) {
  const R = rests[i % rests.length];
  const code = String(100000 + Math.floor(Math.random() * 899999));
  await sql("insert into printer_pairing_codes(business_id, code, expires_at) values ($1,$2, now()+interval '10 minutes')", [R.biz.id, code]);
  const r = await fetch(APP + "/api/printer-app/pair", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "10.1.1." + i }, body: JSON.stringify({ code }) }).then((x) => x.json());
  if (r.deviceToken) tokens.push(r.deviceToken); else console.log("pair failed", r);
}
await fetch(GATEWAY + "/__auth/reset");
const pid = Number(execSync("pgrep -f 'next-server|next start' | head -1").toString().trim());
const ticks = () => { const f = fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" "); return Number(f[11]) + Number(f[12]); };
const c0 = ticks();
let polls = 0, errors = 0;
const lat = [];
const end = Date.now() + 60000;
await Promise.all(tokens.map(async (t, i) => {
  await sleep(Math.random() * 4000);
  let n = 0;
  while (Date.now() < end) {
    const path = n % 4 === 0 ? "/api/printer-app/today-orders" : "/api/printer-app/orders";
    const t0 = Date.now();
    const r = await fetch(APP + path, { headers: { authorization: "Bearer " + t } });
    await r.text();
    lat.push(Date.now() - t0);
    polls++; if (r.status !== 200) errors++;
    n++;
    await sleep(4000);
  }
}));
const cpu = ((ticks() - c0) * 10);
const gw = await fetch(GATEWAY + "/__auth/stats").then((r) => r.json());
lat.sort((a, b) => a - b);
console.log(`${tokens.length} tablets, 60s: ${polls} polls, ${errors} errors, p50 ${lat[Math.floor(lat.length / 2)]}ms p95 ${lat[Math.floor(lat.length * 0.95)]}ms`);
console.log(`per poll: ${(gw.rest / polls).toFixed(1)} DB requests, ${((gw.restBytes || 0) / polls / 1024).toFixed(1)} KB, ${(cpu / polls).toFixed(1)} ms server CPU`);
console.log(`per tablet per month (24/7): ${Math.round(polls / tokens.length * 60 * 24 * 30 / 1000)}k requests, ${((gw.restBytes || 0) / tokens.length * 60 * 24 * 30 / 1024 / 1024 / 1024).toFixed(2)} GB database transfer`);
process.exit(0);
