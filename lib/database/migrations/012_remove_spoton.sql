-- Removes SpotOn entirely. HavnLine no longer integrates with SpotOn —
-- the HavnLine Printer App (see 011_printer_app.sql) is now the sole
-- path for getting a phone order to the kitchen printer, and it needs
-- no per-item POS mapping. These columns have been unused by the app
-- since the SpotOn integration was removed from the codebase; this
-- migration actually drops them rather than leaving dead columns
-- around.

alter table public.businesses
  drop column if exists spoton_location_id,
  drop column if exists spoton_access_token,
  drop column if exists spoton_refresh_token,
  drop column if exists spoton_token_expires_at,
  drop column if exists spoton_connected_at,
  drop column if exists spoton_menu_synced_at;

alter table public.menu_items
  drop column if exists spoton_item_id;

alter table public.modifier_groups
  drop column if exists spoton_modifier_group_id;

alter table public.modifiers
  drop column if exists spoton_modifier_id;

alter table public.orders
  drop column if exists spoton_order_id;
