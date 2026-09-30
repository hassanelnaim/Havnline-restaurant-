-- Twilio guarantees "at-least-once" webhook delivery, and a slow AI
-- turn (menu lookup, tool calls, a Stripe Checkout Session, an SMS
-- send) is exactly the kind of thing that can make Twilio time out and
-- retry the same turn. handleTurn already dedupes an *identical*
-- retried message, but a narrower race remained: two overlapping
-- requests for the same call could each run the SELECT half of
-- getOrCreateBuildingOrder (lib/ai/tools.ts) before either had
-- inserted, both find no "building" order, and both insert one —
-- producing two kitchen tickets and two confirmation texts for one
-- real order. A call can only ever have ONE order actively being
-- built at a time, so this makes that a real database guarantee
-- instead of a best-effort check-then-insert.
create unique index if not exists orders_one_building_per_call
  on public.orders (call_id)
  where status = 'building';
