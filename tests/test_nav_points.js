// Verifikasi tukar-poin + navbar Stitch island (stub-DOM, sekali jalan).
const fs = require("fs");
const vm = require("vm");
const base = "/home/hatch/workspace/khatuliswa-resto-cloudflare/public";

function makeEl(id) {
  const el = {
    id, innerHTML: "", textContent: "", value: "", style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    querySelectorAll() { return []; }, querySelector() { return null; }, appendChild() {}, focus() {}, click() {},
  };
  return el;
}
const els = {};
function getEl(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; }
let domReady = null;
const sandbox = {
  console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  URLSearchParams, URL,
  location: { search: "", origin: "https://khatulistiwa-resto-v2.pages.dev", pathname: "/" },
  history: { pushState() {}, replaceState() {} },
  localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  navigator: {},
  alert: () => {}, window: null, document: null, supabase: undefined,
  addEventListener() {}, removeEventListener() {}, scrollTo() {},
};
sandbox.window = sandbox;
sandbox.document = {
  getElementById: getEl,
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => makeEl("x"),
  addEventListener: (ev, fn) => { if (ev === "DOMContentLoaded") domReady = fn; },
  body: makeEl("body"), documentElement: makeEl("html"),
};
vm.createContext(sandbox);
function load(f) { vm.runInContext(fs.readFileSync(base + "/" + f, "utf8"), sandbox, { filename: f }); }
load("config.js");
load("js/demo-data.js");
load("js/supabaseClient.js");
load("js/supabaseApi.js");
load("js/app.js");

let pass = 0, fail = 0;
function check(name, ok) { console.log((ok ? "PASS " : "FAIL ") + name); ok ? pass++ : fail++; }

