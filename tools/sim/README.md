# HavnLine simulation harness

Runs the real app (a production build) against a real Postgres with every
migration and the same row security as Supabase, with Stripe, Twilio, the AI,
ElevenLabs, Resend and Turnstile replaced by local fakes. Nothing reaches a
real service: `hook.cjs` points those hosts at the fakes and blocks every
other outside host.

Built for Claude's cloud workspace (Linux, root). `./setup.sh` does
everything once; afterwards:

| Command | What it does |
|---|---|
| `node run.mjs calls pay tablet forms combos ui` | ~110 scenarios: calls, payments, tablet, owner forms, double clicks/races, every page and button |
| `node loadtest.mjs 3 10,50,100,200` | simultaneous full phone orders with realistic outside-service speeds |
| `FAIL='{"anthropic":{"status":529,"prob":0.2}}' node loadtest.mjs 3 50` | same, with an outside service failing |
| `node tabletload.mjs 3` | cost of tablets polling |
| `./sync-build.sh && ./start-app.sh` | rebuild after code changes |
| `./reset-db.sh` | fresh database from `base-schema.sql` + all migrations |

`fakes.mjs` has a control API on `http://127.0.0.1:4010` (latency, injected
failures, sent texts and emails, Stripe objects). The fake AI follows scripts
registered per call (see `orderScript` in `calls.mjs`).
