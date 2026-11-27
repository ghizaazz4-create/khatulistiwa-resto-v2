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
  // Seed a staff session so boot() restores it (like a reload after PIN login).
  sandbox.localStorage.setItem("bento_session_user", JSON.stringify({ id: "E01", name: "Pak Surya Andika", role: "Admin Demo" }));
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
  check("navbar bar hijau gelap penuh sudah tidak ada", !idx.includes("bg-[#163B2C]") && !idx.includes("rounded-t-[28px]"));
  check("lime #C7D957 hanya di area admin GASPOS (bukan navbar pelanggan)",
    idx.includes("bg-[#C7D957]") && !idx.slice(idx.indexOf('id="bottom-nav"'), idx.indexOf('id="staff-login"')).includes("bg-[#C7D957]"));
  check("floating cart bar masih ada", idx.includes('id="floating-cart"'));
  check("semua id yang dipakai app.js ada di index.html",
    ["app", "app-header", "bottom-nav", "search-input", "track-modal", "cart-drawer", "cart-items", "cart-totals", "cart-footer", "checkout-form", "co-name", "co-phone", "co-address", "co-accept", "co-summary", "co-error", "co-idr", "staff-login", "header-avatar", "cart-badge", "floating-cart",
     "sidebar", "sidebar-toggle", "toggle-icon", "brand-name", "clock-date-part", "clock-time-part", "current-date-clock", "display-menu-btn", "more-menu-btn", "sidebar-online-order-btn", "display-popover", "more-popover",
     "account-selector", "pin-screen", "pin-pad-grid", "selected-employee-avatar", "selected-employee-name", "staff-error", "open-staff-modal", "staff-selection-modal", "employee-list",
     "crud-modal", "crud-title", "crud-fields", "crud-error"].every(id => idx.includes('id="' + id + '"')));

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

  // Tausil 5 LE fixed — hanya untuk Delivery, bukan 5% untuk semua
  const totalsTakeAway = el("cart-totals").innerHTML;
  check("Take Away tanpa baris Tausil (total 90 + pajak 9 = 99 LE)",
    !totalsTakeAway.includes("Tausil") && totalsTakeAway.includes("99 LE"));
  sandbox.App.setOrderType({ getAttribute: (n) => n === "data-v" ? "Delivery" : null });
  await new Promise(r => setTimeout(r, 20));
  const totalsDelivery = el("cart-totals").innerHTML;
  check("Delivery kena Tausil 5 LE fixed (total 90 + 5 + 9 = 104 LE)",
    totalsDelivery.includes("Tausil") && totalsDelivery.includes("5 LE") && totalsDelivery.includes("104 LE"));
  check("ringkasan checkout Delivery juga pakai Tausil",
    el("co-summary").innerHTML.includes("Tausil") && el("co-summary").innerHTML.includes("Termasuk tausil"));
  check("tidak ada lagi label Service 5% / Layanan (%) di app.js/index.html",
    !appSrc.includes("Service 5%") && !appSrc.includes("Layanan (") && !idx.includes("Service 5%"));

  // Validasi checkout: tombol goyang + notifikasi menonjol + scroll ke kolom
  if (els["co-name"]) els["co-name"].value = "";
  if (els["co-phone"]) els["co-phone"].value = "";
  if (els["co-address"]) els["co-address"].value = "";
  await sandbox.App.submitOrder();
  check("validasi nama kosong: error menonjol + tombol Accept bergoyang",
    !el("co-error").classList.contains("hidden") && el("co-error").classList.contains("co-error-loud") &&
    el("co-error").innerHTML.includes("Isi nama dulu") && el("co-accept").classList.contains("shake"));
  if (els["co-name"]) els["co-name"].value = "Tes";
  if (els["co-phone"]) els["co-phone"].value = "01515041807";
  await sandbox.App.submitOrder();
  check("validasi alamat Tausil kosong: error menyebut alamat Tausil",
    el("co-error").innerHTML.includes("Isi alamat Tausil dulu"));

  // ID pesanan acak (cek sumber — tes DB-nya lewat MCP, bukan stub)
  const sql001 = fs.readFileSync("/home/hatch/workspace/khatuliswa-resto-cloudflare/supabase/migrations/001_init.sql", "utf8");
  const sql005 = fs.readFileSync("/home/hatch/workspace/khatuliswa-resto-cloudflare/supabase/migrations/005_random_transaction_id.sql", "utf8");
  check("ID acak: alfabet tanpa 0/O/1/I/L di 001 + 005",
    sql001.includes("ABCDEFGHJKMNPQRSTUVWXYZ23456789") && sql005.includes("ABCDEFGHJKMNPQRSTUVWXYZ23456789") &&
    !/lpad\(n::text, 3/.test(sql001));
  check("placeholder lacak YYMMDD-XXXX + contoh 261127-K7Q2 (bukan -001)",
    idx.includes("YYMMDD-XXXX") && idx.includes("261127-K7Q2") && !idx.includes("261127-001") && !appSrc.includes("YYMMDD-XXX\""));

  // ---------- Admin GASPOS v1 + display views ----------
  // Static markup (index.html)
  check("login GASPOS: glass card + GASPOS + Select Account + PIN pad 6 dot",
    idx.includes('id="account-selector"') && idx.includes(">GASPOS<") && idx.includes("Select Account") &&
    idx.includes('id="pin-screen"') && (idx.match(/pin-dot/g) || []).length >= 6 && idx.includes('id="pin-pad-grid"') &&
    idx.includes('id="staff-selection-modal"') && idx.includes('id="employee-list"') &&
    !idx.includes('id="staff-employee"') && !idx.includes('id="staff-pin"'));
  check("sidebar GASPOS: Customers/History/Products/Categories/Staff/Reports + Pesan Online + Logout + popover Display/More",
    idx.includes('id="sidebar"') && ["Customers", "History", "Products", "Categories", "Staff", "Reports", "Pesan Online", "Logout"].every(s => idx.includes(s)) &&
    idx.includes('id="display-popover"') && idx.includes('id="more-popover"'));
  // Navbar mobile: persis 4 tombol (Customers, History, POS tengah, More) —
  // Settings pindah ke popover More, seperti v1.
  check("navbar mobile admin: 4 tombol saja (Customers/History/POS/More)",
    (() => {
      var navStart = idx.indexOf('<nav id="main-nav"');
      var nav = idx.slice(navStart, idx.indexOf('</nav>', navStart));
      var btns = nav.match(/<button[^>]*>/g) || [];
      var mobileVisible = btns.filter(function (b) { return b.indexOf('hidden lg:flex') === -1; });
      return mobileVisible.length === 4 &&
        mobileVisible.some(function (b) { return b.indexOf('id="display-menu-btn"') > -1; }) &&
        mobileVisible.some(function (b) { return b.indexOf('id="more-menu-btn"') > -1; });
    })());
  check("tombol POS mobile lebar tetap (tanpa flex-1, w-20)",
    (() => { var m = idx.match(/<button id="display-menu-btn"[^>]*>/); return m && m[0].indexOf('flex-1') === -1 && m[0].indexOf('max-lg:w-20') > -1; })());
  check("Settings ada di popover More (bukan di bar mobile)",
    idx.slice(idx.indexOf('id="more-popover"'), idx.indexOf('id="crud-modal"')).includes("setAdminTab('settings')") &&
    !idx.slice(idx.indexOf('<nav id="main-nav"'), idx.indexOf('</nav>', idx.indexOf('<nav id="main-nav"'))).includes('data-nav="settings"'));
  check("display popover: POS / Kitchen Display / Customer View / Queue View",
    ["Register (POS)", "Kitchen Display", "Customer View", "Queue Status"].every(s => idx.includes(s)));
  check("CRUD modal ada (crud-modal + crud-fields + crud-title)",
    idx.includes('id="crud-modal"') && idx.includes('id="crud-fields"') && idx.includes('id="crud-title"'));
  check("font Inter + JetBrains Mono + lucide dimuat",
    idx.includes("Inter:wght@300") && idx.includes("JetBrains+Mono") && idx.includes("unpkg.com/lucide"));
  check("CSS GASPOS: bento-card + login-glass + pin-dot + sidebar collapsed",
    idx.includes(".bento-card") && idx.includes(".login-glass") && idx.includes(".pin-dot") && idx.includes("#sidebar.collapsed"));
  check("blok admin app.js bebas kelas Stitch",
    (() => { const a = appSrc.slice(appSrc.indexOf("// ---------- admin (GASPOS v1 look)"), appSrc.indexOf("// ---------- router / render")); return !/primary-container|surface-container|material-symbols-outlined|#1e3f32/.test(a); })());
  check("redirect customer/queue -> admin sudah dihapus",
    !appSrc.includes('if (state.view === "customer" || state.view === "queue") state.view = "admin"'));

  // Admin POS (staff session seeded at boot)
  sandbox.App.go("admin");
  await new Promise(r => setTimeout(r, 50));
  const adminHtml = els["app"].innerHTML;
  check("admin POS tampil (search + kategori + grid + panel Order + Pay Now)",
    adminHtml.includes('id="pos-search"') && adminHtml.includes('id="pos-product-grid"') && adminHtml.includes('id="pos-cart-items"') &&
    adminHtml.includes("Pay Now") && adminHtml.includes("Order"));
  check("admin POS grid menampilkan foto produk asli (assets/products/)",
    els["pos-product-grid"].innerHTML.includes("assets/products/") && els["pos-product-grid"].innerHTML.includes("Nasi Gaol"));
  check("admin POS panel Order menampilkan item keranjang + total",
    els["pos-cart-items"].innerHTML.includes("Nasi Gaol Ayam Bakar") && els["pos-cart-totals"].innerHTML.includes("Subtotal"));
  // Fast path: tambah di POS tidak me-render ulang seluruh halaman
  const beforeAdmin = els["app"].innerHTML;
  sandbox.App.addToCart("P-NG01");
  await new Promise(r => setTimeout(r, 20));
  check("tambah di POS admin: panel keranjang ter-update tanpa render ulang penuh",
    els["app"].innerHTML === beforeAdmin && els["pos-cart-items"].innerHTML.includes("Nasi Gaol Ayam Bakar"));
  sandbox.App.setOrderType({ getAttribute: (n) => n === "data-v" ? "Delivery" : null });
  await new Promise(r => setTimeout(r, 20));
  check("panel POS Delivery kena Tausil 5 LE",
    els["pos-cart-totals"].innerHTML.includes("Tausil") && els["pos-cart-totals"].innerHTML.includes("5 LE"));

  // Kitchen Display (kanban 4 lane)
  sandbox.App.go("kitchen");
  await new Promise(r => setTimeout(r, 50));
  const kv = els["app"].innerHTML;
  check("Kitchen Display: Kitchen Workflow + 4 lane kanban",
    kv.includes("Kitchen Workflow") && ["kanban-Pending", "kanban-Dibuat", "kanban-Diantar", "kanban-Selesai"].every(s => kv.includes(s)));

  // Customer View (publik, demo: Awaiting Order)
  sandbox.App.go("customer");
  await new Promise(r => setTimeout(r, 50));
  const cv = els["app"].innerHTML;
  check("Customer View publik: SUMMARY + Awaiting Order",
    cv.includes("SUMMARY") && cv.includes("Awaiting Order"));

  // Queue View (publik, demo: kosong)
  sandbox.App.go("queue");
  await new Promise(r => setTimeout(r, 50));
  const qv = els["app"].innerHTML;
  check("Queue View publik: Preparing + Ready (Pick Up Now)",
    qv.includes("Preparing") && qv.includes("Ready") && qv.includes("Pick Up Now"));

  // Login gate: setelah logout, admin minta PIN lagi
  sandbox.App.go("admin");
  await new Promise(r => setTimeout(r, 20));
  sandbox.App.staffLogout();
  await new Promise(r => setTimeout(r, 20));
  check("logout -> admin kembali ke layar login (Masuk sebagai staf)",
    els["app"].innerHTML.includes("Masuk sebagai staf") && els["staff-login"].classList.contains("hidden") === false);

  // ---------- Perbaikan pasca-verifikasi browser (27 Nov 2026) ----------
  // (a) Modal pilih staf harus di ATAS layar login (z 200) — .modal-backdrop
  //     sempat z-index 70 sehingga modal tidak terlihat & tidak bisa diklik.
  check("modal pilih staf di atas layar login (modal-backdrop z-index > 200)",
    /\.modal-backdrop\s*\{[^}]*z-index:\s*2\d\d/.test(idx));
  // (b) Jam queue/sidebar diisi langsung tiap render (bukan hanya interval
  //     10 detik) — kalau tidak, queue sempat tampil "--:--".
  check("render() memanggil updateClock() langsung",
    /refreshIcons\(\);\s*\n\s*\/\/[^\n]*\n\s*updateClock\(\);/.test(appSrc) || appSrc.includes("updateClock();\n  }\n\n  // ---------- public API"));
  // (c) Kitchen + Queue sinkron: pesanan aktif tampil apa pun tanggalnya.
  check("Kitchen: filter pesanan aktif tanpa batas tanggal (Selesai hari ini saja)",
    /loadKitchen[\s\S]*?status !== "Selesai" \|\| String\(t\.timestamp/.test(appSrc));
  check("Queue: filter pesanan aktif tanpa batas tanggal (Selesai hari ini saja)",
    /loadQueueView[\s\S]*?status !== "Selesai" \|\| String\(t\.timestamp/.test(appSrc));
  check("loadKitchen gagal memuat tampil pesan error (bukan lane kosong)",
    appSrc.includes("Gagal memuat dapur"));
  check("display-transactions: aktif apa pun tanggal + Selesai hari ini",
    fs.readFileSync("/home/hatch/workspace/khatuliswa-resto-cloudflare/supabase/functions/display-transactions/index.ts", "utf8").includes('t.status !== "Selesai"') &&
    !fs.readFileSync("/home/hatch/workspace/khatuliswa-resto-cloudflare/supabase/functions/display-transactions/index.ts", "utf8").includes('.gte("timestamp"'));
  // (d) Anti-kedip: chrome menu pelanggan disembunyikan sebelum app.js boot
  //     untuk view admin/kitchen/customer/queue.
  check("anti-kedip: script awal sembunyikan header/nav/cart untuk view admin/display",
    idx.includes('["admin", "kitchen", "customer", "queue"]') && idx.includes('["app-header", "bottom-nav", "floating-cart"]'));

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
