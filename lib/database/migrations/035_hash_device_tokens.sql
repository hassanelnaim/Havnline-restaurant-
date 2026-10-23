-- 035: kitchen tablet tokens are stored as hashes, not in plain text.
--
-- A tablet's token is its permanent login. Stored in plain text, a leak
-- of this one table would hand out a working login for every restaurant's
-- tablet (read today's orders, comp items). Now only a SHA-256 hash is
-- kept: the server hashes what the tablet sends and compares.
--
-- Existing tablets keep working without re-pairing: their hashes are
-- filled in here, and the app erases each plain-text token the next time
-- that tablet checks in. Safe to run more than once.

alter table public.printer_devices add column if not exists device_token_hash text;

update public.printer_devices
set device_token_hash = encode(sha256(convert_to(device_token, 'UTF8')), 'hex')
where device_token_hash is null and device_token is not null;

create unique index if not exists printer_devices_device_token_hash_key on public.printer_devices (device_token_hash);

alter table public.printer_devices alter column device_token drop not null;
