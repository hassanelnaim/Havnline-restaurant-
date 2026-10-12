-- Dashboard analytics, computed inside Postgres so the page only ever
-- receives a few dozen summed numbers instead of loading every order.
-- Nothing is stored: these are read-only functions over the existing
-- orders / order_items tables, so there is no new data to grow or go stale.
--
-- Both are SECURITY INVOKER (the default), so row-level security still
-- applies: a signed-in user can only ever see their own business's rows.
--
-- "Counts toward sales" mirrors lib/orders/sales.ts exactly: not
-- 'building' / 'cancelled', and payment_status 'paid' or 'not_required'.

-- sales_buckets: one row per period, oldest first, ending with the
-- current (partial) period. Periods with no sales come back as zero so a
-- chart never has gaps. p_unit is 'hour' | 'day' | 'week' | 'month'.
-- Buckets are calendar-aligned in the business's own timezone (weeks
-- start Monday). bucket_local is that local start time, as text.
create or replace function public.sales_buckets(
  p_business_id uuid,
  p_unit text,
  p_tz text,
  p_count int
)
returns table (bucket_local text, total_cents bigint, order_count bigint)
language plpgsql
stable
as $$
declare
  v_step interval;
  v_now_local timestamp;
  v_first_local timestamp;
begin
  if p_unit not in ('hour', 'day', 'week', 'month') then
    raise exception 'sales_buckets: unit must be hour, day, week or month';
  end if;
  if p_count < 1 or p_count > 60 then
    raise exception 'sales_buckets: count must be between 1 and 60';
  end if;

  v_step := case p_unit
    when 'hour' then interval '1 hour'
    when 'day' then interval '1 day'
    when 'week' then interval '1 week'
    else interval '1 month'
  end;

  v_now_local := date_trunc(p_unit, now() at time zone p_tz);
  v_first_local := v_now_local - (p_count - 1) * v_step;

  return query
  with series as (
    select v_first_local + g * v_step as b
    from generate_series(0, p_count - 1) as g
  ),
  sales as (
    select date_trunc(p_unit, o.created_at at time zone p_tz) as b,
           sum(o.total_cents)::bigint as cents,
           count(*)::bigint as n
    from public.orders o
    where o.business_id = p_business_id
      and o.created_at >= (v_first_local at time zone p_tz) - interval '1 day'
      and o.status not in ('building', 'cancelled')
      and o.payment_status in ('paid', 'not_required')
    group by 1
  )
  select to_char(s.b, 'YYYY-MM-DD"T"HH24:MI:SS'),
         coalesce(x.cents, 0)::bigint,
         coalesce(x.n, 0)::bigint
  from series s
  left join sales x on x.b = s.b
  order by s.b;
end;
$$;

-- top_sellers: every ACTIVE menu item with its units sold and revenue
-- since p_since (items that sold nothing come back with zeros, which is
-- how "what doesn't sell" is found). Revenue includes modifier prices.
create or replace function public.top_sellers(
  p_business_id uuid,
  p_since timestamptz
)
returns table (
  menu_item_id uuid,
  item_name text,
  category_name text,
  units bigint,
  revenue_cents bigint
)
language sql
stable
as $$
  with sold as (
    select oi.menu_item_id,
           sum(oi.quantity)::bigint as units,
           sum(
             (oi.unit_price_cents + coalesce(m.mod_cents, 0)) * oi.quantity
           )::bigint as revenue_cents
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    left join lateral (
      select sum(oim.price_delta_cents) as mod_cents
      from public.order_item_modifiers oim
      where oim.order_item_id = oi.id
    ) m on true
    where o.business_id = p_business_id
      and o.created_at >= p_since
      and o.status not in ('building', 'cancelled')
      and o.payment_status in ('paid', 'not_required')
      and oi.menu_item_id is not null
    group by oi.menu_item_id
  )
  select mi.id,
         mi.name,
         coalesce(mc.name, 'Other'),
         coalesce(s.units, 0)::bigint,
         coalesce(s.revenue_cents, 0)::bigint
  from public.menu_items mi
  left join public.menu_categories mc on mc.id = mi.category_id
  left join sold s on s.menu_item_id = mi.id
  where mi.business_id = p_business_id
    and mi.is_active = true;
$$;

-- Supports the per-business, per-time scans above.
create index if not exists orders_business_created_idx
  on public.orders (business_id, created_at desc);
