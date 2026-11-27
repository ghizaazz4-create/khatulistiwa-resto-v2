/* Khatulistiwa Resto v2 — service worker (PWA, whole app: order + admin).
 * Cache-first for the app shell, network-first for API calls (Supabase).
 * Bump CACHE when shipping a new frontend version. */
const CACHE = "khatulistiwa-v2-1";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./config.js",
  "./js/app.js",
  "./js/supabaseApi.js",
  "./js/supabaseClient.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never cache Supabase API / Edge Function calls — order status must be live.
  if (url.hostname.includes("supabase.co") || url.pathname.includes("/functions/v1/")) return;
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
