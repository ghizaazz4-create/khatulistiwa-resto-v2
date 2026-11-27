-- 003_anon_grants.sql
-- GRANT SELECT ke role anon untuk tabel yang dibaca frontend publik.
-- RLS policy untuk anon sudah ada di 001_init.sql, tapi tanpa GRANT ini
-- PostgREST menolak dengan 401 "permission denied for table ..." —
-- ditemukan saat config.js pertama kali diisi (2026-11-27): grant ini
-- diterapkan langsung ke database live, dan migrasi ini mencatatnya
-- supaya project baru yang menjalankan migrasi dari nol tidak kena 401.
GRANT SELECT ON public.products TO anon;
GRANT SELECT ON public.categories TO anon;
GRANT SELECT ON public.settings TO anon;
