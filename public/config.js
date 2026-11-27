// Khatulistiwa Resto v2 — Supabase + Cloudflare Pages configuration.
// >>> FILL THESE IN AFTER CREATING YOUR SUPABASE PROJECT. <<<
//   Supabase Dashboard -> Project Settings -> API:
//     Project URL  -> SUPABASE_URL
//     anon public  -> SUPABASE_ANON_KEY   (safe to ship in the browser;
//                                          RLS limits what it can do)
// NEVER put the service_role key in this file, in the frontend, or in git.
// The service_role key lives ONLY as an Edge Function secret.
// Google login: enable the Google provider in Supabase Dashboard ->
// Authentication -> Providers -> Google, and add the Cloudflare Pages
// domain (e.g. https://khatulistiwa-resto.pages.dev) to
// Authentication -> URL Configuration -> Redirect URLs, plus the same
// domain in the Google Cloud OAuth client as an authorized origin.
// Admin WhatsApp (public number, used to build the wa.me order link):
window.KHATULISTIWA_CONFIG = {
  whatsappAdminPhone: "201515041807",
};
window.SUPABASE_CONFIG = {
  url: "https://khlthmmhjajtfazqgpbf.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtobHRobW1oamFqdGZhenFncGJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3MzIwOTYsImV4cCI6MjExMTMwODA5Nn0.eRTbCNLej-mdzShorOhC6Tf0U8VHVd2oGsvGMWlN8Hg",
};
