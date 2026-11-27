-- Khatulistiwa Resto v2 — REAL menu seed (replaces the demo seed).
-- Source: the two Instagram menu posters (khatulistiwa.egy, 16 April & 19 September),
-- verified against the live Google Sheet on 2026-11-26. Prices in LE (EGP).
-- All products: stock_source 'Regular', stock 100, status 'Active'.
-- point_price = price in points (1 point per 10 LE spent, loyalty_rate = 10),
-- so any item can be redeemed for its LE price in points.
-- Images are Unsplash stock photos (real URLs, no placeholders). Replace any
-- image_url later via the admin Products form (uploads go to Storage 'assets').
-- Apply AFTER supabase/migrations/001_init.sql and 002_v2_members.sql,
-- with: psql / SQL Editor. Do NOT run on a project that already has live data
-- imported from the Sheet — this seed IS that live menu.

insert into public.categories (id, name, description, product_count, variations_json) values
  ('CAT-NA01', 'Nasi Gaol', '', 0, '[]'::jsonb),
  ('CAT-SO02', 'Soup Tomyam', '', 0, '[]'::jsonb),
  ('CAT-CE03', 'Cemilan', '', 0, '[]'::jsonb),
  ('CAT-CL04', 'Classic Drink', '', 0, '[]'::jsonb),
  ('CAT-PR05', 'Premium Drink', '', 0, '[]'::jsonb),
  ('CAT-EX06', 'Extra Topping', '', 0, '[]'::jsonb),
  ('CAT-FR07', 'Fresh Milk', '', 0, '[]'::jsonb);

