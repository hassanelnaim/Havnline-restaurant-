-- Time-based menu item pricing — e.g. a Breakfast Special that's
-- $9.99 from 7:00-11:00am and $11.99 the rest of the day. price_cents
-- stays the item's normal/base price (used outside the window, and
-- whenever no time pricing is configured — every existing item keeps
-- working exactly as it does today). These three columns are the
-- window: all three must be set for time pricing to apply at all.
alter table public.menu_items
  add column if not exists special_price_cents integer,
  add column if not exists special_price_start_time time,
  add column if not exists special_price_end_time time;
