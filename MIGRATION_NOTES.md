# v2 notes — what changed vs the v1 Supabase scaffold

This folder is **Khatulistiwa Resto v2** (Cloudflare Pages + Supabase),
not the v1 scaffold. The v1 scaffold lives in
`~/workspace/khatuliswa-resto-supabase/` and its
`MIGRATION_NOTES.md` there still documents the Apps Script → Supabase
mapping decisions (column layouts, loyalty points column, transaction
IDs, low-stock emails). This note only covers what v2 changed on top
of that scaffold — read both before deploying.

## v2 changes on top of the v1 scaffold

- **Frontend rewritten** (`public/index.html` + `public/js/app.js`):
  food-delivery UI (hero, round category circles, Popular Items,
  bottom nav), membership (Google Auth, points, Rewards/Profile),
  tracking view (`?view=order&id=...`, 15 s polling), admin views in
  the same app (POS / Kitchen / Transactions / Customers).
- **Seed replaced** (`supabase/seed.sql`): real 45-product menu from
  the Sheet (was demo data). `loyalty_rate` corrected to `10`
  (1 point per 10 LE; was `1000`, a Rupiah leftover).
- **Migration added** (`002_v2_members.sql`): `customers.google_id`,
  `avatar_url`, `latitude`, `longitude`, `maps_url`.
- **Functions added:** `track-order` (public, by id),
  `member-sync` (JWT-verified member sync).
- **Functions extended:** `submit-online-order` and `upsert-customer`
  (member/location upsert), `staff-api` (extra member fields in
  `getAppData` customers).
- **PWA added:** `manifest.json`, `sw.js`, `assets/icons/`
  (placeholder "K" icons — replace with the real logo).
- **Cloudflare Pages files added:** `_headers`, `_redirects`
  (SPA fallback).
- **Theme:** dark green `#14532D`, lime `#C7D957`, cream `#F7F0DC`
  (same `khatulistiwa-green` as live v1).

## Unchanged from the v1 scaffold (and its known gaps)

- PIN login (employee + SHA-256 PIN, 12 h HMAC session), no Supabase
  Auth for staff; demo PINs still `111111` / `080901` — **change
  before production**.
- `void_pin` / `kitchen_pin` still template defaults — **change
  before production**.
- No rate limiting / CAPTCHA on the public order function.
- Prices are client-supplied and re-checked server-side against
  Products (stock validated server-side).
- Transaction-ID dates use DB server time (UTC), not Africa/Cairo.
- Low-stock emails (GmailApp in v1) have no 1:1 equivalent.
- `getAppData` caps at the latest 500 transactions.

## Full setup, limits and portability

See `README.md` in this folder.