insert into public.products (id, sku, name, category, price, cost, stock, status, image_url, point_price, stock_source, recipe_json) values
  ('P-NG01', 'NG01', 'Nasi Gaol / Ayam Bakar', 'Nasi Gaol', 90, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=400&q=80', 90, 'Regular', '[]'::jsonb),
  ('P-NG02', 'NG02', 'Nasi Gaol / Ayam Ketumbar', 'Nasi Gaol', 90, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1598103442097-8b74394b95c2?auto=format&fit=crop&w=400&q=80', 90, 'Regular', '[]'::jsonb),
  ('P-NG03', 'NG03', 'Nasi Gaol / Ayam Goreng', 'Nasi Gaol', 90, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1569058242253-92a9c755a0ec?auto=format&fit=crop&w=400&q=80', 90, 'Regular', '[]'::jsonb),
  ('P-NG04', 'NG04', 'Nasi Gaol / Ayam Krispi', 'Nasi Gaol', 90, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1562967916-eb82221dfb92?auto=format&fit=crop&w=400&q=80', 90, 'Regular', '[]'::jsonb),
  ('P-NG05', 'NG05', 'Nasi Gaol / Ayam Geprek', 'Nasi Gaol', 90, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=400&q=80', 90, 'Regular', '[]'::jsonb),
  ('P-NG06', 'NG06', 'Nasi Gaol / Ikan Bakar', 'Nasi Gaol', 85, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=400&q=80', 85, 'Regular', '[]'::jsonb),
  ('P-NG07', 'NG07', 'Nasi Gaol / Ikan Goreng', 'Nasi Gaol', 85, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1519708227418-62fadb3f1d27?auto=format&fit=crop&w=400&q=80', 85, 'Regular', '[]'::jsonb),
  ('P-ST01', 'ST01', 'Soup Mee Tomyam', 'Soup Tomyam', 70, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=400&q=80', 70, 'Regular', '[]'::jsonb),
  ('P-ST02', 'ST02', 'Soup Mee Tomyam Ayam', 'Soup Tomyam', 80, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=400&q=80', 80, 'Regular', '[]'::jsonb),
  ('P-ST03', 'ST03', 'Soup Tomyam Ayam', 'Soup Tomyam', 100, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=400&q=80', 100, 'Regular', '[]'::jsonb),
  ('P-ST04', 'ST04', 'Soup Tomyam Sapi', 'Soup Tomyam', 110, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=400&q=80', 110, 'Regular', '[]'::jsonb),
  ('P-CM01', 'CM01', 'Dimsum Goreng Ori (Isi 5 Pieces)', 'Cemilan', 80, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=400&q=80', 80, 'Regular', '[]'::jsonb),
  ('P-CM02', 'CM02', 'Dimsum Goreng Mozarella (Isi 4 Pieces)', 'Cemilan', 90, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=400&q=80', 90, 'Regular', '[]'::jsonb),
  ('P-CM03', 'CM03', 'Dimsum Goreng Combo (Isi 3 Ori & 2 Moza)', 'Cemilan', 100, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1562967916-eb82221dfb92?auto=format&fit=crop&w=400&q=80', 100, 'Regular', '[]'::jsonb),
  ('P-CM04', 'CM04', 'Pisang Goreng Khatulistiwa (Isi 8 Pieces)', 'Cemilan', 65, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1484723091739-30a097e8f929?auto=format&fit=crop&w=400&q=80', 65, 'Regular', '[]'::jsonb),
  ('P-CM05', 'CM05', 'Ceker Mercon (Isi 5 Pieces)', 'Cemilan', 60, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=400&q=80', 60, 'Regular', '[]'::jsonb),
  ('P-CM06', 'CM06', 'Kerupuk Basah', 'Cemilan', 85, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?auto=format&fit=crop&w=400&q=80', 85, 'Regular', '[]'::jsonb),
  ('P-CM07', 'CM07', 'Choipan (Isi 5 Pieces)', 'Cemilan', 85, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?auto=format&fit=crop&w=400&q=80', 85, 'Regular', '[]'::jsonb),
  ('P-CD01', 'CD01', 'Tea (Hot)', 'Classic Drink', 20, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?auto=format&fit=crop&w=400&q=80', 20, 'Regular', '[]'::jsonb),
  ('P-CD02', 'CD02', 'Tea (Cold)', 'Classic Drink', 25, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=400&q=80', 25, 'Regular', '[]'::jsonb),
  ('P-CD03', 'CD03', 'Lemon (Hot)', 'Classic Drink', 20, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=400&q=80', 20, 'Regular', '[]'::jsonb),
  ('P-CD04', 'CD04', 'Lemon (Cold)', 'Classic Drink', 25, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=400&q=80', 25, 'Regular', '[]'::jsonb),
  ('P-CD05', 'CD05', 'Lemon Tea (Hot)', 'Classic Drink', 25, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1564890369478-c89ca6d9cde9?auto=format&fit=crop&w=400&q=80', 25, 'Regular', '[]'::jsonb),
  ('P-CD06', 'CD06', 'Lemon Tea (Cold)', 'Classic Drink', 30, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=400&q=80', 30, 'Regular', '[]'::jsonb),
  ('P-CD07', 'CD07', 'Susu (Hot)', 'Classic Drink', 30, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=400&q=80', 30, 'Regular', '[]'::jsonb),
  ('P-CD08', 'CD08', 'Susu (Cold)', 'Classic Drink', 35, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=400&q=80', 35, 'Regular', '[]'::jsonb),
  ('P-CD09', 'CD09', 'Es Bandung (Cold)', 'Classic Drink', 40, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=400&q=80', 40, 'Regular', '[]'::jsonb),
  ('P-CD10', 'CD10', 'Nescafe (Hot)', 'Classic Drink', 30, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=400&q=80', 30, 'Regular', '[]'::jsonb),
  ('P-CD11', 'CD11', 'Nescafe (Cold)', 'Classic Drink', 35, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=400&q=80', 35, 'Regular', '[]'::jsonb),
  ('P-CD12', 'CD12', 'Kopi Hitam (Hot)', 'Classic Drink', 35, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&w=400&q=80', 35, 'Regular', '[]'::jsonb),
  ('P-CD13', 'CD13', 'Kopi Susu (Hot)', 'Classic Drink', 40, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=400&q=80', 40, 'Regular', '[]'::jsonb),
  ('P-CD14', 'CD14', 'Kopi Susu (Cold)', 'Classic Drink', 45, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=400&q=80', 45, 'Regular', '[]'::jsonb),
  ('P-CD15', 'CD15', 'Faransawi (Hot)', 'Classic Drink', 45, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=400&q=80', 45, 'Regular', '[]'::jsonb),
  ('P-PD01', 'PD01', 'Thai Tea', 'Premium Drink', 65, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1558857563-b3710334f72d?auto=format&fit=crop&w=400&q=80', 65, 'Regular', '[]'::jsonb),
  ('P-PD02', 'PD02', 'Green Tea', 'Premium Drink', 65, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1564890369478-c89ca6d9cde9?auto=format&fit=crop&w=400&q=80', 65, 'Regular', '[]'::jsonb),
  ('P-PD03', 'PD03', 'Matcha', 'Premium Drink', 80, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?auto=format&fit=crop&w=400&q=80', 80, 'Regular', '[]'::jsonb),
  ('P-PD04', 'PD04', 'Matcha Strawberry', 'Premium Drink', 90, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1497534446932-c925b458314e?auto=format&fit=crop&w=400&q=80', 90, 'Regular', '[]'::jsonb),
  ('P-PD05', 'PD05', 'Strawberry Milk', 'Premium Drink', 60, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1497534446932-c925b458314e?auto=format&fit=crop&w=400&q=80', 60, 'Regular', '[]'::jsonb),
  ('P-PD06', 'PD06', 'Redvelvet', 'Premium Drink', 80, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=400&q=80', 80, 'Regular', '[]'::jsonb),
  ('P-PD07', 'PD07', 'Dark Chocolate', 'Premium Drink', 80, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1542990253-a781e04c0082?auto=format&fit=crop&w=400&q=80', 80, 'Regular', '[]'::jsonb),
  ('P-PD08', 'PD08', 'Kopi Susu Khatulistiwa', 'Premium Drink', 60, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=400&q=80', 60, 'Regular', '[]'::jsonb),
  ('P-PD09', 'PD09', 'Kopi Susu Gula Aren', 'Premium Drink', 70, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?auto=format&fit=crop&w=400&q=80', 70, 'Regular', '[]'::jsonb),
  ('P-ET01', 'ET01', 'Boba (Brown Sugar)', 'Extra Topping', 25, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1558857563-b3710334f72d?auto=format&fit=crop&w=400&q=80', 25, 'Regular', '[]'::jsonb),
  ('P-ET02', 'ET02', 'Jelly Cincau', 'Extra Topping', 15, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=400&q=80', 15, 'Regular', '[]'::jsonb),
  ('P-FM01', 'FM01', 'Susu Kambing', 'Fresh Milk', 10000, NULL, 100, 'Active', 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=400&q=80', 10000, 'Regular', '[]'::jsonb);

-- Staff login (PINs are SHA-256 of the demo PINs — CHANGE THEM before production).
-- E01 Admin Demo PIN 111111, E02/E03/E04 PIN 080901 (same as the v1 scaffold).
insert into public.employees (id, name, role, pin_hash, image_url) values
  ('E01', 'Pak Surya Andika', 'Admin Demo', 'bcb15f821479b4d5772bd0ca866c00ad5f926e3580720659cc80d39c9d09802a', 'https://i.pravatar.cc/150?img=11'),
  ('E02', 'Mbak Fitri Lestari', 'Admin', '24beb86d71dd2844c2876196e0cdcd4d577f55a7cd3d77e4c0b1bf44522c8ae4', 'https://i.pravatar.cc/150?img=21'),
  ('E03', 'Mas Bagas Nugroho', 'Supervisor', '24beb86d71dd2844c2876196e0cdcd4d577f55a7cd3d77e4c0b1bf44522c8ae4', 'https://i.pravatar.cc/150?img=33'),
  ('E04', 'Mbak Sari Dewi', 'Staff', '24beb86d71dd2844c2876196e0cdcd4d577f55a7cd3d77e4c0b1bf44522c8ae4', 'https://i.pravatar.cc/150?img=44');
