-- 004_service_role_grants.sql
-- Service-role (yang dipakai semua Edge Function lewat serviceClient())
-- ternyata TIDAK punya hak baca/tulis tabel: di project ini service_role
-- hanya punya REFERENCES/TRIGGER/TRUNCATE, sehingga semua function yang
-- menyentuh DB gagal ("permission denied for table transactions",
-- verifyPin "Employee not found"). Penyebab: tabel dibuat tanpa GRANT ke
-- service_role, dan RLS saja tidak cukup — PostgREST tetap butuh hak
-- level tabel. Perbaikan ini memberi service_role hak DML penuh atas
-- semua tabel + sequence yang ada sekarang dan yang dibuat kemudian.
-- Diterapkan live 2026-11-27; anon tetap hanya bisa SELECT
-- products/categories/settings (lihat 001 + perbaikan GRANT anon).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role;