(async () => {
  await domReady();
  await new Promise(r => setTimeout(r, 50));
  const html = els["app"].innerHTML;
  const tukar = (html.match(/Tukar \d+ Pts/g) || []);
  const tukarVals = [...new Set(tukar)];
  check("tombol Tukar Pts hanya untuk 4 menu reward (nilai unik: " + tukarVals.join(", ") + ")", tukarVals.length === 3 && tukarVals.includes("Tukar 60 Pts") && tukarVals.includes("Tukar 65 Pts") && tukarVals.includes("Tukar 80 Pts"));
  check("Tukar Pts hanya untuk Matcha/Thai Tea/Kopi Susu Khatulistiwa/Dimsum Ori",
    ["Matcha", "Thai Tea", "Kopi Susu Khatulistiwa", "Dimsum Goreng Ori"].every(n => html.includes("Tukar") && html.includes(n)) &&
    !html.includes("Tukar 90 Pts") && !html.includes("Tukar 110 Pts"));
  check("44 produk tetap tampil", (html.match(/Koleksi Menu Nusantara/) || []).length === 1 && html.includes("44 Pilihan"));
  check("tidak ada badge/harga poin di kartu biasa", !html.includes(" Pts</span>"));

  sandbox.App.go("rewards");
  await new Promise(r => setTimeout(r, 20));
  const rw = els["app"].innerHTML;
  const tukarRw = (rw.match(/>Tukar</g) || []).length;
  check("Rewards hanya 4 kartu tukar (" + tukarRw + ")", tukarRw === 4);
  check("Rewards tidak menyebut Silver/Gold/tier", !/Silver|Gold|Platinum|TIER/i.test(rw));

  // Navbar: floating island Stitch
  const idx = fs.readFileSync(base + "/index.html", "utf8");
  check("navbar floating island putih frosted", idx.includes("bg-surface-container-lowest/95") && idx.includes("backdrop-blur-xl") && idx.includes("rounded-2xl"));
  check("navbar Order squircle hijau gelap terangkat", idx.includes("rounded-2xl bg-primary-container") && idx.includes("-mt-4") && idx.includes("ring-surface-container-lowest"));
  check("navbar indikator pil mint #c6ebd8", idx.includes("#c6ebd8") && idx.includes("nav-ico"));
  check("navbar label Beranda/Menu/Hadiah/Profil", ["Beranda", "Menu", "Hadiah", "Profil"].every(s => idx.includes(">" + s + "<")));
  check("navbar bar hijau gelap penuh sudah tidak ada", !idx.includes("bg-[#163B2C]") && !idx.includes("rounded-t-[28px]") && !idx.includes("bg-[#C7D957]"));
  check("floating cart bar masih ada", idx.includes('id="floating-cart"'));
  check("semua id yang dipakai app.js ada di index.html",
    ["app", "app-header", "bottom-nav", "search-input", "track-modal", "cart-drawer", "cart-items", "cart-totals", "cart-footer", "checkout-form", "co-name", "co-phone", "co-address", "co-accept", "co-summary", "co-error", "co-idr", "staff-login", "staff-employee", "staff-pin", "header-avatar", "cart-badge", "floating-cart"].every(id => idx.includes('id="' + id + '"')));

  // Checkout inline: tidak ada lagi pop-up checkout kedua
  check("tidak ada lagi checkout-modal di index.html", !idx.includes("checkout-modal") && !idx.includes("closeCheckout"));
  check("form checkout ada di dalam cart-drawer",
    idx.indexOf('id="cart-drawer"') < idx.indexOf('id="checkout-form"') && idx.indexOf('id="checkout-form"') < idx.indexOf('id="cart-footer"'));
  check("tombol Accept ada di footer drawer (submitOrder)", idx.includes('id="co-accept"') && idx.includes('onclick="App.submitOrder()"'));
  // Header: tombol bintang dihapus, Lacak + Profil tetap
  check("tombol bintang header dihapus", !idx.includes("header-points") && !idx.includes("Poin saya"));
  check("tombol Lacak dan Profil di header tetap ada", idx.includes("Lacak Pesanan") && idx.includes("App.go('profile')"));
  // Hero subtitle dua baris
  check("subtitle dua baris: Cuisine of Indonesia + Est. 2025 Egypt kecil",
    idx.includes("Cuisine of Indonesia") && idx.includes("Est. 2025 Egypt") && idx.includes("text-[10px]") && !idx.includes("Cuisine of Indonesia • Est. 2025 Egypt"));
  // Kartu produk bisa diklik + Tukar Pts stopPropagation
  const appSrc = fs.readFileSync(base + "/js/app.js", "utf8");
  check("kartu produk bisa diklik (onclick addToCart + cursor-pointer)", html.includes("cursor-pointer") && appSrc.includes('onclick="App.addToCart('));
  check("tombol Tukar Pts / + stopPropagation (tidak dobel tambah)", (appSrc.match(/event\.stopPropagation\(\);App\.addToCart/g) || []).length >= 3);
  // Populer tanpa item Hadiah
  const popStart = html.indexOf("Pilihan Populer");
  const popEnd = html.indexOf("KHATULISTIWA REWARDS", popStart);
  const popSlice = popStart >= 0 && popEnd > popStart ? html.slice(popStart, popEnd) : "";
  check("Pilihan Populer tanpa item Hadiah (tanpa Tukar Pts)", popSlice.length > 0 && !popSlice.includes("Tukar"));
  check("Pilihan Populer tetap tampil (NG01/NG05/ST03/CD14)", ["Nasi Gaol Ayam Bakar", "Nasi Gaol Ayam Geprek", "Soup Tomyam Ayam", "Kopi Susu (Cold)"].every(n => popSlice.includes(n)));

  // Alur keranjang → checkout inline (mode demo)
  // el() aman bila elemen belum pernah dibuat stub DOM (mis. Supabase offline).
  function el(id) { return els[id] || { innerHTML: "", classList: { contains: () => false } }; }
  sandbox.App.toggleCart(true);
  await new Promise(r => setTimeout(r, 20));
  check("form checkout tersembunyi saat keranjang kosong", el("checkout-form").classList.contains("hidden"));
  check("footer Accept tersembunyi saat keranjang kosong", el("cart-footer").classList.contains("hidden"));
  sandbox.App.addToCart("P-NG01");
  await new Promise(r => setTimeout(r, 20));
  check("tambah ke keranjang dari kartu (addToCart)", el("cart-items").innerHTML.includes("Nasi Gaol Ayam Bakar"));
  check("form checkout tampil saat keranjang berisi", !el("checkout-form").classList.contains("hidden"));
  check("footer Accept tampil saat keranjang berisi", !el("cart-footer").classList.contains("hidden"));
  check("ringkasan checkout terisi", el("co-summary").innerHTML.includes("Total Pembayaran"));

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
