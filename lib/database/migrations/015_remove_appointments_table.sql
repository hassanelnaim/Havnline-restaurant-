-- The `appointments` table (and the reminder_sent_at/sms_consent
-- columns 010_appointment_reminders.sql added to it) is a leftover
-- from before HavnLine became restaurant-only — nothing in the
-- application queries it; the product now models everything through
-- orders/calls instead of appointment bookings. Safe to drop.
drop table if exists public.appointments cascade;
