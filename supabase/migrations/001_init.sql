-- =============================================================================
-- Khatulistiwa Resto — Supabase migration 001_init
-- Source of truth: ~/workspace/khatuliswa-resto/Kode.js
--   setupDatabase() headers, seedDummyData() rows, getAppData() / getTransactions()
--   mappings, submitOrder() write order, updateTransactionStatus(), verifyPin(),
--   lookupCustomerByPhone() / upsertCustomerByPhone().
--   Spreadsheet: 1JtY8tMZX04H3DED56jrd8o_DBJ9oo9CR6GnWM9KN_2k
--   Apps Script project: 1aUnHVsJiEhfwaq8Viy0OIBxNWX22ufdJo7L_nxOn6tebo2YXJPGquMo3
--
-- READ MIGRATION_NOTES.md FIRST. The original has three different column
-- layouts for the same sheets (setupDatabase() header row, seedDummyData()
-- rows, and getAppData()/getTransactions() index mapping) that disagree by
-- one column in Products, Categories and Customers. This migration uses ONE
-- canonical layout (the header names, snake_cased) and the import guide in
-- README.md maps live Sheet rows into it by header name, NOT by position.
-- Apply with:  supabase db push   (linked project)   OR paste into the
-- Supabase Dashboard SQL Editor. No real keys are in this repo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.normalize_phone_digits(p text)
returns text language sql immutable as $$
  select regexp_replace(coalesce(p, ''), '\D', '', 'g');
$$;

-- Daily transaction id, YYMMDD-XXX, exactly like submitOrder() in Kode.js.
-- The advisory lock serialises id generation inside a transaction so two
-- simultaneous online orders cannot receive the same id (the original read
-- the last row and incremented it with no lock, so it could collide).
create or replace function public.next_transaction_id()
returns text language plpgsql as $$
declare
  prefix text := to_char(now(), 'YYMMDD');
  n int;
begin
  perform pg_advisory_xact_lock(727271);
  select coalesce(max((regexp_match(id, '^' || prefix || '-(\d+)$'))[1]::int), 0) + 1
    into n
    from public.transactions
   where id like prefix || '-%';
  return prefix || '-' || lpad(n::text, 3, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- Settings  (Sheet: Settings, key/value — no id column in the original)
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Customers  (Sheet: Customers)
-- Header: id, name, phone, email, address, total_purchases, last_visit,
--         created_at, points.
-- phone_digits is a stored generated column used for the tolerant phone
-- match in lookupCustomerByPhone()/phonesMatch() (trailing 10 digits).
-- email is KEPT (the original sheet has it). Only the online order FORM
-- replaces the email field with address; no column is deleted.
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id              text primary key,
  name            text not null default '',
  phone           text not null default '',
  phone_digits    text generated always as (regexp_replace(coalesce(phone, ''), '\D', '', 'g')) stored,
  email           text not null default '',
  address         text not null default '',
  total_purchases numeric not null default 0,
  last_visit      timestamptz,
  created_at      timestamptz not null default now(),
  points          integer not null default 0,
  updated_at      timestamptz not null default now()
);
create unique index if not exists customers_phone_digits_idx
  on public.customers (phone_digits) where phone_digits <> '';
create index if not exists customers_last_visit_idx on public.customers (last_visit desc);

-- ---------------------------------------------------------------------------
-- Products  (Sheet: Products)
-- Header: id, sku, name, category, price, cost, stock, status, imageUrl,
--         point_price, stock_source, recipe_json.
-- WARNING (see MIGRATION_NOTES.md §1): seedDummyData() rows have only 11
-- values and NO cost, so in the live Sheet the data rows are shifted one
-- column left of the header (imageUrl sits under `cost`, etc.) and
-- getAppData() reads that shifted layout. The canonical columns below are
-- the header names; cost is nullable and is null for every seeded product.
-- recipe_json is stored as jsonb: [{id: <ingredient id>, amount: <number>}].
-- stock is numeric and NULLABLE: null means "unlimited / not tracked",
-- exactly as submitOrder() treats an empty stock cell.
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id           text primary key,
  sku          text not null default '',
  name         text not null,
  category     text not null default '',
  price        numeric not null default 0,
  cost         numeric,
  stock        numeric,
  status       text not null default 'Active',
  image_url    text not null default '',
  point_price  numeric not null default 0,
  stock_source text not null default 'Regular'
             check (stock_source in ('Regular', 'Ingredients')),
  recipe_json  jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists products_category_idx on public.products (category);
