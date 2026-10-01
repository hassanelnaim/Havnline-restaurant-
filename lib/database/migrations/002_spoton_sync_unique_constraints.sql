-- Unique constraints needed for the SpotOn menu sync's upsert-by-SpotOn-id
-- pattern (syncSpotOnMenu, in a lib/integrations/spoton.ts that no longer
-- exists — removed along with the rest of the SpotOn integration, see
-- below). Run this after 001_restaurant_pivot.sql.
--
-- Reconstructed into the repo's migration history after the fact (see
-- 001_restaurant_pivot.sql's note). OBSOLETE as of 012_remove_spoton.sql,
-- which drops the spoton_item_id / spoton_modifier_group_id /
-- spoton_modifier_id columns these indexes are built on — Postgres
-- drops an index automatically when its column is dropped, so running
-- this against a database that already has 012 applied is a no-op at
-- best (the referenced columns won't exist). Kept here only so the
-- history is complete; there's nothing left to apply.

create unique index if not exists menu_items_business_spoton_item_idx
  on menu_items(business_id, spoton_item_id)
  where spoton_item_id is not null;

create unique index if not exists modifier_groups_item_spoton_group_idx
  on modifier_groups(menu_item_id, spoton_modifier_group_id)
  where spoton_modifier_group_id is not null;

create unique index if not exists modifiers_group_spoton_modifier_idx
  on modifiers(modifier_group_id, spoton_modifier_id)
  where spoton_modifier_id is not null;
