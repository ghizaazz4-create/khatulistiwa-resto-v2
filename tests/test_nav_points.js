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
    ["app", "app-header", "bottom-nav", "search-input", "track-modal", "checkout-modal", "cart-drawer", "cart-items", "cart-totals", "co-name", "co-phone", "co-address", "co-accept", "co-summary", "staff-login", "staff-employee", "staff-pin", "header-points", "header-avatar", "cart-badge", "floating-cart"].every(id => idx.includes('id="' + id + '"')));

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