create index if not exists products_status_idx on public.products (status);

-- ---------------------------------------------------------------------------
-- Categories  (Sheet: Categories)
-- Header: id, name, description, product_count, variations_json.
-- variations_json: [{name, options: [{label, price}]}] (seed layout).
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id              text primary key,
  name            text not null,
  description     text not null default '',
  product_count   integer not null default 0,
  variations_json jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Employees  (Sheet: Employees — the sheet used for login / PIN)
-- Header: id, name, role, pin_hash, imageUrl.
-- pin_hash is a SHA-256 hex digest (hashPassword() in Kode.js). It is NEVER
-- returned to any client; verifyPin compares it server-side only.
-- ---------------------------------------------------------------------------
create table if not exists public.employees (
  id         text primary key,
  name       text not null,
  role       text not null default 'Staff',
  pin_hash   text not null,
  image_url  text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Staff  (Sheet: Staff — created by setupDatabase(), but NO function in
-- Kode.js ever reads or writes it. Kept 1:1 for parity; almost certainly a
-- legacy duplicate of Employees. Do not merge it silently — see notes.)
-- Header: id, name, email, role, pin_hash, status, last_active, imageUrl.
-- ---------------------------------------------------------------------------
create table if not exists public.staff (
  id          text primary key,
  name        text not null,
  email       text not null default '',
  role        text not null default 'Staff',
  pin_hash    text not null default '',
  status      text not null default 'Active',
  last_active timestamptz,
  image_url   text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ingredients  (Sheet: Ingredients)
-- Header: id, name, unit, stock, min_stock.
-- ---------------------------------------------------------------------------
create table if not exists public.ingredients (
  id        text primary key,
  name      text not null,
  unit      text not null default '',
  stock     numeric not null default 0,
  min_stock numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Transactions  (Sheet: Transactions)
-- Header (15 cols): id, timestamp, items_json, subtotal, tax, total_amount,
--   payment_method, order_type, table_number, customer_id, status,
--   employee_id, completed_at, cash_received, change.
-- EFFECTIVE layout (submitOrder() appendRow + getTransactions() mapping,
-- 13 values): id, timestamp, items_json, total, paymentMethod, orderType,
--   tableNumber, customerId, status, employeeId, "", cashReceived, change.
-- i.e. in the live Sheet the grand total is stored under the `subtotal`
-- header and there is no separate tax column value. This table stores the
-- values CORRECTLY (total_amount = grand total, subtotal/tax/service_charge
-- as computed by the frontend), and the Edge Function writes them that way.
-- items_json is jsonb, not a text blob: each item is the cart item from the
-- frontend {id, name, price, qty, point_price, isRedeemed,
-- selectedVariations, note}. The transaction_items VIEW below expands it
-- for reporting, because the original had no separate items table.
-- status: the original writes 'Pending' or 'Awaiting Approval' (when
-- needsApproval), and the kitchen moves Pending -> Dibuat -> Selesai, plus
-- Diantar for Delivery only. Legacy English statuses (Preparing /
-- Completed) are kept as valid values because the frontend aliases them
-- to the same lanes; new orders must use the Indonesian flow.
-- notes: NOT stored by the original (online notes only went into the
-- WhatsApp text). Stored here when provided, for kitchen visibility.
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id             text primary key,
  timestamp      timestamptz not null default now(),
  items_json     jsonb not null default '[]'::jsonb,
  subtotal       numeric,
  service_charge numeric,
  tax            numeric,
  total_amount   numeric not null default 0,
  payment_method text not null default 'Cash'
                 check (payment_method in ('Cash', 'QRIS', 'Transfer',
                                          'GrabFood', 'GoFood', 'ShopeePay',
                                          'Pending', 'UNPAID')),
  order_type     text not null default 'Take Away',
  table_number   text not null default 'N/A',
  customer_id    text references public.customers (id) on delete set null,
  status         text not null default 'Pending'
                 check (status in ('Pending', 'Awaiting Approval', 'Preparing',
                                   'Dibuat', 'Completed', 'Selesai', 'Diantar',
                                   'Void')),
  employee_id    text not null default 'System',
  completed_at   timestamptz,
  cash_received  numeric not null default 0,
  change         numeric not null default 0,
  needs_approval boolean not null default false,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists transactions_timestamp_idx on public.transactions (timestamp desc);
create index if not exists transactions_status_idx on public.transactions (status);
create index if not exists transactions_customer_idx on public.transactions (customer_id);

-- completed_at mirrors updateTransactionStatus(): set when the status
-- becomes Completed / Selesai / Diantar, cleared otherwise.
create or replace function public.transactions_completed_at_trigger()
returns trigger language plpgsql as $$
begin
  if new.status in ('Completed', 'Selesai', 'Diantar') and old.status is distinct from new.status then
    new.completed_at := now();
  elsif new.status not in ('Completed', 'Selesai', 'Diantar') then
    new.completed_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists transactions_completed_at on public.transactions;
create trigger transactions_completed_at
  before update of status on public.transactions
  for each row execute function public.transactions_completed_at_trigger();

-- ---------------------------------------------------------------------------
-- StaffLogs  (Sheet: StaffLogs)
-- Header: id, employee_id, employee_name, timestamp, action.
-- Original ids are 'LOG-' || epoch millis.
-- ---------------------------------------------------------------------------
create table if not exists public.staff_logs (
  id            text primary key,
  employee_id   text not null,
  employee_name text not null default 'Unknown',
  timestamp     timestamptz not null default now(),
  action        text not null,
  created_at    timestamptz not null default now()
);
create index if not exists staff_logs_employee_idx on public.staff_logs (employee_id, timestamp desc);

-- ---------------------------------------------------------------------------
-- Views (no separate tables in the original — these sheets were never
-- read/written by any Kode.js function; the frontend computes reports from
-- getTransactions(). They exist here as views so old names keep working.)
-- ---------------------------------------------------------------------------
-- History: same columns as Transactions; kept as a view over transactions.
create or replace view public.history as
  select id, timestamp, items_json, subtotal, tax, total_amount,
         payment_method, order_type, table_number, customer_id, status,
         employee_id, completed_at, cash_received, change
    from public.transactions;

-- transaction_items: one row per ordered item, for reports / kitchen lists.
create or replace view public.transaction_items as
  select t.id as transaction_id,
         t.timestamp,
         t.status,
         (item ->> 'id') as product_id,
         (item ->> 'name') as product_name,
         (item ->> 'price')::numeric as unit_price,
         (item ->> 'qty')::numeric as qty,
         ((item ->> 'price')::numeric * (item ->> 'qty')::numeric) as line_total,
         (item ->> 'isRedeemed')::boolean as is_redeemed,
         item -> 'selectedVariations' as selected_variations,
         (item ->> 'note') as note
    from public.transactions t,
         lateral jsonb_array_elements(coalesce(t.items_json, '[]'::jsonb)) as item;

-- daily_reports: the Reports sheet columns, computed, not stored.
-- (top_selling_item is the best-selling product name for that day.)
create or replace view public.daily_reports as
  with daily as (
    select date_trunc('day', timestamp) as day,
           coalesce(sum(total_amount), 0) as total_revenue,
           count(*)::int as total_orders,
           coalesce(avg(total_amount), 0) as avg_order_value
      from public.transactions
     where status <> 'Void'
     group by date_trunc('day', timestamp)
  ),
  top_items as (
    select date_trunc('day', timestamp) as day, product_name,
           sum(qty) as total_qty
      from public.transaction_items
     group by date_trunc('day', timestamp), product_name
  ),
  top_per_day as (
    select distinct on (day) day, product_name
      from top_items
     order by day, total_qty desc
  )
  select to_char(d.day, 'YYYY-MM-DD') as id,
         d.day::date as date,
         d.total_revenue,
         d.total_orders,
         d.avg_order_value,
         t.product_name as top_selling_item
    from daily d
    left join top_per_day t on t.day = d.day;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
do $$
declare tbl text;
begin
  foreach tbl in array array['settings', 'customers', 'products', 'categories',
                              'employees', 'staff', 'ingredients', 'transactions',
                              'staff_logs'] loop
    execute format('drop trigger if exists touch_updated_at on public.%I', tbl);
    -- transactions has its own trigger (which also maintains updated_at)
    if tbl <> 'transactions' then
      execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', tbl);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security — safe baseline (see README.md § "Security model")
-- Trust boundary: the anon key may READ the public menu only. Every write
-- and every read of customers / transactions / employees / logs goes
-- through an Edge Function using the SERVICE_ROLE key, which bypasses RLS.
-- The original app sent ALL settings (including void_pin and kitchen_pin)
-- to every visitor via getAppData(); this migration deliberately does NOT
-- do that: PINs and the WhatsApp API URL are never visible to anon.
-- ---------------------------------------------------------------------------
alter table public.settings     enable row level security;
alter table public.customers    enable row level security;
alter table public.products     enable row level security;
alter table public.categories   enable row level security;
alter table public.employees    enable row level security;
alter table public.staff        enable row level security;
alter table public.ingredients  enable row level security;
alter table public.transactions enable row level security;
alter table public.staff_logs   enable row level security;

-- Public menu: anon can read Active products and all categories.
drop policy if exists "anon reads active products" on public.products;
create policy "anon reads active products" on public.products
  for select to anon using (status = 'Active');
drop policy if exists "anon reads categories" on public.categories;
create policy "anon reads categories" on public.categories
  for select to anon using (true);

-- Public settings: anon can read every setting EXCEPT the secrets.
-- whatsapp_admin_phone is public on purpose: it is the resto's public
-- WhatsApp number and the online client needs it to build the wa.me link.
drop policy if exists "anon reads public settings" on public.settings;
create policy "anon reads public settings" on public.settings
  for select to anon using (key not in ('void_pin', 'kitchen_pin', 'whatsapp_api_url'));

-- Everything else: no anon access at all (Edge Functions use service_role).
-- (No policy = deny for anon/authenticated on customers, transactions,
--  employees, staff, ingredients, staff_logs.)

-- ---------------------------------------------------------------------------
-- Storage bucket for product / logo / employee images
-- (replaces uploadToDrive(), which put files in a Google Drive folder and
-- returned an lh3.googleusercontent.com link). Public read so <img> tags
-- keep working; uploads only via the staff-api Edge Function (service_role).
-- Wrapped in a DO block so this file also parses on a plain Postgres
-- without the storage schema (e.g. in a syntax check).
-- ---------------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('assets', 'assets', true)
  on conflict (id) do nothing;
exception when undefined_table then
  raise notice 'storage.buckets not present — create the public "assets" bucket in the Dashboard (Storage).';
end $$;

do $$
begin
  drop policy if exists "anon reads assets" on storage.objects;
  create policy "anon reads assets" on storage.objects
    for select to anon using (bucket_id = 'assets');
exception when undefined_table then
  raise notice 'storage.objects not present — skipping storage policy.';
end $$;

-- ---------------------------------------------------------------------------
-- Default settings — copied verbatim from setupDatabase() defaultSettings.
-- Cleaned of the original leading-quote quirk: updateSettingsBulk() in
-- Kode.js prepended "'" to any key containing "id"/"pin"/"area" (which is
-- why egp_to_idr_rate was stored as "'327.7"). Values here are stored
-- clean; the frontend's onlineIdrRate() strip is now harmless.
-- SECURITY: void_pin / kitchen_pin below are the ORIGINAL TEMPLATE
-- DEFAULTS ('000000'). Change them in Settings immediately after import.
-- whatsapp_admin_phone is the Khatulistiwa admin number, editable in
-- Settings (Profile/Notifications), exactly as specified.
-- ---------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('restaurant_name', 'GASPOS'),
  ('logo_url', 'https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEihDwaK3HzAZXiiEROzZq3P20vrhw8gVRnlBGY360-jqe8i_DuLdCfr1uerFBgHvi5f7C5SGpNqFqin5REKQlhbvQm3tzsag6wGiUgYeuHVoreC2QtL1gDzO4Vcy5mPbvbsZs2iXmEvxxpVGpT6pfaxcx7r9HsBH62DjUobxEfndBKcV71zPgIS_wBag30/s1600/gaspos-256.png'),
  ('show_receipt_logo', 'true'),
  ('currency', 'EGP'),
  ('business_email', 'hello@gaspos.com'),
  ('business_website_url', ''),
  ('address', 'New Banana Street, Jakarta'),
  ('tax_rate', '10'),
  ('service_charge', '5'),
  ('enable_dine_in', 'true'),
  ('loyalty_rate', '1000'),
  ('void_pin', '000000'),
  ('kitchen_pin', '000000'),
  ('custom_payment_methods', 'GrabFood, GoFood, ShopeePay'),
  ('theme_id', 'bento-warm'),
  ('enable_kitchen_display', 'true'),
  ('enable_queue_status', 'true'),
  ('enable_sound_effects', 'true'),
  ('dine_in_areas', '[{"name":"Indoor","tables":["1","2","3","4","5","6","7","8"]},{"name":"Outdoor Terrace","tables":["9","10","11","12","13"]},{"name":"Private Room","tables":["14","15","16"]},{"name":"Bar Counter","tables":["17","18","19","20","21","22"]}]'),
  ('slider_images', 'https://images.unsplash.com/photo-1510972527921-ce03766a1cf1?auto=format&fit=crop&w=1200&q=80,https://images.unsplash.com/photo-1583354608715-177553a4035e?auto=format&fit=crop&w=1200&q=80,https://images.unsplash.com/photo-1515860734122-e0d771b36d3e?auto=format&fit=crop&w=1200&q=80'),
  ('cash_shortcuts', '5000, 10000, 20000, 25000, 50000, 100000'),
  ('receipt_footer', 'Thank you for visiting!'),
  ('slider_duration', '5000'),
  ('banner_images', 'https://images.unsplash.com/photo-1592178036268-cffc32b23b14?auto=format&fit=crop&w=1200&h=400&q=80,https://images.unsplash.com/photo-1566373049939-704ea187ef98?auto=format&fit=crop&w=1200&h=400&q=80'),
  ('queue_visibility_mins', '60'),
  ('whatsapp_api_url', ''),
  ('default_country_code', '62'),
  ('whatsapp_template', '*RECEIPT: {restaurant_name}*\n--------------------------------\nOrder ID: {order_id}\nDate: {date}\nType: {order_type}\n--------------------------------\n{items}\n--------------------------------\n*TOTAL: {total}*\n\n{footer}'),
  ('whatsapp_admin_phone', '201515041807'),
  ('egp_to_idr_rate', '327.7'),
  ('whatsapp_low_stock_template', '*LOW STOCK ALERT: {restaurant_name}*\n--------------------------------\nProduct: {product_name}\nSKU: {sku}\nCurrent Stock: {stock}\nThreshold: {threshold}\n--------------------------------\nPlease restock immediately.'),
  ('whatsapp_ingredient_low_stock_template', '*INGREDIENT LOW STOCK ALERT: {restaurant_name}*\n--------------------------------\nIngredient: {ingredient_name}\nCurrent Stock: {stock} {unit}\nMinimum Stock: {min_stock} {unit}\n--------------------------------\nPlease restock this ingredient immediately.'),
  ('enable_low_stock_email', 'true'),
  ('enable_ingredient_low_stock_email', 'true'),
  ('low_stock_threshold', '5'),
  ('qris_id', '')
on conflict (key) do nothing;
