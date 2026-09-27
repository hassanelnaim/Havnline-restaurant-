-- A per-business sales tax rate, applied to an order's subtotal when
-- the AI confirms it (see confirm_and_place_order in lib/ai/tools.ts).
-- Stored in basis points (825 = 8.25%) rather than a float, so
-- repeated calculations across many orders never drift from rounding.
-- Defaults to 0 (no tax added) until the owner sets a real rate in
-- Settings — existing businesses keep behaving exactly as they do
-- today until they opt in.
alter table public.businesses
  add column if not exists tax_rate_bps integer not null default 0;
