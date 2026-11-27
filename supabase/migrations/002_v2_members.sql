-- =============================================================================
-- Khatulistiwa Resto v2 — membership + delivery location columns
-- Apply AFTER 001_init.sql (supabase db push applies both in order).
-- Adds the extra synced member data the v2 frontend and admin Customers
-- view need, on top of the v1 customers table:
--   google_id   — Supabase Auth user id (auth.users), links a Google login
--                  to one customers row. Unique when set.
--   avatar_url  — Google profile picture URL.
--   latitude / longitude / maps_url — saved delivery location (Tausil).
--                  maps_url is a https://maps.google.com/?q=lat,lng link,
--                  the same link that goes into the WhatsApp order text.
-- Nothing here deletes or renames a v1 column. Existing rows are untouched
-- (new columns are nullable / default '').
-- =============================================================================

alter table public.customers
  add column if not exists google_id   text,
  add column if not exists avatar_url text not null default '',
  add column if not exists latitude   numeric,
  add column if not exists longitude  numeric,
  add column if not exists maps_url   text not null default '';

-- One Google account = one customer row (only when google_id is set).
create unique index if not exists customers_google_id_idx
  on public.customers (google_id) where google_id is not null and google_id <> '';
create index if not exists customers_email_idx
  on public.customers (email) where email <> '';

-- v2 settings defaults (override the v1 template defaults from 001_init.sql).
-- loyalty_rate 10 = 1 point per 10 LE spent (was 1000, a Rupiah leftover).
-- currency LE, restaurant name + Cairo address from the resto's own branding.
insert into public.settings (key, value) values
  ('restaurant_name', 'Khatulistiwa Resto'),
  ('currency', 'LE'),
  ('loyalty_rate', '10'),
  ('theme_id', 'khatulistiwa-green'),
  ('address', '27 Dr Ibrahim Abou El-Naga, Al Hadiqah Ad Dawleyah, Nasr City, Cairo, Egypt')
on conflict (key) do update set value = excluded.value;
