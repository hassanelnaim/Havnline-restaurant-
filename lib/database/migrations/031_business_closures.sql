-- Holiday / one-off closures: whole days a business is closed even though
-- its weekly hours say it would normally be open (Thanksgiving, a family
-- event, a repair day). One row per closed calendar date, in the
-- business's own timezone.
--
-- The AI treats a closed date exactly like a closed weekday: it tells the
-- caller it's closed (and why, if a note is given), gives the next real
-- opening time, and the order tools refuse to build or place an order.
-- Upcoming closures are also shown to the AI so it can answer "are you
-- open on Thanksgiving?".
create table if not exists public.business_closures (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  closed_on date not null,
  note text,
  created_at timestamptz not null default now(),
  constraint business_closures_one_per_day unique (business_id, closed_on),
  constraint business_closures_note_length check (note is null or char_length(note) <= 80)
);

create index if not exists business_closures_business_date_idx
  on public.business_closures (business_id, closed_on);

alter table public.business_closures enable row level security;

drop policy if exists "business_closures: members can manage their business's closures" on public.business_closures;
create policy "business_closures: members can manage their business's closures"
  on public.business_closures for all
  using (business_id in (select business_id from business_members where user_id = auth.uid()))
  with check (business_id in (select business_id from business_members where user_id = auth.uid()));
