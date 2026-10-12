-- Day-of-week support for item special prices, and real discounts for
-- promotions (until now a promotion was only text the AI could mention).
--
-- Weekdays are stored as smallints 0-6 (0 = Sunday ... 6 = Saturday). A
-- null or empty days array means "every day", so everything that exists
-- today keeps working exactly as it does now.

-- 1. Item special price can now be limited to certain days. The time
--    window may also be left empty when days are set (an all-day special,
--    e.g. "Taco Tuesday, $5 tacos, all day Tuesday").
alter table public.menu_items
  add column if not exists special_price_days smallint[];

alter table public.menu_items
  drop constraint if exists menu_items_special_price_days_valid;
alter table public.menu_items
  add constraint menu_items_special_price_days_valid
  check (special_price_days is null or special_price_days <@ array[0,1,2,3,4,5,6]::smallint[]);

-- 2. Promotions: when they run (days + optional time window) and what
--    they actually take off.
--      discount_type  'percent' -> discount_value is 1-100 (percent off)
--                     'amount'  -> discount_value is cents off EACH eligible item
--                     null      -> mention-only (the original behaviour)
--      menu_item_ids  items the discount applies to; null/empty = every item
alter table public.promotions
  add column if not exists days_of_week smallint[],
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists discount_type text,
  add column if not exists discount_value integer,
  add column if not exists menu_item_ids uuid[];

alter table public.promotions
  drop constraint if exists promotions_days_valid,
  drop constraint if exists promotions_discount_valid;
alter table public.promotions
  add constraint promotions_days_valid
    check (days_of_week is null or days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
  add constraint promotions_discount_valid
    check (
      (discount_type is null and discount_value is null)
      or (discount_type = 'percent' and discount_value is not null and discount_value between 1 and 100)
      or (discount_type = 'amount' and discount_value is not null and discount_value > 0)
    );
