#!/usr/bin/env node
/**
 * Points every connected business's EXISTING Twilio number at the voice
 * fallback URL (Twilio uses it when the main voice webhook fails). New
 * numbers get this automatically; this updates the ones bought earlier.
 * Safe to run more than once.
 *
 * Usage (repo root, real values in .env.local):
 *   node --env-file=.env.local scripts/set-voice-fallback.mjs          # dry run, changes nothing
 *   node --env-file=.env.local scripts/set-voice-fallback.mjs --apply  # make the change
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * NEXT_PUBLIC_SITE_URL. Auth tokens are read from the database and used
 * only to call Twilio; nothing is printed except numbers and results.
 */
const apply = process.argv.includes("--apply");
const clean = (v) => (v || "").trim();
const SUPABASE_URL = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
const SERVICE_KEY = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const SITE_URL = clean(process.env.NEXT_PUBLIC_SITE_URL).replace(/\/$/, "");
if (!SUPABASE_URL || !SERVICE_KEY || !SITE_URL) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SITE_URL.");
  process.exit(1);
}
const FALLBACK = `${SITE_URL}/api/webhooks/twilio/voice-fallback`;

const res = await fetch(`${SUPABASE_URL}/rest/v1/integrations?select=business_id,metadata&provider=eq.twilio&status=eq.connected`, {
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
});
if (!res.ok) { console.error("Could not read integrations:", res.status); process.exit(1); }
const rows = await res.json();
console.log(`${rows.length} connected number(s). Fallback URL: ${FALLBACK}\n${apply ? "APPLYING" : "DRY RUN (add --apply to change)"}\n`);

let ok = 0, failed = 0;
for (const row of rows) {
  const m = row.metadata || {};
  const number = m.phone_number, sid = m.subaccount_sid, token = m.subaccount_auth_token;
  if (!number || !sid || !token) { console.log(`- ${number || "(no number)"}: skipped, missing Twilio details`); continue; }
  const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
  const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers`;
  try {
    const list = await fetch(`${base}.json?PhoneNumber=${encodeURIComponent(number)}`, { headers: { Authorization: auth } });
    const body = await list.json();
    const pn = body.incoming_phone_numbers?.[0];
    if (!list.ok || !pn) { console.log(`- ${number}: not found on Twilio (${list.status})`); failed++; continue; }
    if (pn.voice_fallback_url === FALLBACK) { console.log(`- ${number}: already set`); ok++; continue; }
    if (!apply) { console.log(`- ${number}: would set (currently ${pn.voice_fallback_url || "none"})`); continue; }
    const upd = await fetch(`${base}/${pn.sid}.json`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ VoiceFallbackUrl: FALLBACK, VoiceFallbackMethod: "POST" }),
    });
    if (upd.ok) { console.log(`- ${number}: set`); ok++; } else { console.log(`- ${number}: FAILED (${upd.status})`); failed++; }
  } catch (err) {
    console.log(`- ${number}: FAILED (${err.message})`); failed++;
  }
}
console.log(`\nDone. ok=${ok} failed=${failed}`);
