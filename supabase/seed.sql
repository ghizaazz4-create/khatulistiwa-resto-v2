-- Khatulistiwa Resto v2 — REAL menu seed (replaces the demo seed).
-- Source: the two Instagram menu posters (khatulistiwa.egy, 16 April & 19 September),
-- verified against the live Google Sheet on 2026-11-26. Prices in LE (EGP).
-- All products: stock_source 'Regular', stock 100, status 'Active'.
-- point_price = price in points (1 point per 10 LE spent, loyalty_rate = 10),
-- so any item can be redeemed for its LE price in points.
-- Images: TIDAK ada foto bawaan (image_url kosong) — foto-foto Unsplash
-- sebelumnya dihapus 2026-11-27 karena bukan foto asli resto. Admin mengisi
-- image_url asli lewat form Products (upload ke Storage 'assets'); selama
-- kosong, aplikasi menampilkan blok tema tanpa foto, bukan foto stok.
-- Apply AFTER supabase/migrations/001_init.sql and 002_v2_members.sql,
-- with: psql / SQL Editor. Do NOT run on a project that already has live data
-- imported from the Sheet — this seed IS that live menu.

insert into public.categories (id, name, description, product_count, variations_json) values
  ('CAT-NA01', 'Nasi Gaol', '', 0, '[]'::jsonb),
  ('CAT-SO02', 'Soup Tomyam', '', 0, '[]'::jsonb),
  ('CAT-CE03', 'Cemilan', '', 0, '[]'::jsonb),
  ('CAT-CL04', 'Classic Drink', '', 0, '[]'::jsonb),
  ('CAT-PR05', 'Premium Drink', '', 0, '[]'::jsonb),
  ('CAT-EX06', 'Extra Topping', '', 0, '[]'::jsonb);

insert into public.products (id, sku, name, category, price, cost, stock, status, image_url, point_price, stock_source, recipe_json) values
  ('P-NG01', 'NG01', 'Nasi Gaol / Ayam Bakar', 'Nasi Gaol', 90, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-NG02', 'NG02', 'Nasi Gaol / Ayam Ketumbar', 'Nasi Gaol', 90, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-NG03', 'NG03', 'Nasi Gaol / Ayam Goreng', 'Nasi Gaol', 90, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-NG04', 'NG04', 'Nasi Gaol / Ayam Krispi', 'Nasi Gaol', 90, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-NG05', 'NG05', 'Nasi Gaol / Ayam Geprek', 'Nasi Gaol', 90, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-NG06', 'NG06', 'Nasi Gaol / Ikan Bakar', 'Nasi Gaol', 85, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-NG07', 'NG07', 'Nasi Gaol / Ikan Goreng', 'Nasi Gaol', 85, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-ST01', 'ST01', 'Soup Mee Tomyam', 'Soup Tomyam', 70, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-ST02', 'ST02', 'Soup Mee Tomyam Ayam', 'Soup Tomyam', 80, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-ST03', 'ST03', 'Soup Tomyam Ayam', 'Soup Tomyam', 100, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-ST04', 'ST04', 'Soup Tomyam Sapi', 'Soup Tomyam', 110, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CM01', 'CM01', 'Dimsum Goreng Ori (Isi 5 Pieces)', 'Cemilan', 80, NULL, 100, 'Active', '', 80, 'Regular', '[]'::jsonb),
  ('P-CM02', 'CM02', 'Dimsum Goreng Mozarella (Isi 4 Pieces)', 'Cemilan', 90, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CM03', 'CM03', 'Dimsum Goreng Combo (Isi 3 Ori & 2 Moza)', 'Cemilan', 100, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CM04', 'CM04', 'Pisang Goreng Khatulistiwa (Isi 8 Pieces)', 'Cemilan', 65, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CM05', 'CM05', 'Ceker Mercon (Isi 5 Pieces)', 'Cemilan', 60, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CM06', 'CM06', 'Kerupuk Basah', 'Cemilan', 85, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CM07', 'CM07', 'Choipan (Isi 5 Pieces)', 'Cemilan', 85, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD01', 'CD01', 'Tea (Hot)', 'Classic Drink', 20, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD02', 'CD02', 'Tea (Cold)', 'Classic Drink', 25, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD03', 'CD03', 'Lemon (Hot)', 'Classic Drink', 20, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD04', 'CD04', 'Lemon (Cold)', 'Classic Drink', 25, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD05', 'CD05', 'Lemon Tea (Hot)', 'Classic Drink', 25, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD06', 'CD06', 'Lemon Tea (Cold)', 'Classic Drink', 30, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD07', 'CD07', 'Susu (Hot)', 'Classic Drink', 30, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD08', 'CD08', 'Susu (Cold)', 'Classic Drink', 35, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD09', 'CD09', 'Es Bandung (Cold)', 'Classic Drink', 40, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD10', 'CD10', 'Nescafe (Hot)', 'Classic Drink', 30, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD11', 'CD11', 'Nescafe (Cold)', 'Classic Drink', 35, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD12', 'CD12', 'Kopi Hitam (Hot)', 'Classic Drink', 35, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD13', 'CD13', 'Kopi Susu (Hot)', 'Classic Drink', 40, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD14', 'CD14', 'Kopi Susu (Cold)', 'Classic Drink', 45, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-CD15', 'CD15', 'Faransawi (Hot)', 'Classic Drink', 45, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-PD01', 'PD01', 'Thai Tea', 'Premium Drink', 65, NULL, 100, 'Active', '', 65, 'Regular', '[]'::jsonb),
  ('P-PD02', 'PD02', 'Green Tea', 'Premium Drink', 65, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-PD03', 'PD03', 'Matcha', 'Premium Drink', 80, NULL, 100, 'Active', '', 80, 'Regular', '[]'::jsonb),
  ('P-PD04', 'PD04', 'Matcha Strawberry', 'Premium Drink', 90, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-PD05', 'PD05', 'Strawberry Milk', 'Premium Drink', 60, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-PD06', 'PD06', 'Redvelvet', 'Premium Drink', 80, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-PD07', 'PD07', 'Dark Chocolate', 'Premium Drink', 80, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-PD08', 'PD08', 'Kopi Susu Khatulistiwa', 'Premium Drink', 60, NULL, 100, 'Active', '', 60, 'Regular', '[]'::jsonb),
  ('P-PD09', 'PD09', 'Kopi Susu Gula Aren', 'Premium Drink', 70, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-ET01', 'ET01', 'Boba (Brown Sugar)', 'Extra Topping', 25, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb),
  ('P-ET02', 'ET02', 'Jelly Cincau', 'Extra Topping', 15, NULL, 100, 'Active', '', 0, 'Regular', '[]'::jsonb);

-- Staff login: PIN semua karyawan = 123456 (SHA-256 di bawah), pilihan user 2026-11-27.
-- Sama dengan void_pin / kitchen_pin di 001_init.sql dan STAFF_SESSION_SECRET.
insert into public.employees (id, name, role, pin_hash, image_url) values
  ('E01', 'Pak Surya Andika', 'Admin Demo', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'https://i.pravatar.cc/150?img=11'),
  ('E02', 'Mbak Fitri Lestari', 'Admin', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'https://i.pravatar.cc/150?img=21'),
  ('E03', 'Mas Bagas Nugroho', 'Supervisor', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'https://i.pravatar.cc/150?img=33'),
  ('E04', 'Mbak Sari Dewi', 'Staff', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'https://i.pravatar.cc/150?img=44');
