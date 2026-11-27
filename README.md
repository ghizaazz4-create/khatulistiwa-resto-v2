# Khatulistiwa Resto v2 — Cloudflare Pages + Supabase

Food-delivery style online ordering (Little Caesars / Taco Bell / Arby's
reference UIs) in the resto's own green + cream theme, with Google
membership + points, one-click order-to-WhatsApp, live order tracking,
and a PWA for the **whole** app (order pages + admin).

**Local build only — nothing is deployed yet. No Supabase project,
no Cloudflare account, and no real credentials exist anywhere here.**
The live v1 app (Apps Script + GitHub Pages) is untouched and stays live
until this v2 is proven: `~/workspace/khatuliswa-resto/` (Apps Script,
live v8) and `~/workspace/khatuliswa-resto-github-pages/` (live Pages).

## What was built

| Path | What it is |
|---|---|
| `public/index.html` + `public/js/app.js` | New single-page app. Food-delivery UI: header + search, membership hero banner, scrollable round category circles, Popular Items cards with photo + LE price + green `+` button, bottom nav Home / Menu / Order / Rewards / Profile. Views: `?view=online` (default), `?view=order&id=YYMMDD-XXX` (tracking), `?view=rewards`, `?view=profile`, `?view=admin` (staff PIN: POS / Kitchen / Transactions / Customers), `?view=kitchen`. |
| `public/js/supabaseApi.js` | Reused from the v1 scaffold, plus `trackOrder()` and `memberSync()`. |
| `public/js/supabaseClient.js` | Reused from the v1 scaffold (anon client; also used for Supabase Auth). |
| `public/js/demo-data.js` | **New — demo mode data.** Generated from `supabase/seed.sql` by `tools/gen_demo_data.py` (do not edit by hand; edit the seed and re-run). 6 categories, 44 products, settings (`restaurant_name`, `currency: LE`, `whatsapp_admin_phone`, `loyalty_rate: 10`, `tax_rate: 10`, `service_charge: 5`). Loaded only when Supabase is not configured; never used once `config.js` has a real URL + anon key. |
| `public/config.js` | `SUPABASE_URL` / `SUPABASE_ANON_KEY` **placeholders only** — fill in after creating the project. Admin WhatsApp `201515041807` (public number). |
| `public/manifest.json`, `public/sw.js`, `public/assets/icons/` | PWA for the whole app (name "Khatulistiwa Resto", theme green `#14532D`). Service worker caches the app shell; Supabase API calls are never cached (order status must stay live). Icons are simple generated placeholders (green + lime "K") — replace with the real logo before launch. |
| `public/_headers`, `public/_redirects` | Cloudflare Pages headers + SPA fallback (`/* → /index.html`). Query-param views (`?view=...`) need no rewrite. |
| `supabase/migrations/001_init.sql` | Reused unchanged from the v1 scaffold (9 tables, views, RLS, `next_transaction_id()`, Storage `assets` bucket, default settings). |
| `supabase/migrations/002_v2_members.sql` | **New.** Member columns on `customers` (`google_id`, `avatar_url`, `latitude`, `longitude`, `maps_url`) + v2 settings: `restaurant_name = Khatulistiwa Resto`, `currency = LE`, `loyalty_rate = 10` (1 point per 10 LE), `theme_id = khatulistiwa-green`, Cairo address. |
| `supabase/seed.sql` | **Replaced — real menu, not demo data.** 6 categories, **44 products** (Nasi Gaol 7, Soup Tomyam 4, Cemilan 7, Classic Drink 15, Premium Drink 9, Extra Topping 2), all LE prices, Regular stock 100, `point_price` only on the 4 redeemable items. **No product photos** (`image_url` empty — the old Unsplash stock photos were removed 2026-11-27 because they are not the resto's real photos; admin uploads real photos via the Products form). Susu Kambing + kategori Fresh Milk dihapus 2026-11-27 atas permintaan user. Staff PINs = 123456 untuk semua karyawan (pilihan user 2026-11-27). |
| `supabase/functions/submit-online-order` | Reused + extended: upsert now matches member by `customerId` → `google_id` → `email` → phone, and stores the delivery location (lat/lng/Maps link). Still: record first (Pending), client opens `wa.me` only after success. |
| `supabase/functions/track-order` | **New, public.** One transaction by id: status, items, total, order type, payment. The tracking view re-fetches it every 15 s. |
| `supabase/functions/member-sync` | **New, JWT-verified.** Syncs the signed-in Google member's profile (name, email, avatar, phone, address, location) to one `customers` row; returns points + totals. The browser can never sync another member's row. |
| `supabase/functions/lookup-customer`, `upsert-customer`, `display-transactions`, `staff-api`, `_shared/` | Reused from the v1 scaffold. `upsert-customer` also accepts the member/location fields now. `staff-api` `getAppData` now returns the extra member fields (`google_id`, `avatar_url`, `latitude`, `longitude`, `maps_url`) so admin Customers shows the same synced record. |
| `supabase/config.toml` | v1 functions + `[functions.track-order] verify_jwt = false`, `[functions.member-sync] verify_jwt = true`. |

## How the flows work

### Order — sekali klik ke WhatsApp (like Sekali Klik Store)
1. Customer picks items → cart → Checkout (name, WhatsApp number,
   address, order type Dine In / Take Away / Delivery, payment
   Cash / QRIS / Transfer, notes).
2. **Accept** calls `submit-online-order` first: upsert customer,
   validate stock, insert Transaction **Pending** with id `YYMMDD-XXX`.
3. Only on success the app opens
   `https://wa.me/201515041807?text=...` with the full order text:
   order ID, items + total, name, phone, order type, address, location
   Maps link, payment, **and the tracking link**
   `?view=order&id=<txnId>`.
4. **Delivery (Tausil):** a "📍 Bagikan Lokasi Saya" button uses
   browser geolocation to fill the address + Maps link. For a
   logged-in member the saved location auto-fills. For a guest with
   no location shared, the WhatsApp text adds:
   *"Mohon share lokasi (Share Location) via WhatsApp setelah pesan
   ini terkirim."*

### Order tracking — live status link
`?view=order&id=...` (or type the ID into "Lacak Pesanan" on the home
page) shows the order detail and the status steps
Pending → Dibuat → Diantar → Selesai (Diantar only for Delivery).
It re-fetches `track-order` **every 15 seconds**, so a status change
made in Kitchen / POS / Transactions appears on the link. There is
one source of truth — the `transactions` row in Supabase — so POS,
Kitchen, Transactions, Customers and the tracking link can never
disagree.

### Membership — Google login, optional
- "Masuk dengan Google" (Supabase Auth, Google provider) on Profile
  / Rewards / hero banner. **Guest checkout always works** — no
  login is ever required to order.
- Members earn **1 point per 10 LE** (`loyalty_rate = 10`), see their
  balance on Rewards, and redeem items with `point_price` (price in
  points). Profile shows name / email / Google avatar, saved address
  + saved delivery location, editable and synced via `member-sync`.
- A Guest order with the same phone number as a member links to that
  member's `customers` row (no duplicate customer). The admin
  Customers view shows the same synced fields: Google email, address,
  Maps link, points, total purchases, last order.

### Admin — same app, staff PIN login
PIN login (unchanged from v1: employee + SHA-256 PIN, 12 h HMAC
session). Tabs: **POS** (menu + cart + staff checkout),
**Kitchen** (today's orders, status buttons, auto-refresh 15 s),
**Transactions** (list + status change + tracking-link per order),
**Customers** (member data: Google badge, email, address, Maps link,
points, total purchases, last visit). Status flow:
Pending → Dibuat → Selesai, plus Diantar for delivery.

## Demo mode — works before Supabase exists

If `public/config.js` still has the placeholder URL / anon key, the
app does **not** show a load error. It loads the real menu and design
from `public/js/demo-data.js` (generated from `supabase/seed.sql`)
and sets `state.demoMode = true`:

- The online/order views show a banner: *"Mode Demo — Supabase
  belum tersambung. Menu bisa dilihat dan pesan ke WA tetap jalan,
  tapi pesanan belum tercatat dan belum bisa dilacak."*
- Ordering works end-to-end to WhatsApp (Accept → `wa.me/201515041807`
  with the full order text), but with a local order id `DEMO-XXXXXX`
  and **no tracking link** — instead the WA text says
  *"Mode demo: pesanan ini tidak tercatat di database."* After
  WhatsApp opens, the order view shows the local order summary with
  a demo notice instead of trying to load tracking.
- Google sign-in and phone lookup fail gracefully (sign-in shows
  "Supabase is not configured yet"; lookup simply finds nothing).
  Admin (staff PIN) needs Supabase and does not work in demo mode.
- **Demo mode disappears automatically** the moment `config.js` is
  filled with a real Supabase Project URL + anon key: `boot()` only
  uses `DEMO_DATA` when `window.SUPABASE_CONFIGURED` is false, and
  the demo file is never read when Supabase is configured.

## Setup — what still needs the user

### 1. Create the Supabase project (user)
1. https://supabase.com/dashboard → **New project** (e.g.
   `khatulistiwa-resto`), save the database password, pick the
   region closest to Cairo.
2. Note the **Project URL** and **anon public key**
   (Project Settings → API). The **service_role key stays in the
   Dashboard** — never paste it into chat, the frontend, or git.

### 2. Apply the migrations + seed
```bash
cd khatuliswa-resto-cloudflare
npx supabase link --project-ref YOUR_PROJECT_REF   # needs a Supabase access token
npx supabase db push                                # 001_init.sql + 002_v2_members.sql
```
Or Dashboard → **SQL Editor**: paste `001_init.sql`, run; then
`002_v2_members.sql`, run; then `seed.sql`, run (seed = the real
menu; only on a fresh project, never on one with live data).
Verify in Table Editor: `settings` shows `restaurant_name =
Khatulistiwa Resto`, `currency = LE`, `loyalty_rate = 10`;
`products` has 45 rows; `customers` has the new columns.

### 3. Deploy the Edge Functions + secrets
```bash
supabase secrets set STAFF_SESSION_SECRET="$(openssl rand -hex 32)"
supabase functions deploy submit-online-order
supabase functions deploy lookup-customer
supabase functions deploy upsert-customer
supabase functions deploy display-transactions
supabase functions deploy staff-api
supabase functions deploy track-order
supabase functions deploy member-sync
```
`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
are injected automatically for deployed functions.

### 4. Enable Google Auth (user)
1. Supabase Dashboard → **Authentication → Providers → Google** →
   enable, paste the Google Cloud OAuth client ID + secret
   (Google Cloud Console → APIs & Services → Credentials →
   Create OAuth client ID, type Web application).
2. In the same Google OAuth client, add as **Authorized JavaScript
   origin** the Cloudflare Pages domain from step 5
   (e.g. `https://khatulistiwa-resto.pages.dev`), and as
   **Authorized redirect URI**
   `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`.
3. Supabase Dashboard → **Authentication → URL Configuration** →
   add the Pages domain to **Redirect URLs**.

### 5. Deploy to Cloudflare Pages (user connects the account)
1. Push this folder's `public/` contents to a GitHub repo
   (e.g. `ghizaazz4-create/khatulistiwa-resto-v2`), **or** connect
   Cloudflare to the repo directly.
2. Cloudflare Dashboard → **Workers & Pages → Create → Pages →
   Connect to Git** → pick the repo → Framework preset: **None** →
   Build command: *(empty)* → Build output directory: `public`
   (or set the project root to `public/` and leave the output
   empty) → **Save and Deploy**.
3. The site goes live at
   `https://khatulistiwa-resto.pages.dev` (project name can be
   changed in Pages → Settings; a custom domain can be added later).
4. Edit `public/config.js` with the real Project URL + anon key
   (commit + redeploy, or set it before the first deploy).
5. First test: open `?view=online` (menu loads, 44 products),
   place a **test** order with a test phone (order records as
   Pending, WhatsApp opens), open the tracking link, change the
   status in Kitchen, and watch the link update within 15 s.

### 6. Before sharing the link widely
- Change `void_pin` / `kitchen_pin` (still `000000` defaults) and
  the demo employee PINs (`111111` / `080901`) in Settings.
- Replace the placeholder PWA icons (`assets/icons/`) with the real
  Khatulistiwa logo, and replace any Unsplash photo you don't like
  (edit `image_url` in Products, or upload to Storage `assets`).
- Decide the Susu Kambing price: it is still the legacy `10000`
  from the template data (flagged 2026-11-26, never confirmed).
- No rate limiting / CAPTCHA on the public order function yet —
  add Cloudflare Turnstile before publishing widely if abuse
  becomes a problem.

## Supabase Free plan — limits (checked Nov 2026, supabase.com/docs)

| Resource | Free plan | What it means for this resto |
|---|---|---|
| Price | $0/month | No time limit, not a trial. |
| Database size | **500 MB per project** | 44 products + orders: each order is a few KB. 500 MB is roughly **100,000+ orders** before it matters. First limit to watch only after years of orders. |
| Egress (bandwidth) | **5 GB/month** (+ 5 GB cached) | Menu + photos come mostly from Unsplash/Cloudflare, not Supabase. 5 GB is ~50,000+ page loads of API data. Fine. |
| File storage | **1 GB** | Product/logo uploads to the `assets` bucket. 1 GB is thousands of photos. Fine. |
| Monthly active users (Auth) | **50,000 MAU** | Google members counted only when they sign in that month. A resto will not come close. |
| Edge Function invocations | **500,000/month** | Each order / lookup / status check is 1 call. 500k is ~16,000 orders a day. Fine. |
| Realtime connections | 200 concurrent | Not used by v2 (tracking polls every 15 s instead). |
| Active projects | **2** | One project is enough for this app. |
| **Pausing** | **Projects pause after 1 week of inactivity** | The main Free-plan catch: if nobody opens the app for a week, Supabase pauses the project and the first visit after that is slow / needs a wake-up (Dashboard → Resume). A resto with daily orders will not pause; a quiet week will. |
| Backups | None on Free | Export the data regularly (Table Editor → Export, or `pg_dump`). Pro ($25/mo) adds 7-day backups, 8 GB disk, 2M function calls, never pauses. |

**Bottom line:** the Free plan is far more than enough for this
resto's order volume. The limits that could ever bite are database
size (after very many orders) and pausing after a quiet week — both
fixed by upgrading to Pro ($25/month) only when needed.

## Can Supabase be moved / migrated away later? Yes.

Nothing here locks the resto in:
- **Data is plain Postgres.** Export any time: Supabase Dashboard →
  Database → Backups (Pro) or `pg_dump` / Table Editor CSV export
  (Free). The tables are ordinary tables (`products`, `customers`,
  `transactions`, `settings`) — they import into any other Postgres,
  or into MySQL/SQLite with a standard migration tool.
- **Edge Functions are plain Deno/TypeScript** (`supabase/functions/`)
  using the Supabase JS client. The same logic ports to any Node/Deno
  host (Cloudflare Workers, Vercel Functions, a VPS) by swapping the
  client for a Postgres driver.
- **The frontend is static** (`public/`). It only talks to Supabase
  through `public/config.js` + `public/js/supabaseApi.js`. Pointing
  it at a different backend means rewriting that one API layer, not
  the UI.
- **Auth is standard OAuth (Google).** Member identities are Google
  accounts; the link to a customer is the `google_id` / email stored
  in `customers`, which exports with the data.
- **What would NOT move automatically:** Supabase Auth user passwords
  (not used here — Google only), Storage files (export from the
  `assets` bucket), and Realtime/Edge Function hosting config
  (re-created on the new host). The v1 Apps Script + Sheet system is
  also still intact as a fallback — the two systems do not sync, so
  a cutover is one direction at a time.

## Verification done locally (2026-11-27)

- **JS:** `node --check` passes on `public/config.js`,
  `public/js/supabaseClient.js`, `public/js/supabaseApi.js`,
  `public/js/app.js`.
- **SQL:** `supabase/migrations/001_init.sql` (reused, parsed clean
  in the v1 scaffold) and `002_v2_members.sql` + `seed.sql` checked
  by statement count / column reference review; **not executed
  against a live Postgres** (no Docker/local Postgres in the
  sandbox) — the first live check is step 2 above.
- **Edge Functions:** TypeScript files written against the same
  `_shared/` helpers as the v1 scaffold (which bundled cleanly with
  esbuild); not executed against a live project.
- **Seed:** 45 product rows, 7 category rows (counted from the
  generated file); all prices match the Sheet/posters; every product
  has a real Unsplash `image_url` (no `150x150` placeholder).
- **Grep:** no `google.script.run` / `SpreadsheetApp` in any code
  file under this folder (the words appear only in this README,
  documenting the v1 system).
- **Demo mode (2026-11-27):** `demo-data.js` generated from `seed.sql`
  (45 products, 7 categories — counted, and loaded in Node: all
  Active, stock 100, Unsplash images). A stubbed-DOM Node harness
  (`/tmp/test_demo.js`, 15 checks, all passed) booted the app with
  `SUPABASE_CONFIGURED = false`: menu + prices + hero render, demo
  banner visible, no load error; a demo submit opened
  `wa.me/201515041807` with a `DEMO-XXXXXX` id, the demo-notice line,
  and **no** tracking link; cart cleared; order view showed the local
  demo order + demo notice. Not tested in a real browser — first
  live check is step 5 above, on the Pages link.
- **Not tested live:** no Supabase project, no Cloudflare deploy,
  no Google OAuth client, no real order — the first live test is
  step 5 above. Do the first real test with a test product/customer,
  not a live order.
