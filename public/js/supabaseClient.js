// Creates the public Supabase client from public/config.js.
// The anon key can only read the public menu (products/categories/public
// settings) — see RLS in supabase/migrations/001_init.sql. All writes go
// through Edge Functions (see supabaseApi.js).
(function () {
  var cfg = window.SUPABASE_CONFIG || {};
  var configured = cfg.url && cfg.anonKey &&
    cfg.url.indexOf("YOUR_PROJECT_REF") === -1 &&
    cfg.anonKey.indexOf("YOUR_ANON_KEY") === -1;

  window.SUPABASE_CONFIGURED = !!configured;
  if (!configured) {
    console.warn(
      "[khatulistiwa] Supabase is not configured yet. " +
      "Edit public/config.js with your Project URL and anon key (see README.md). " +
      "The app will load with empty data until then."
    );
    window.supabaseClient = null;
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    console.error("[khatulistiwa] supabase-js failed to load from the CDN.");
    window.supabaseClient = null;
    return;
  }
  window.supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
})();
