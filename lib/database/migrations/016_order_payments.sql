-- Stripe Connect payments for phone orders. Two independent pieces:
--
-- 1. businesses gets a Stripe CONNECTED account (separate from the
--    existing stripe_customer_id/stripe_subscription_id, which are
--    for the business's OWN subscription to HavnLine, billed to
--    HavnLine's own Stripe account). A connected account is where
--    CUSTOMER payments for phone orders actually land — Stripe pays
--    it out straight to the restaurant's own bank, and HavnLine never
--    holds that money. phone_payments_enabled is a separate, explicit
--    toggle: connecting an account is not by itself consent to start
--    charging customers — the owner flips this on deliberately, in
--    Settings, once they've connected and are ready. Until they do,
--    everything works exactly as it does today (pay at pickup).
--
-- 2. orders gets a payment_status independent of its existing
--    fulfillment status. An order can be status='confirmed' while
--    payment_status='awaiting_payment' — it exists and the customer
--    has heard the total, but nothing prints to the kitchen and
--    status never reaches 'submitted' until payment_status flips to
--    'paid' (see the Stripe Connect webhook). Existing/pay-at-pickup
--    orders default to 'not_required' and behave exactly as before.

alter table public.businesses
  add column if not exists stripe_connect_account_id text,
  add column if not exists stripe_connect_charges_enabled boolean not null default false,
  add column if not exists stripe_connect_onboarded_at timestamptz,
  add column if not exists phone_payments_enabled boolean not null default false,
  -- Platform application fee taken on top of each paid phone order, in
  -- basis points (250 = 2.5%). Null means "no fee configured yet" —
  -- deliberately not defaulted to 0, so it's visible in the data which
  -- businesses have an actual pricing decision made vs. just never set.
  add column if not exists platform_fee_bps integer;

alter table public.orders
  add column if not exists payment_status text not null default 'not_required',
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists amount_refunded_cents integer not null default 0,
  add column if not exists refund_reason text,
  add column if not exists refunded_by uuid references auth.users(id),
  add column if not exists refunded_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id),
  add column if not exists voided_at timestamptz;

alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in ('not_required', 'awaiting_payment', 'paid', 'refunded', 'partially_refunded', 'failed'));

create index if not exists orders_stripe_checkout_session_id_idx on public.orders (stripe_checkout_session_id) where stripe_checkout_session_id is not null;
