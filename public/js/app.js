/* Khatulistiwa Resto v2 — single-page app (Cloudflare Pages + Supabase).
 *
 * Design: Google Stitch "Khatulistiwa Resto Delivery App"
 * (Plus Jakarta Sans, Material Symbols, deep forest #1E3F32,
 *  ivory #FCF9F2, lime accent). Tokens diambil dari code.html hasil
 *  export Stitch (stitch-export/); foto produk HANYA dari data
 *  (products.image_url di Supabase) — tidak ada foto stok/bawaan.
 *  image_url kosong = tampil blok tema tanpa foto (bukan img rusak);
 *  begitu admin mengisi image_url asli, foto itu tampil di mana-mana.
 *
 * Views (?view=): online (default), order&id=, rewards, profile,
 * admin (staff PIN: POS / Kitchen / Transactions / Customers /
 * Products / Categories / Staff / Reports / Settings),
 * kitchen (display, auto-refresh), customer + queue (public displays,
 * auto-refresh). Admin/POS tampil seperti v1 GASPOS (Inter, kartu
 * putih bento-card, tombol hitam, ikon Lucide, sidebar GASPOS);
 * menu pelanggan tetap desain Stitch (Plus Jakarta Sans, Material
 * Symbols, deep forest #1E3F32, ivory #FCF9F2, lime accent).
 * One source of truth: Supabase (products/categories/settings via anon
 * RLS, orders via submit-online-order, status via staff-api, tracking
 * via track-order). Guest checkout always works; Google login is
 * optional and only adds membership (points, saved address/location).
 */
(function () {
  "use strict";

  var ADMIN_PHONE = (window.KHATULISTIWA_CONFIG && window.KHATULISTIWA_CONFIG.whatsappAdminPhone) || "201515041807";
  var CAT_ORDER = ["Nasi Gaol", "Soup Tomyam", "Cemilan", "Classic Drink", "Premium Drink", "Extra Topping"];
  var CAT_ICON = { "All": "local_dining", "Nasi Gaol": "rice_bowl", "Soup Tomyam": "soup_kitchen", "Cemilan": "bakery_dining", "Classic Drink": "local_cafe", "Premium Drink": "emoji_food_beverage", "Extra Topping": "add_circle" };
  var POPULAR_SKUS = ["NG01", "NG05", "ST03", "CM01", "PD03", "PD01", "PD08", "CD14"];
  var STATUS_STEPS = ["Pending", "Dibuat", "Diantar", "Selesai"];
  var CART_KEY = "khatulistiwa_cart_v2";
  var MEMBER_KEY = "khatulistiwa_member_v2";
  var MONTHS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

  var state = {
    view: "online", orderId: null, products: [], categories: [], settings: {},
    customers: [], transactions: [], employees: [],
    cart: [], category: "All", search: "",
    orderType: "Take Away", payment: "Cash",
    location: null, // {latitude, longitude, mapsUrl}
    member: null, // synced customer record (Google login) or null (guest)
    staffUser: null, adminTab: "pos", trackTimer: null, kitchenTimer: null,
    customerTimer: null, queueTimer: null,
    selectedEmployeeId: "", pinBuffer: "",
    posSearch: "", posCategory: "All", posCustomerId: "Guest",
    txnFilter: { q: "", type: "All", date: "" },
    reportFrom: "", reportTo: "",
    customerView: null, queueView: null,
    mgmtType: "", mgmtId: null,
    loading: true, loadError: "",
    demoMode: false, demoOrder: null, // demoMode: Supabase not configured yet
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  // Stitch menampilkan harga "90 LE" (angka dulu, lalu LE).
  function fmt(n) { return Number(n || 0).toLocaleString("en-US") + " LE"; }
  function money(n) { return Number(n || 0); }
  function params() { return new URLSearchParams(location.search); }
  function baseUrl() { return location.origin + location.pathname; }
  function trackingLink(txnId) { return baseUrl() + "?view=order&id=" + encodeURIComponent(txnId); }
  function loadCart() { try { state.cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]"); } catch (e) { state.cart = []; } }
  function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch (e) {} }
  function loadMember() { try { state.member = JSON.parse(localStorage.getItem(MEMBER_KEY) || "null"); } catch (e) { state.member = null; } }
  function saveMember(m) { state.member = m || null; try { if (m) localStorage.setItem(MEMBER_KEY, JSON.stringify(m)); else localStorage.removeItem(MEMBER_KEY); } catch (e) {} }
  // Nama tampil: "Nasi Gaol / Ayam Bakar" -> "Nasi Gaol Ayam Bakar" (data mentah tidak diubah).
  function displayName(n) { return String(n == null ? "" : n).replace(/\s*\/\s*/g, " ").trim(); }
  function productById(id) { return state.products.find(function (p) { return String(p.id) === String(id); }); }
  function productBySku(sku) { return state.products.find(function (p) { return p.sku === sku; }); }
  // Foto pertama produk di kategori (untuk lingkaran kategori & hero).
  function catPhoto(cat) { var p = state.products.find(function (x) { return x.category === cat && x.imageUrl; }); return p ? p.imageUrl : ""; }
  function heroPhoto() { var p = productBySku("NG01") || state.products[0]; return p && p.imageUrl ? p.imageUrl : ""; }

  // ---------- boot ----------
  // Demo mode: if Supabase is not configured yet but demo-data.js loaded,
  // show the real menu/design from DEMO_DATA instead of a load error.
  // Once config.js has a real Supabase URL + anon key, this never runs.
  function loadDemoData() {
    var d = window.DEMO_DATA;
    if (!d) return false;
    state.demoMode = true;
    state.products = d.products || [];
    state.categories = d.categories || [];
    state.settings = d.settings || {};
    state.customers = [];
    state.transactions = [];
    state.employees = [];
    return true;
  }
  function demoBannerHtml() {
    if (!state.demoMode) return "";
    return '<div class="mt-4 flex items-start gap-2.5 rounded-2xl bg-secondary-container px-4 py-3 shadow-sm"><span class="material-symbols-outlined text-[20px] text-on-secondary-container shrink-0 mt-px">info</span><p class="font-label-md text-label-md text-on-secondary-container">Mode Demo — Supabase belum tersambung. Menu bisa dilihat dan pesan ke WA tetap jalan, tapi pesanan belum tercatat dan belum bisa dilacak.</p></div>';
  }
  async function boot() {
    loadCart(); loadMember();
    var q = params();
    state.view = q.get("view") || "online";
    state.orderId = q.get("id") || null;
    if (state.view === "menu") state.view = "online";
    // ?view=customer / ?view=queue are real public displays now (no redirect).
    if (!window.SUPABASE_CONFIGURED && window.DEMO_DATA) {
      loadDemoData();
    } else {
      try {
        var res = await window.supabaseApi.getAppData();
        if (res && res.ok) {
          state.products = res.data.products || [];
          state.categories = res.data.categories || [];
          state.settings = res.data.settings || {};
          state.customers = res.data.customers || [];
          state.transactions = res.data.transactions || [];
          state.employees = res.data.employees || [];
        } else {
          state.loadError = (res && res.message) || "Could not load the menu.";
        }
      } catch (e) { state.loadError = String(e); }
    }
    state.loading = false;
    // Staff session (PIN) survives reload via localStorage, like v1.
    try {
      var su = localStorage.getItem("bento_session_user");
      if (su) state.staffUser = JSON.parse(su);
    } catch (e) {}
    // Google member session (Supabase Auth) — optional, never required.
    await refreshMemberSession();
    render();
    // Live clock for the GASPOS sidebar + queue display.
    setInterval(updateClock, 10000); updateClock();
    if (window.supabaseClient) {
      window.supabaseClient.auth.onAuthStateChange(function (_ev, session) {
        if (session && session.user) syncMember().then(render);
        else { saveMember(null); render(); }
      });
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  // ---------- membership (Supabase Auth, Google) ----------
  async function refreshMemberSession() {
    var sb = window.supabaseClient;
    if (!sb) return;
    try {
      var s = await sb.auth.getSession();
      if (s && s.data && s.data.session) await syncMember();
    } catch (e) {}
  }
  async function syncMember(extra) {
    var res = await window.supabaseApi.memberSync(extra || {});
    if (res && res.ok) { saveMember(res.data); updateHeaderMember(); return res.data; }
    return null;
  }
  async function signInWithGoogle() {
    var sb = window.supabaseClient;
    if (!sb) { alert("Supabase is not configured yet (see public/config.js)."); return; }
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: baseUrl() + "?view=profile" },
    });
  }
  async function signOutGoogle() {
    var sb = window.supabaseClient;
    if (sb) await sb.auth.signOut();
    saveMember(null); render();
  }
  function updateHeaderMember() {
    var m = state.member;
    var av = $("header-avatar"), fb = $("header-avatar-fallback");
    if (av && fb) {
      if (m && m.avatar_url) { av.src = m.avatar_url; av.classList.remove("hidden"); fb.classList.add("hidden"); }
      else { av.classList.add("hidden"); fb.classList.remove("hidden"); }
    }
  }

  // ---------- menu / cart ----------
  function visibleProducts() {
    var list = state.products.filter(function (p) { return p.status === "Active"; });
    if (state.category !== "All") list = list.filter(function (p) { return p.category === state.category; });
    if (state.search) {
      var q = state.search.toLowerCase();
      list = list.filter(function (p) { return String(p.name).toLowerCase().indexOf(q) !== -1; });
    }
    return list;
  }
  function cartQty(id) { var it = state.cart.find(function (c) { return String(c.id) === String(id) && !c.isRedeemed; }); return it ? it.qty : 0; }
  function addToCart(id, isRedeemed) {
    var p = productById(id); if (!p) return;
    if (isRedeemed) {
      if (!state.member) { alert("Masuk dengan Google dulu untuk menukar poin."); App.go("profile"); return; }
      var cost = Number(p.point_price || 0);
      if (Number(state.member.points || 0) < cost) { alert("Poin tidak cukup. Kamu punya " + Number(state.member.points || 0) + " poin, butuh " + cost + " poin."); return; }
    }
    var key = String(id) + (isRedeemed ? ":redeem" : "");
    var it = state.cart.find(function (c) { return c.key === key; });
    if (it) it.qty += 1;
    else state.cart.push({ key: key, id: p.id, name: p.name, price: Number(p.price || 0), point_price: Number(p.point_price || 0), qty: 1, isRedeemed: !!isRedeemed, imageUrl: p.imageUrl || "" });
    saveCart(); renderCartBadge();
    if (state.view === "admin" && state.adminTab === "pos" && state.staffUser) { renderPosCartPanel(); refreshCartDrawer(); } else render();
  }
  function changeQty(key, d) {
    var it = state.cart.find(function (c) { return c.key === key; }); if (!it) return;
    it.qty += d; if (it.qty <= 0) state.cart = state.cart.filter(function (c) { return c.key !== key; });
    saveCart(); renderCartBadge();
    if (state.view === "admin" && state.adminTab === "pos" && state.staffUser) { renderPosCartPanel(); refreshCartDrawer(); } else render();
  }
  function removeFromCart(key) {
    state.cart = state.cart.filter(function (c) { return c.key !== key; });
    saveCart(); renderCartBadge();
    if (state.view === "admin" && state.adminTab === "pos" && state.staffUser) { renderPosCartPanel(); refreshCartDrawer(); } else render();
  }
  function cartTotals() {
    var sub = 0, pts = 0;
    state.cart.forEach(function (c) {
      if (c.isRedeemed) pts += Number(c.point_price || 0) * c.qty;
      else sub += Number(c.price || 0) * c.qty;
    });
    // Biaya Tausil TETAP 5 LE, hanya untuk Delivery (Tausil). Dine In /
    // Take Away tidak kena biaya ini (service = 0). Setting lama
    // service_charge (5%) sudah tidak dipakai lagi untuk biaya —
    // dipertahankan di settings hanya sebagai arsip.
    var service = state.orderType === "Delivery" ? Number(state.settings.tausil_fee || 5) : 0;
    var tax = Math.round(sub * Number(state.settings.tax_rate || 10) / 100);
    return { subtotal: sub, service: service, tax: tax, total: sub + service + tax, pointsCost: pts,
             pointsEarned: Math.floor((sub + service + tax) / Number(state.settings.loyalty_rate || 10)) };
  }
  function renderCartBadge() {
    var n = state.cart.reduce(function (a, c) { return a + c.qty; }, 0);
    var b = $("cart-badge"); if (b) { b.textContent = n; b.classList.toggle("hidden", n === 0); }
    updateFloatingBar();
  }
  function updateFloatingBar() {
    var bar = $("floating-cart"); if (!bar) return;
    var n = state.cart.reduce(function (a, c) { return a + c.qty; }, 0);
    var t = cartTotals();
    bar.classList.toggle("hidden", !(n > 0 && state.view === "online"));
    var c = $("fc-count"); if (c) c.textContent = n;
    var tx = $("fc-text"); if (tx) tx.textContent = n + " item • " + fmt(t.total);
  }
  // Isi ulang drawer keranjang bila sedang terbuka (dipanggil dari render()).
  function refreshCartDrawer() {
    var d = $("cart-drawer"); if (!d || d.classList.contains("hidden")) return;
    var t = cartTotals();
    var n = state.cart.reduce(function (a, c) { return a + c.qty; }, 0);
    $("cart-items").innerHTML = state.cart.length
      ? '<div class="bg-surface-container-lowest rounded-2xl p-4 shadow-sm flex flex-col gap-3"><div class="flex items-center justify-between"><span class="font-headline-sm text-headline-sm text-on-surface">Rincian Pesanan</span><span class="font-label-sm text-label-sm text-secondary font-semibold">' + n + ' Menu Dipilih</span></div>' +
        state.cart.map(function (c) {
          return '<div class="flex items-center gap-3 py-2">' +
            (c.imageUrl ? '<img src="' + esc(c.imageUrl) + '" class="w-16 h-16 rounded-xl object-cover shadow-sm flex-shrink-0" onerror="this.style.display=\'none\'" alt="">' : '<div class="w-16 h-16 rounded-xl bg-surface-container-low flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[22px] text-outline">local_dining</span></div>') +
            '<div class="flex-1 min-w-0"><h4 class="font-headline-sm text-headline-sm text-on-surface truncate">' + esc(displayName(c.name)) + '</h4><div class="flex items-center gap-1.5 mt-0.5"><span class="font-price-tag text-price-tag text-primary-container">' + (c.isRedeemed ? (Number(c.point_price) * c.qty) + ' Pts' : fmt(c.price * c.qty)) + '</span></div></div>' +
            '<div class="flex items-center bg-surface-container-low rounded-full px-1.5 py-1 gap-2 shadow-inner"><button onclick="App.changeQty(\'' + esc(c.key) + '\', -1)" class="w-6 h-6 rounded-full bg-surface-container-lowest text-on-surface flex items-center justify-center shadow-sm active:scale-90 transition-transform" aria-label="Kurangi"><span class="material-symbols-outlined text-[14px]">remove</span></button><span class="font-label-md text-label-md text-on-surface min-w-[12px] text-center">' + c.qty + '</span><button onclick="App.changeQty(\'' + esc(c.key) + '\', 1)" class="w-6 h-6 rounded-full bg-primary-container text-on-primary flex items-center justify-center shadow-sm active:scale-90 transition-transform" aria-label="Tambah"><span class="material-symbols-outlined text-[14px]">add</span></button></div>' +
            '<button onclick="App.removeFromCart(\'' + esc(c.key) + '\')" class="w-8 h-8 rounded-full flex items-center justify-center text-outline hover:text-error transition-colors" aria-label="Hapus Item"><span class="material-symbols-outlined text-[18px]">delete</span></button></div>';
        }).join("") + '</div>'
      : '<p class="font-body-md text-body-md text-on-surface-variant text-center py-8">Keranjang masih kosong.</p>';
    $("cart-totals").innerHTML = '<div class="flex flex-col gap-1.5">' +
      '<div class="flex justify-between font-body-md text-body-md text-on-surface-variant"><span>Subtotal (' + n + ' item)</span><span class="font-headline-sm text-headline-sm text-on-surface">' + fmt(t.subtotal) + '</span></div>' +
      (t.service > 0 ? '<div class="flex justify-between font-body-md text-body-md text-on-surface-variant"><span>Tausil</span><span class="font-headline-sm text-headline-sm text-on-surface">' + fmt(t.service) + '</span></div>' : '') +
      '<div class="flex justify-between font-body-md text-body-md text-on-surface-variant"><span>Tax 10%</span><span class="font-headline-sm text-headline-sm text-on-surface">' + fmt(t.tax) + '</span></div>' +
      (t.pointsCost ? '<div class="flex justify-between font-label-md text-label-md text-primary-container"><span>Poin dipakai</span><span>' + t.pointsCost + ' Pts</span></div>' : '') +
      '<div class="flex justify-between items-center border-t border-surface-variant/70 pt-2"><span class="font-headline-md text-headline-md text-on-surface">Total</span><span class="font-display-hero-mobile text-display-hero-mobile text-primary-container">' + fmt(t.total) + '</span></div></div>';
    // Form checkout inline (di dalam drawer) hanya tampil bila ada isi keranjang.
    var hasItems = state.cart.length > 0;
    var form = $("checkout-form"); if (form) form.classList.toggle("hidden", !hasItems);
    var foot = $("cart-footer"); if (foot) foot.classList.toggle("hidden", !hasItems);
    if (hasItems) { prefillCheckoutForm(); syncCheckoutSelectors(); renderCheckoutSummary(); }
  }

  // ---------- render: online home (Stitch beranda) ----------
  function deliverToHtml() {
    var m = state.member;
    var addr = (m && m.address) ? m.address : "Nasr City, Cairo";
    return '<button onclick="App.go(\'profile\')" class="w-full h-11 bg-surface-container-lowest rounded-full px-4 flex items-center justify-between shadow-[0_2px_8px_rgba(30,63,50,0.04)] active:scale-[0.99] transition-transform text-left">' +
      '<span class="flex items-center gap-2 overflow-hidden pr-2"><span class="material-symbols-outlined text-on-tertiary-container text-[18px] shrink-0">location_on</span>' +
      '<span class="flex items-center gap-1 truncate"><span class="font-label-sm text-label-sm text-on-surface-variant shrink-0">Deliver to:</span><span class="font-label-md text-label-md text-on-surface truncate">' + esc(addr) + '</span></span></span>' +
      '<span class="material-symbols-outlined text-outline text-[18px] shrink-0">edit</span></button>';
  }
  function heroHtml() {
    var img = heroPhoto();
    return '<section class="relative w-full rounded-2xl bg-primary-container text-on-primary overflow-hidden shadow-[0_12px_28px_-6px_rgba(30,63,50,0.18)] p-6 flex flex-col justify-between min-h-[190px]">' +
      '<div class="relative z-10 flex flex-col max-w-[62%] justify-between h-full">' +
        '<div class="flex flex-col gap-1">' +
          '<span class="font-label-sm text-label-sm tracking-wider uppercase text-primary-fixed">Khatulistiwa Spesial</span>' +
          '<h2 class="font-display-hero-mobile text-display-hero-mobile tracking-tight leading-tight text-surface">CITA RASA NUSANTARA.</h2>' +
          '<p class="font-body-sm text-body-sm text-primary-fixed mt-1">Rempah otentik Nusantara kini hadir hangat di tengah kota Kairo.</p>' +
        '</div>' +
        '<div class="pt-4"><button onclick="document.getElementById(\'menu-section\')?.scrollIntoView({behavior:\'smooth\'})" class="inline-flex items-center gap-1.5 px-4 py-2 bg-surface text-primary-container rounded-full font-label-md text-label-md shadow-sm active:scale-95 transition-transform"><span>Pesan Sekarang</span><span class="material-symbols-outlined text-[16px]">arrow_forward</span></button></div>' +
      '</div>' +
      (img ? '<div class="absolute -right-6 -bottom-6 w-44 h-44 rounded-full overflow-hidden shadow-inner"><img src="' + esc(img) + '" alt="Nasi Gaol" class="w-full h-full object-cover"></div>' : '<div class="absolute -right-6 -bottom-6 w-44 h-44 rounded-full overflow-hidden bg-primary-fixed-dim/15 flex items-center justify-center"><span class="material-symbols-outlined text-[88px] text-primary-fixed/60">rice_bowl</span></div>') +
      '<div class="relative z-10 flex items-center gap-1.5 pt-3"><span class="w-4 h-1.5 rounded-full bg-surface"></span><span class="w-1.5 h-1.5 rounded-full bg-surface/40"></span><span class="w-1.5 h-1.5 rounded-full bg-surface/40"></span></div>' +
    '</section>';
  }
  function rewardsBannerHtml() {
    var m = state.member;
    return '<section class="w-full rounded-2xl bg-secondary-container text-on-secondary-container p-4 shadow-sm flex items-center justify-between gap-3">' +
      '<div class="flex items-center gap-3 min-w-0">' +
        '<div class="w-12 h-12 rounded-full bg-primary-container text-on-primary flex items-center justify-center shrink-0 shadow-sm"><span class="material-symbols-outlined text-[24px]">stars</span></div>' +
        '<div class="flex flex-col min-w-0">' +
          '<span class="font-headline-sm text-headline-sm text-on-surface truncate">KHATULISTIWA REWARDS</span>' +
          '<p class="font-body-sm text-body-sm text-secondary truncate">' + (m ? 'Kamu punya ' + Number(m.points || 0) + ' poin • 1 poin tiap 10 LE' : 'Kumpulkan poin dan nikmati gratis menu khas Nusantara.') + '</p>' +
        '</div></div>' +
      (m ? '<button onclick="App.go(\'rewards\')" class="shrink-0 px-3.5 py-2 rounded-full bg-primary-container text-on-primary font-label-md text-label-md shadow-sm active:scale-95 transition-transform">Lihat</button>'
         : '<button onclick="App.signInWithGoogle()" class="shrink-0 px-3.5 py-2 rounded-full bg-primary-container text-on-primary font-label-md text-label-md shadow-sm active:scale-95 transition-transform">Gabung</button>') +
    '</section>';
  }
  function categoriesHtml() {
    var cats = ["All"].concat(CAT_ORDER.filter(function (c) { return state.categories.some(function (x) { return x.name === c; }); }));
    return '<section class="flex flex-col gap-2"><div class="-mx-5 px-5 flex items-center gap-3 overflow-x-auto no-scrollbar py-1">' + cats.map(function (c) {
      var active = state.category === c;
      var photo = c === "All" ? "" : catPhoto(c);
      var inner = c === "All"
        ? '<span class="material-symbols-outlined text-[24px]">' + CAT_ICON[c] + '</span>'
        : (photo ? '<img src="' + esc(photo) + '" alt="" class="w-full h-full object-cover" loading="lazy">' : '<span class="material-symbols-outlined text-[24px]">' + (CAT_ICON[c] || "local_dining") + '</span>');
      return '<button onclick="App.setCategory(\'' + esc(c) + '\')" class="shrink-0 flex flex-col items-center gap-1.5">' +
        '<span class="w-14 h-14 rounded-full overflow-hidden flex items-center justify-center shadow-sm active:scale-95 transition-all ' + (active ? "bg-primary-container text-on-primary ring-2 ring-primary-container ring-offset-2 ring-offset-surface" : "bg-surface-container-lowest text-on-surface-variant") + '">' + inner + '</span>' +
        '<span class="font-label-md text-label-md ' + (active ? "text-primary-container" : "text-on-surface-variant") + '">' + esc(c === "All" ? "Semua" : c) + '</span></button>';
    }).join("") + '</div></section>';
  }
  function productCard(p, opts) {
    opts = opts || {};
    var img = p.imageUrl
      ? '<img src="' + esc(p.imageUrl) + '" alt="' + esc(displayName(p.name)) + '" class="w-full h-full object-cover" loading="lazy" onerror="this.style.display=\'none\'">'
      : '<div class="w-full h-full bg-surface-container-low flex items-center justify-center"><span class="material-symbols-outlined text-[28px] text-outline">' + (CAT_ICON[p.category] || "local_dining") + '</span></div>';
    var badge = "";
    if (opts.badge === "BESTSELLER") badge = '<span class="absolute top-2.5 left-2.5 z-10 inline-flex items-center gap-1 rounded-full font-bold" style="background-color:#1e3f32;color:#fff;font-size:10px;padding:4px 8px;box-shadow:0 2px 6px rgba(30,63,50,.3)"><span class="material-symbols-outlined text-[12px]" style="color:#ffdbce;font-variation-settings:\'FILL\' 1">local_fire_department</span>BEST SELLER</span>';
    else if (opts.badge === "POPULAR") badge = '<span class="absolute top-2.5 left-2.5 z-10 inline-flex items-center rounded-full font-bold" style="background-color:#1e3f32;color:#fff;font-size:10px;padding:4px 8px;box-shadow:0 2px 6px rgba(30,63,50,.3)">POPULAR</span>';
    else if (opts.badge) badge = '<span class="absolute top-2.5 left-2.5 z-10 inline-flex items-center rounded-full font-bold" style="background-color:#1e3f32;color:#fff;font-size:10px;padding:4px 8px">' + esc(opts.badge) + '</span>';
    var imgH = opts.carousel ? "h-28" : "aspect-square";
    return '<div onclick="App.addToCart(\'' + esc(p.id) + '\')" class="bg-surface-container-lowest rounded-2xl p-3 flex flex-col justify-between cursor-pointer shadow-[0_4px_16px_-2px_rgba(30,63,50,0.06)] active:scale-[0.99] transition-transform ' + (opts.carousel ? "shrink-0 w-40" : "") + '">' +
      '<div class="flex flex-col"><div class="relative w-full ' + imgH + ' rounded-xl overflow-hidden bg-surface-container-low mb-2.5">' + img + badge + '</div>' +
      '<h3 class="font-headline-sm text-headline-sm text-on-surface leading-tight line-clamp-1">' + esc(displayName(p.name)) + '</h3></div>' +
      '<div class="flex items-center justify-between mt-2 pt-1"><span class="font-price-tag text-price-tag text-primary-container">' + fmt(p.price) + '</span>' +
      '<button onclick="event.stopPropagation();App.addToCart(\'' + esc(p.id) + '\')" class="w-8 h-8 rounded-full bg-primary-container text-on-primary flex items-center justify-center active:scale-90 transition-transform shadow-sm" aria-label="Tambah"><span class="material-symbols-outlined text-[18px]">add</span></button></div>' +
      (Number(p.point_price || 0) > 0 ? '<button onclick="event.stopPropagation();App.addToCart(\'' + esc(p.id) + '\', true)" class="mt-2 w-full py-1.5 rounded-full bg-secondary-container text-on-secondary-container font-label-md text-label-md font-bold">Tukar ' + Number(p.point_price) + ' Pts</button>' : '') +
      '</div>';
  }
  function renderOnline() {
    var popular = POPULAR_SKUS.map(productBySku).filter(function (p) { return p && Number(p.point_price || 0) === 0; }); // Hadiah (point_price > 0) tidak masuk Populer
    var list = visibleProducts();
    var html = demoBannerHtml() + '<div class="flex flex-col gap-5 mt-4">' + deliverToHtml() + heroHtml() + categoriesHtml();
    if (popular.length && state.category === "All" && !state.search) {
      html += '<section class="flex flex-col gap-3"><div class="flex items-center justify-between"><h3 class="font-headline-md text-headline-md text-on-surface">Pilihan Populer</h3><button onclick="App.setCategory(\'All\');setTimeout(()=>document.getElementById(\'menu-section\')?.scrollIntoView({behavior:\'smooth\'}),50)" class="flex items-center gap-0.5 text-on-tertiary-container font-label-md text-label-md"><span>Lihat Semua</span><span class="material-symbols-outlined text-[16px]">chevron_right</span></button></div>' +
      '<div class="-mx-5 px-5 flex gap-3 overflow-x-auto no-scrollbar py-2">' + popular.map(function (p, i) { return productCard(p, { badge: i === 0 ? "BESTSELLER" : "POPULAR", carousel: true }); }).join("") + '</div></section>';
    }
    html += rewardsBannerHtml();
    html += '<section class="flex flex-col gap-3"><div class="flex items-center justify-between"><div><h2 id="menu-section" class="font-headline-md text-headline-md text-primary-container tracking-tight">Koleksi Menu Nusantara</h2><p class="font-label-sm text-label-sm text-secondary uppercase tracking-wider mt-0.5">Otentik &amp; Segar Setiap Hari</p></div><span class="px-2.5 py-1 rounded-full bg-secondary-container/40 text-on-secondary-container font-label-sm text-label-sm">' + list.length + ' Pilihan</span></div>';
    html += list.length
      ? '<div class="grid grid-cols-2 gap-3.5">' + list.map(function (p) { return productCard(p); }).join("") + '</div>'
      : '<p class="font-body-md text-body-md text-on-surface-variant py-6 text-center">Menu tidak ditemukan.</p>';
    html += '</section>';
    html += '<p class="text-center font-body-sm text-body-sm text-outline">Harga dalam LE (EGP) • Pesanan tercatat dulu, lalu dibuka WhatsApp admin • <button class="underline font-bold text-primary-container" onclick="App.toggleTrack()">Lacak Pesanan</button></p>';
    html += '</div>';
    return html;
  }

  // ---------- render: tracking (Stitch asli: khatulistiwa_resto_lacak_pesanan/code.html) ----------
  // Dipakai dari code.html: header banner + pill status live, kartu peta (tanpa
  // foto peta & tanpa ETA — tidak ada datanya), timeline vertikal 5 tahap,
  // kartu rincian + alamat, kartu bantuan, tombol WA + Kembali ke Beranda.
  // TIDAK dipakai (data karangan Stitch): kurir Ahmad Ridwan / nopol KAI 8291 /
  // rating 4.9, ETA 15-20 menit, jarak 1.4 km, alamat Hayy Sabi' / Gedung
  // No.12, ongkir 20 LE, kupon TAUSILHEMAT -15 LE, WA 201000000000,
  // order #KTW-28109, jam per-tahap 19:10/19:18/19:30/19:35 (tidak ada di data).
  function fmtTimeCairo(ts) {
    // "HH:MM" zona Africa/Cairo, dirakit dari formatToParts supaya tidak
    // tergantung pemisah locale (id-ID memakai titik: "19.35").
    if (!ts) return "--:--";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "--:--";
    try {
      var parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
      var h = "", m = "";
      parts.forEach(function (p) { if (p.type === "hour") h = p.value; if (p.type === "minute") m = p.value; });
      if (h === "24") h = "00";
      return (h && m) ? h + ":" + m : "--:--";
    } catch (e) {
      var hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
      return hh + ":" + mm;
    }
  }
  function paymentLabel(m) {
    if (m === "Cash") return "Tunai (Cash)";
    if (m === "QRIS") return "QRIS";
    if (m === "Transfer") return "Transfer";
    return m || "-";
  }
  function statusPillLabel(status) {
    if (status === "Dibuat" || status === "Preparing") return "Sedang Dimasak";
    if (status === "Diantar") return "Sedang Diantar";
    if (status === "Selesai" || status === "Completed") return "Selesai";
    return "Pesanan Diterima";
  }
  function normalizeStatus(s) {
    if (s === "Preparing") return "Dibuat";
    if (s === "Completed") return "Selesai";
    return s || "Pending";
  }
  // Tahap timeline Stitch (5 untuk Delivery, 3 untuk Dine In / Take Away).
  // current = indeks tahap yang sedang berjalan; Selesai = semua done.
  function trackSteps(status, orderType) {
    var st = normalizeStatus(status);
    var steps, current;
    if (orderType === "Delivery") {
      steps = [
        { label: "Pesanan Diterima", icon: "receipt_long", desc: "Khatulistiwa Resto telah mengonfirmasi order Anda." },
        { label: "Sedang Dimasak di Dapur", icon: "restaurant", desc: "Dapur sedang menyiapkan pesananmu." },
        { label: "Pesanan Siap & Diambil Kurir", icon: "package_2", desc: "Pesanan sudah dikemas dan siap diantar." },
        { label: "Dalam Perjalanan Tausil", icon: "two_wheeler", desc: "Kurir sedang dalam perjalanan menuju lokasimu." },
        { label: "Pesanan Sampai di Lokasi", icon: "home", desc: "Siapkan pembayaran tunai atau tunjukkan bukti transfer." }
      ];
      current = st === "Pending" ? 0 : st === "Dibuat" ? 1 : st === "Diantar" ? 3 : 5;
    } else {
      var finalStep = orderType === "Take Away"
        ? { label: "Pesanan Siap Diambil", icon: "package_2", desc: "Pesananmu sudah siap diambil di resto." }
        : { label: "Pesanan Selesai", icon: "done_all", desc: "Pesanan sudah selesai. Terima kasih!" };
      steps = [
        { label: "Pesanan Diterima", icon: "receipt_long", desc: "Khatulistiwa Resto telah mengonfirmasi order Anda." },
        { label: "Sedang Dimasak di Dapur", icon: "restaurant", desc: "Dapur sedang menyiapkan pesananmu." },
        finalStep
      ];
      current = st === "Pending" ? 0 : st === "Dibuat" ? 1 : st === "Diantar" ? 1 : 3;
    }
    return { steps: steps, current: current };
  }
  function trackTimelineHtml(t) {
    var tr = trackSteps(t.status, t.orderType);
    var orderTime = fmtTimeCairo(t.timestamp);
    var typeLabel = t.orderType === "Delivery" ? "Tausil Express" : esc(t.orderType || "");
    var html = '<div class="w-full rounded-2xl bg-surface-container-lowest p-4 shadow-[0_4px_16px_rgba(30,63,50,0.05)]">';
    html += '<div class="flex items-center justify-between pb-3"><h2 class="font-headline-sm text-headline-sm text-on-surface">Riwayat &amp; Progres Pesanan</h2><span class="font-label-sm text-label-sm text-primary uppercase tracking-wider font-semibold">' + typeLabel + '</span></div>';
    html += '<div class="relative flex flex-col mt-2">';
    tr.steps.forEach(function (s, i) {
      var done = i < tr.current, now = i === tr.current, last = i === tr.steps.length - 1;
      var time = i === 0 ? orderTime : (now === false && done && i === tr.steps.length - 1 && t.status && normalizeStatus(t.status) === "Selesai" ? fmtTimeCairo(t.completed_at) : "--:--");
      var circleCls, iconHtml;
      if (done) {
        circleCls = "bg-primary text-on-primary shadow-xs";
        iconHtml = '<span class="material-symbols-outlined text-[15px]">check</span>';
      } else if (now) {
        circleCls = "bg-primary-fixed text-primary shadow-md animate-pulse";
        iconHtml = '<span class="material-symbols-outlined text-[17px]">' + s.icon + '</span>';
      } else {
        circleCls = "bg-surface-container-high text-on-surface-variant";
        iconHtml = '<span class="material-symbols-outlined text-[16px]">' + s.icon + '</span>';
      }
      var connector = last ? "" : '<div class="w-0.5 h-10 ' + (i < tr.current ? "bg-primary" : "bg-surface-container-high") + ' mt-1"></div>';
      var bodyCls = now ? "flex-1 bg-surface-container-low p-2.5 rounded-xl" : "flex-1";
      var titleCls = now ? "font-headline-sm text-headline-sm text-primary font-bold" : "font-headline-sm text-headline-sm text-on-surface";
      var timeCls = now ? "font-label-sm text-label-sm text-primary font-bold" : "font-label-sm text-label-sm text-on-surface-variant";
      html += '<div class="flex items-start gap-3.5 relative' + (done || now ? "" : " opacity-60") + '">' +
        '<div class="flex flex-col items-center"><div class="w-7 h-7 rounded-full flex items-center justify-center ' + circleCls + '">' + iconHtml + '</div>' + connector + '</div>' +
        '<div class="' + bodyCls + '"><div class="flex items-center justify-between"><span class="' + titleCls + '">' + esc(s.label) + '</span><span class="' + timeCls + '">' + time + '</span></div>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">' + esc(s.desc) + '</p></div></div>';
    });
    html += '</div></div>';
    return html;
  }
  // Kartu peta Stitch — HANYA untuk Delivery. Foto peta lh3 diganti panel
  // gradasi hijau (tidak ada foto peta asli); pill ETA & jarak dihapus
  // (tidak ada data ETA/jarak). Rute Dari/Tujuan dari data asli.
  function trackMapCardHtml(t, addr) {
    if (t.orderType !== "Delivery") return "";
    var resto = (state.settings.restaurant_name || "Khatulistiwa Resto") + " · Nasr City, Cairo";
    var html = '<div class="relative w-full rounded-2xl overflow-hidden bg-surface-container-lowest shadow-[0_8px_24px_rgba(30,63,50,0.08)]">';
    html += '<div class="w-full h-52 relative overflow-hidden" style="background:linear-gradient(135deg,#1E3F32 0%,#06291D 55%,#14532D 100%)">' +
      '<div class="absolute -left-10 top-8 w-40 h-40 rounded-full bg-white/5"></div><div class="absolute right-6 -bottom-8 w-52 h-52 rounded-full bg-primary-fixed/10"></div><div class="absolute left-1/3 top-1/2 w-24 h-24 rounded-full bg-white/5"></div>' +
      '<div class="absolute inset-0 bg-gradient-to-t from-primary/80 via-primary/20 to-transparent"></div>' +
      '<div class="absolute top-4 left-4 right-4 flex items-center justify-between">' +
      '<div class="bg-surface/95 backdrop-blur-md px-3 py-1.5 rounded-full shadow-sm flex items-center gap-1.5 text-on-surface"><span class="w-2 h-2 rounded-full bg-tertiary-container"></span><span class="font-label-sm text-label-sm">Resto Nasr City</span></div>' +
      (normalizeStatus(t.status) === "Diantar"
        ? '<div class="bg-primary px-3 py-1.5 rounded-full shadow-sm flex items-center gap-1.5 text-on-primary"><span class="material-symbols-outlined text-[14px]">navigation</span><span class="font-label-sm text-label-sm">Kurir Berjalan</span></div>'
        : "") +
      '</div>' +
      '<div class="absolute bottom-3 left-3 right-3 bg-surface/95 backdrop-blur-md rounded-xl p-3 shadow-md flex items-center gap-3">' +
      '<div class="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center text-primary shrink-0"><span class="material-symbols-outlined text-[20px]" style="font-variation-settings:\'FILL\' 1">moped</span></div>' +
      '<div class="min-w-0"><div class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Status Pesanan</div><div class="font-headline-md text-headline-md text-on-surface truncate">' + esc(statusPillLabel(t.status)) + '</div></div></div>' +
      '</div>';
    html += '<div class="p-4 bg-surface-container-lowest flex flex-col gap-3"><div class="flex items-start gap-3">' +
      '<div class="flex flex-col items-center mt-1"><span class="w-3 h-3 rounded-full bg-outline-variant"></span><span class="w-0.5 h-6 bg-surface-container-high my-0.5"></span><span class="w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center text-[10px] text-on-primary">●</span></div>' +
      '<div class="flex-1 flex flex-col justify-between gap-2 min-w-0">' +
      '<div class="flex justify-between items-baseline gap-2"><span class="font-body-sm text-body-sm text-on-surface-variant shrink-0">Dari:</span><span class="font-headline-sm text-headline-sm text-on-surface text-right truncate">' + esc(resto) + '</span></div>' +
      '<div class="flex justify-between items-baseline gap-2"><span class="font-body-sm text-body-sm text-on-surface-variant shrink-0">Tujuan:</span><span class="font-headline-sm text-headline-sm text-on-surface text-right truncate">' + esc(addr || "—") + '</span></div>' +
      '</div></div></div>';
    html += '</div>';
    return html;
  }
  function trackWaLink(id) {
    return "https://wa.me/" + ADMIN_PHONE + "?text=" + encodeURIComponent("Halo Admin Khatulistiwa, saya ingin tanya status pesanan nomor " + id);
  }
  // Item pesanan dengan foto produk ASLI (productById dari id item).
  function trackItemsHtml(items) {
    var rows = (items || []).map(function (it) {
      var p = it.id ? productById(it.id) : null;
      var img = (p && p.imageUrl)
        ? '<img src="' + esc(p.imageUrl) + '" alt="' + esc(displayName(it.name || "")) + '" class="w-12 h-12 rounded-lg object-cover shadow-xs flex-shrink-0" loading="lazy" onerror="this.style.display=\'none\'">'
        : '<div class="w-12 h-12 rounded-lg bg-surface-container flex items-center justify-center flex-shrink-0"><span class="material-symbols-outlined text-[20px] text-outline">' + (p ? (CAT_ICON[p.category] || "local_dining") : "local_dining") + '</span></div>';
      return '<div class="flex items-start justify-between gap-3 bg-surface-container-low p-2.5 rounded-xl"><div class="flex items-start gap-2.5 min-w-0">' + img +
        '<div class="flex flex-col min-w-0"><span class="font-headline-sm text-headline-sm text-on-surface">' + Number(it.qty || 0) + 'x ' + esc(displayName(it.name || "")) + '</span>' +
        (it.notes ? '<span class="font-body-sm text-body-sm text-on-surface-variant italic">Catatan: ' + esc(it.notes) + '</span>' : "") + '</div></div>' +
        '<span class="font-price-tag text-price-tag text-primary whitespace-nowrap">' + fmt(Number(it.price || 0) * Number(it.qty || 0)) + '</span></div>';
    }).join("");
    return '<div class="flex flex-col gap-3 py-2">' + rows + '</div>';
  }
  // Ringkasan tagihan ASLI: Subtotal dari item + Tausil 5 LE (hanya
  // Delivery) + Pajak 10%; Total = total_amount tersimpan. Nilai service
  // tersimpan dipakai bila ada (fallback mengikuti aturan Tausil baru).
  // TIDAK ada ongkir / kupon lain (tidak ada di data).
  function trackBillHtml(t, items, subtotal, service, tax) {
    var qty = (items || []).reduce(function (a, it) { return a + Number(it.qty || 0); }, 0);
    var tausilFee = Number(state.settings.tausil_fee || 5);
    var taxRate = Number(state.settings.tax_rate || 10);
    var sub = (subtotal != null) ? subtotal : (items || []).reduce(function (a, it) { return a + Number(it.price || 0) * Number(it.qty || 0); }, 0);
    var svc = (service != null) ? service : (t.orderType === "Delivery" ? tausilFee : 0);
    var tx = (tax != null) ? tax : Math.round(sub * taxRate / 100);
    var total = (t.total_amount != null) ? t.total_amount : t.total;
    return '<div class="mt-4 pt-3 flex flex-col gap-2 bg-surface-container-lowest">' +
      '<div class="flex justify-between items-center text-on-surface-variant font-body-sm text-body-sm"><span>Subtotal (' + qty + ' item)</span><span class="font-semibold text-on-surface">' + fmt(sub) + '</span></div>' +
      (svc > 0 ? '<div class="flex justify-between items-center text-on-surface-variant font-body-sm text-body-sm"><span>Tausil</span><span class="font-semibold text-on-surface">' + fmt(svc) + '</span></div>' : '') +
      '<div class="flex justify-between items-center text-on-surface-variant font-body-sm text-body-sm"><span>Pajak (' + taxRate + '%)</span><span class="font-semibold text-on-surface">' + fmt(tx) + '</span></div>' +
      '<div class="h-px bg-surface-container-high my-1"></div>' +
      '<div class="flex justify-between items-center"><div class="flex flex-col"><span class="font-headline-sm text-headline-sm text-on-surface font-bold">Total Pembayaran</span><span class="font-label-sm text-label-sm text-on-surface-variant">Metode: ' + esc(paymentLabel(t.paymentMethod)) + '</span></div>' +
      '<span class="font-display-hero-mobile text-display-hero-mobile text-primary font-extrabold">' + fmt(total) + '</span></div></div>';
  }
  function trackAddressCardHtml(addr, mapsUrl) {
    return '<div class="mt-3 p-3 rounded-xl bg-surface-container flex items-start gap-2.5">' +
      '<span class="material-symbols-outlined text-[18px] text-tertiary-container mt-0.5">location_on</span>' +
      '<div class="flex flex-col min-w-0"><span class="font-label-sm text-label-sm text-on-surface font-bold uppercase">Alamat Pengantaran</span>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5 leading-snug">' + esc(addr || "Alamat belum diisi") + '</p>' +
      (mapsUrl ? '<a class="font-label-md text-label-md text-primary-container flex items-center gap-1 mt-1" href="' + esc(mapsUrl) + '" target="_blank" rel="noopener">Lihat di Maps <span class="material-symbols-outlined text-[15px]">arrow_outward</span></a>' : "") +
      '</div></div>';
  }
  function trackDetailsCardHtml(t, items, addr, mapsUrl, subtotal, service, tax) {
    var qty = (items || []).reduce(function (a, it) { return a + Number(it.qty || 0); }, 0);
    var html = '<div class="w-full rounded-2xl bg-surface-container-lowest p-4 shadow-[0_4px_16px_rgba(30,63,50,0.05)]">';
    html += '<div class="flex items-center justify-between pb-3"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-[20px] text-primary">receipt_long</span><h2 class="font-headline-sm text-headline-sm text-on-surface">Rincian Pesanan</h2></div>' +
      '<span class="px-2.5 py-0.5 rounded-full bg-secondary-container font-label-sm text-label-sm text-on-secondary-container">' + qty + ' Hidangan</span></div>';
    html += trackItemsHtml(items);
    if (t.notes) html += '<p class="font-body-sm text-body-sm text-on-surface-variant italic mt-1">Catatan: ' + esc(t.notes) + '</p>';
    html += trackAddressCardHtml(addr, mapsUrl);
    html += trackBillHtml(t, items, subtotal, service, tax);
    html += '</div>';
    return html;
  }
  function trackCareCardHtml() {
    return '<div class="w-full rounded-2xl bg-secondary-fixed/40 p-4 flex items-start gap-3">' +
      '<div class="w-9 h-9 rounded-full bg-secondary-container text-on-secondary-container flex items-center justify-center flex-shrink-0"><span class="material-symbols-outlined text-[20px]">support_agent</span></div>' +
      '<div class="flex-1"><h3 class="font-headline-sm text-headline-sm text-on-secondary-fixed">Perlu Bantuan Pesanan?</h3>' +
      '<p class="font-body-sm text-body-sm text-on-secondary-fixed-variant mt-0.5">Jika ada kendala alamat, perubahan catatan, atau kurir sulit dihubungi, Admin Khatulistiwa siap sedia via WhatsApp.</p></div></div>';
  }
  function trackBottomButtonsHtml(id) {
    return '<div class="flex flex-col gap-2.5 w-full mt-1">' +
      '<a class="w-full h-12 rounded-full bg-primary text-on-primary font-label-lg text-label-lg flex items-center justify-center gap-2 shadow-md hover:opacity-95 transition-all active:scale-[0.99]" href="' + trackWaLink(id) + '" target="_blank" rel="noopener"><span class="material-symbols-outlined text-[20px]">chat</span><span>Bantuan &amp; Konfirmasi via WhatsApp</span></a>' +
      '<button class="w-full h-12 rounded-full bg-surface-container text-on-surface font-label-lg text-label-lg flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors" onclick="App.go(\'online\')" type="button"><span class="material-symbols-outlined text-[20px]">storefront</span><span>Kembali ke Beranda</span></button></div>';
  }
  function trackHeaderBannerHtml(t, isDemo) {
    var pillCls, pillInner;
    if (isDemo) {
      pillCls = "bg-secondary-container text-on-secondary-container";
      pillInner = '<span class="font-label-sm text-label-sm tracking-wide">Mode Demo</span>';
    } else {
      var done = normalizeStatus(t.status) === "Selesai";
      pillCls = "bg-primary text-on-primary shadow-sm";
      pillInner = (done ? "" : '<span class="relative flex h-2 w-2"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-fixed opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-primary-fixed"></span></span>') +
        '<span class="font-label-sm text-label-sm tracking-wide">' + esc(statusPillLabel(t.status)) + '</span>';
    }
    return '<div class="flex flex-col gap-2 pt-2 pb-4"><div class="flex items-center justify-between">' +
      '<div class="flex items-center gap-2"><span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary-fixed text-primary"><span class="material-symbols-outlined text-[16px]">moped</span></span>' +
      '<span class="font-headline-sm text-headline-sm text-on-surface">Lacak Status Pesanan</span></div>' +
      '<div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full ' + pillCls + '">' + pillInner + '</div></div>' +
      '<div class="flex items-center justify-between text-on-surface-variant"><span class="font-body-sm text-body-sm">ID Pesanan: <strong class="text-on-surface font-headline-sm">#' + esc(t.id) + '</strong></span>' +
      (t.timestamp ? '<span class="font-body-sm text-body-sm">Pukul ' + fmtTimeCairo(t.timestamp) + ' Kairo</span>' : "") + '</div></div>';
  }
  async function loadTrack(id) {
    // Demo mode: nothing is recorded, so there is nothing to track.
    if (state.demoMode) {
      state.trackOrder = null;
      state.trackError = "Mode demo: pesanan ini tidak tercatat di database, jadi tidak bisa dilacak.";
      render(); return false;
    }
    var res = await window.supabaseApi.trackOrder(id);
    if (res && res.ok) {
      state.trackOrder = res.data;
      state.trackOrderType = res.data.orderType;
      render();
      return true;
    }
    state.trackOrder = null; state.trackError = (res && res.message) || "Order not found.";
    render(); return false;
  }
  function renderOrder() {
    var t = state.trackOrder;
    var html = demoBannerHtml() + '<div class="flex flex-col gap-4 mt-4">';
    html += '<div class="flex items-center gap-2"><button onclick="App.go(\'online\')" class="w-11 h-11 -ml-2 rounded-full flex items-center justify-center text-on-surface hover:bg-surface-variant/40 transition-colors" aria-label="Kembali"><span class="material-symbols-outlined text-[22px]">arrow_back_ios_new</span></button><h2 class="font-headline-md text-headline-md text-on-surface flex-1">Pesanan</h2>' +
      (state.orderId ? '<button onclick="App.copyTrackingLink()" class="w-11 h-11 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-variant/40 transition-colors" aria-label="Bagikan link pesanan"><span class="material-symbols-outlined text-[22px]">share</span></button>' : "") + '</div>';
    html += '<div class="flex items-center gap-2.5"><div class="flex-1 h-12 bg-surface-container-lowest rounded-full px-4 flex items-center gap-2.5 shadow-[0_2px_10px_rgba(30,63,50,0.05)]"><span class="material-symbols-outlined text-outline text-[20px]">search</span><input id="track-inline" class="w-full bg-transparent font-body-md text-body-md text-on-surface placeholder:text-outline focus:outline-none font-mono uppercase" placeholder="YYMMDD-XXXX" value="' + esc(state.orderId || "") + '"></div><button onclick="App.trackFromInline()" class="w-12 h-12 rounded-full bg-primary-container text-on-primary flex items-center justify-center shadow-sm active:scale-95 transition-transform" aria-label="Lacak"><span class="material-symbols-outlined text-[20px]">search</span></button></div>';
    if (state.demoMode && state.demoOrder && String(state.demoOrder.id) === String(state.orderId)) {
      var d = state.demoOrder;
      var dAddr = d.address || (state.member && state.member.address) || "";
      var dMaps = d.mapsUrl || (state.member && state.member.maps_url) || "";
      html += '<div class="flex flex-col w-full pb-8">';
      html += trackHeaderBannerHtml({ id: d.id, status: "Pending", timestamp: d.timestamp }, true);
      html += '<div class="flex flex-col gap-6">';
      html += trackDetailsCardHtml({ id: d.id, paymentMethod: d.paymentMethod, orderType: d.orderType, notes: d.notes, total: d.total }, d.items || [], dAddr, dMaps, d.subtotal, d.service, d.tax);
      html += '<p class="font-label-md text-label-md text-primary-container">Pesananmu sudah dikirim ke WhatsApp admin. Mode demo: pesanan ini tidak tercatat di database, jadi statusnya tidak bisa dilacak di sini — admin akan konfirmasi lewat WhatsApp.</p>';
      html += trackBottomButtonsHtml(d.id);
      html += '</div></div>';
    }
    if (state.trackError) html += '<p class="font-label-md text-label-md text-error">' + esc(state.trackError) + '</p>';
    if (t) {
      // track-order mengembalikan alamat/mapsUrl pelanggan dari order itu
      // sendiri, jadi tamu pun melihat alamat pengiriman di link lacak.
      // Fallback: alamat member yang sedang login; terakhir, rakit Maps URL
      // dari latitude/longitude bila ada.
      var addr = t.address || (state.member && state.member.address) || "";
      var mapsUrl = t.mapsUrl || (state.member && state.member.maps_url) || "";
      if (!mapsUrl && t.latitude && t.longitude) mapsUrl = "https://maps.google.com/?q=" + t.latitude + "," + t.longitude;
      html += '<div class="flex flex-col w-full pb-8">';
      html += trackHeaderBannerHtml(t, false);
      html += '<div class="flex flex-col gap-6">';
      html += trackMapCardHtml(t, addr);
      html += trackTimelineHtml(t);
      html += trackDetailsCardHtml(t, t.items || [], addr, mapsUrl);
      html += trackCareCardHtml();
      html += trackBottomButtonsHtml(t.id);
      html += '</div></div>';
    }
    html += '</div>';
    return html;
  }
  function copyTrackingLink(id) {
    id = id || state.orderId;
    if (!id) return;
    var link = trackingLink(id);
    function done() { alert("Link pesanan disalin: " + link); }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(link).then(done, function () { window.prompt("Salin link pesanan:", link); }); }
    else window.prompt("Salin link pesanan:", link);
  }

  // ---------- render: rewards (Stitch reward + gaya kartu status_pelanggan) ----------
  // Reward terdekat BERDASARKAN point_price produk asli (bukan tier karangan).
  // Hanya 4 menu yang bisa ditukar poin (data seed/demo: point_price > 0):
  // Matcha 80, Thai Tea 65, Kopi Susu Khatulistiwa 60, Dimsum Goreng Ori 80.
  // Produk lain point_price-nya 0, jadi tombol "Tukar Pts" tidak muncul di kartunya.
  function redeemableProducts() {
    return state.products.filter(function (p) { return Number(p.point_price || 0) > 0 && p.status === "Active"; });
  }
  function nearestReward(points) {
    var list = redeemableProducts();
    if (!list.length) return null;
    var sorted = list.slice().sort(function (a, b) { return Number(a.point_price) - Number(b.point_price); });
    var next = null;
    for (var i = 0; i < sorted.length; i++) { if (Number(sorted[i].point_price) > points) { next = sorted[i]; break; } }
    return { next: next, cheapest: sorted[0], mostExpensive: sorted[sorted.length - 1] };
  }
  function redeemCard(p) {
    var img = p.imageUrl
      ? '<img src="' + esc(p.imageUrl) + '" alt="' + esc(displayName(p.name)) + '" class="w-full h-full object-cover" loading="lazy" onerror="this.style.display=\'none\'">'
      : '<div class="w-full h-full bg-surface-container flex items-center justify-center"><span class="material-symbols-outlined text-[28px] text-outline">' + (CAT_ICON[p.category] || "local_dining") + '</span></div>';
    return '<article onclick="App.addToCart(\'' + esc(p.id) + '\', true)" class="flex flex-col rounded-[20px] bg-surface-container-lowest p-3 shadow-[0_6px_18px_-4px_rgba(30,63,50,0.06)] justify-between cursor-pointer active:scale-[0.99] transition-transform">' +
      '<div class="flex flex-col gap-2"><div class="relative w-full aspect-square rounded-[16px] overflow-hidden bg-surface-container">' + img + '</div>' +
      '<div class="flex flex-col"><h3 class="font-headline-sm text-headline-sm text-on-surface truncate">' + esc(displayName(p.name)) + '</h3>' +
      '<div class="flex items-center gap-1 text-on-tertiary-container mt-0.5"><span class="material-symbols-outlined text-[14px]" style="font-variation-settings:\'FILL\' 1">stars</span><span class="font-price-tag text-price-tag font-bold">' + Number(p.point_price) + ' Poin</span></div></div></div>' +
      '<button onclick="event.stopPropagation();App.addToCart(\'' + esc(p.id) + '\', true)" class="mt-3 w-full h-9 rounded-full bg-primary-container text-on-primary font-label-md text-label-md flex items-center justify-center active:scale-95 transition-transform">Tukar</button></article>';
  }
  function renderRewards() {
    var m = state.member;
    var pts = m ? Number(m.points || 0) : 0;
    var redeemable = redeemableProducts();
    var nr = nearestReward(pts);
    var html = demoBannerHtml() + '<div class="flex flex-col gap-5 mt-4">';
    html += '<section class="relative overflow-hidden rounded-[24px] bg-primary-container text-on-primary p-6 shadow-[0_12px_28px_-6px_rgba(30,63,50,0.18)]">';
    html += '<div class="absolute -right-12 -top-12 w-44 h-44 rounded-full bg-primary-fixed-dim/10 blur-2xl pointer-events-none"></div><div class="absolute right-4 bottom-2 text-primary-fixed-dim/10 select-none pointer-events-none"><span class="material-symbols-outlined text-[110px] leading-none">stars</span></div>';
    html += '<div class="relative z-10 flex flex-col gap-4">';
    html += '<div class="flex items-center justify-between"><div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-lowest/15 backdrop-blur-md text-primary-fixed"><span class="material-symbols-outlined text-[16px]" style="font-variation-settings:\'FILL\' 1">military_tech</span><span class="font-label-sm text-label-sm uppercase tracking-wider">' + (m ? "Member Khatulistiwa" : "Khatulistiwa Rewards") + '</span></div></div>';
    if (m) {
      html += '<div class="flex flex-col"><div class="flex items-baseline gap-2"><span class="font-display-hero text-display-hero text-surface tracking-tight font-extrabold">' + pts + '</span><span class="font-headline-md text-headline-md text-primary-fixed font-bold">Poin</span></div><p class="font-body-sm text-body-sm text-primary-fixed-dim/90 mt-0.5">1 poin untuk setiap kelipatan 10 LE pesanan Anda</p></div>';
      if (nr && nr.next) {
        var pct = Math.min(100, Math.round(pts / Number(nr.next.point_price) * 100));
        html += '<div class="flex flex-col gap-1.5"><div class="flex items-center justify-between font-label-md text-label-md"><span class="text-surface font-semibold">Reward Terdekat: ' + esc(displayName(nr.next.name)) + '</span><span class="text-primary-fixed font-bold">' + pts + ' / ' + Number(nr.next.point_price) + ' Poin</span></div><div class="w-full h-2.5 bg-surface-container-lowest/20 rounded-full overflow-hidden p-0.5"><div class="h-full bg-primary-fixed rounded-full transition-all duration-700" style="width:' + pct + '%"></div></div><p class="font-body-sm text-body-sm text-primary-fixed-dim/80">Kurang ' + (Number(nr.next.point_price) - pts) + ' poin lagi untuk menukar ' + esc(displayName(nr.next.name)) + '</p></div>';
      } else if (nr && nr.mostExpensive) {
        html += '<div class="flex flex-col gap-1.5"><div class="flex items-center justify-between font-label-md text-label-md"><span class="text-surface font-semibold">Semua reward bisa ditukar</span><span class="text-primary-fixed font-bold">' + pts + ' Poin</span></div><div class="w-full h-2.5 bg-surface-container-lowest/20 rounded-full overflow-hidden p-0.5"><div class="h-full bg-primary-fixed rounded-full" style="width:100%"></div></div><p class="font-body-sm text-body-sm text-primary-fixed-dim/80">Poinmu cukup untuk semua reward di bawah — termasuk ' + esc(displayName(nr.mostExpensive.name)) + ' (' + Number(nr.mostExpensive.point_price) + ' poin)!</p></div>';
      }
    } else {
      html += '<div class="flex flex-col"><p class="font-headline-md text-headline-md text-surface">Kumpulkan poin di setiap pesanan</p><p class="font-body-sm text-body-sm text-primary-fixed-dim/90 mt-1">Masuk dengan Google untuk menyimpan poinmu di semua perangkat. 1 poin untuk setiap kelipatan 10 LE.</p></div>';
      html += '<div><button onclick="App.signInWithGoogle()" class="inline-flex items-center gap-2 px-4 py-2.5 bg-surface text-primary-container rounded-full font-label-md text-label-md shadow-sm active:scale-95 transition-transform"><span>Masuk dengan Google</span><span class="material-symbols-outlined text-[16px]">arrow_forward</span></button></div>';
    }
    html += '</div></section>';
    if (!m) {
      html += '<section class="flex items-center justify-between gap-4 p-4 rounded-[20px] bg-surface-container-lowest shadow-[0_6px_18px_-4px_rgba(30,63,50,0.06)]"><div class="flex items-center gap-3 min-w-0"><div class="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center shrink-0 text-primary-container"><span class="material-symbols-outlined text-[20px]">sync_saved_locally</span></div><div class="flex flex-col min-w-0"><span class="font-headline-sm text-headline-sm text-on-surface truncate">Amankan Poin Anda</span><span class="font-body-sm text-body-sm text-on-surface-variant truncate">Sinkron riwayat pesanan &amp; reward</span></div></div><button onclick="App.signInWithGoogle()" class="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-surface-variant text-on-surface active:scale-95 transition-transform"><svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24"><path d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z" fill="#4285F4"></path><path d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z" fill="#34A853"></path><path d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z" fill="#FBBC05"></path><path d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" fill="#EA4335"></path></svg><span class="font-label-md text-label-md">Masuk</span></button></section>';
    }
    html += '<section class="flex flex-col gap-3"><div class="flex items-center justify-between"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary-container text-[22px]">redeem</span><h2 class="font-headline-md text-headline-md text-on-surface">Tukar Poin Anda</h2></div><span class="font-label-sm text-label-sm text-secondary uppercase font-bold tracking-wider">Tersedia</span></div>';
    html += redeemable.length ? '<div class="grid grid-cols-2 gap-3">' + redeemable.slice(0, 12).map(redeemCard).join("") + '</div>' : '<p class="font-body-md text-body-md text-on-surface-variant">Belum ada menu yang bisa ditukar poin.</p>';
    html += '</section>';
    // Riwayat poin: hanya dari data nyata (belum ada sumbernya) — jangan karang.
    html += '<section class="flex flex-col gap-3"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary-container text-[22px]">history</span><h2 class="font-headline-md text-headline-md text-on-surface">Riwayat Aktivitas Poin</h2></div><div class="rounded-[24px] bg-surface-container-lowest p-4 shadow-[0_6px_18px_-4px_rgba(30,63,50,0.06)]"><p class="font-body-md text-body-md text-on-surface-variant text-center py-2">Belum ada riwayat poin.</p></div></section>';
    html += '</div>';
    return html;
  }

  // ---------- render: profile (Stitch profil) ----------
  function memberSince(m) {
    var d = m && (m.created_at || m.createdAt || m.member_since);
    if (!d) return "—";
    var dt = new Date(d); if (isNaN(dt.getTime())) return "—";
    return MONTHS_ID[dt.getMonth()] + " " + dt.getFullYear();
  }
  function completedOrdersCount(m) {
    if (!m) return 0;
    return (state.transactions || []).filter(function (t) {
      return t.status === "Selesai" && (String(t.customer_id || t.customerId || "") === String(m.id) || String(t.phone || "") === String(m.phone || ""));
    }).length;
  }
  function activeOrdersCount() {
    return (state.transactions || []).filter(function (t) { return ["Pending", "Dibuat", "Diantar"].indexOf(t.status) !== -1; }).length;
  }
  function statCard(icon, chipCls, value, label) {
    return '<div class="bg-surface-container-lowest rounded-2xl p-3.5 flex flex-col items-center justify-center text-center shadow-[0_6px_18px_-4px_rgba(30,63,50,0.04)]"><div class="w-8 h-8 rounded-full ' + chipCls + ' flex items-center justify-center mb-1"><span class="material-symbols-outlined text-[16px]" style="font-variation-settings:\'FILL\' 1">' + icon + '</span></div><span class="font-headline-md text-headline-md text-primary-container leading-none">' + esc(value) + '</span><span class="font-label-sm text-label-sm text-on-surface-variant mt-1">' + esc(label) + '</span></div>';
  }
  function menuRow(icon, chipCls, title, sub, badgeHtml, onclick, href) {
    var inner = '<div class="flex items-center gap-3"><div class="w-10 h-10 rounded-full ' + chipCls + ' flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[20px]">' + icon + '</span></div><div class="flex flex-col"><span class="font-headline-sm text-headline-sm text-on-surface">' + esc(title) + '</span><span class="font-body-sm text-body-sm text-on-surface-variant">' + esc(sub) + '</span></div></div><div class="flex items-center gap-2">' + (badgeHtml || "") + '<span class="material-symbols-outlined text-outline text-[18px]">chevron_right</span></div>';
    var cls = "flex items-center justify-between p-3 rounded-xl hover:bg-surface-container-low active:bg-surface-container transition-colors";
    if (href) return '<a class="' + cls + '" href="' + href + '" target="_blank" rel="noopener">' + inner + '</a>';
    return '<button onclick="' + onclick + '" class="' + cls + ' w-full text-left">' + inner + '</button>';
  }
  function editAddress() {
    var m = state.member;
    if (!m) { signInWithGoogle(); return; }
    var el = $("pf-address");
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.focus(); }
  }
  function aboutApp() { alert("Khatulistiwa Resto — Resto Indonesia di Cairo, Mesir.\nPesan online, bayar Cash / QRIS / Transfer.\nWhatsApp admin: +20 1515041807"); }
  function renderProfile() {
    var m = state.member;
    var html = demoBannerHtml() + '<div class="flex flex-col gap-5 mt-4">';
    html += '<section class="bg-surface-container-lowest rounded-2xl p-4 shadow-[0_6px_18px_-4px_rgba(30,63,50,0.06)] relative overflow-hidden">';
    html += '<div class="absolute -right-6 -bottom-6 w-28 h-28 bg-surface-container rounded-full opacity-40 pointer-events-none"></div>';
    if (m) {
      var initial = String(m.name || "G").trim().charAt(0).toUpperCase();
      html += '<div class="flex items-center justify-between mb-4 relative z-10"><div class="flex items-center gap-3.5"><div class="relative shrink-0">' +
        (m.avatar_url ? '<img src="' + esc(m.avatar_url) + '" class="w-14 h-14 rounded-full object-cover shadow-sm" alt="">' : '<div class="w-14 h-14 rounded-full bg-primary-container text-on-primary flex items-center justify-center font-headline-lg text-headline-lg shadow-sm">' + esc(initial) + '</div>') +
        '<span class="absolute bottom-0 right-0 w-4 h-4 bg-primary text-on-primary rounded-full flex items-center justify-center shadow-sm"><span class="material-symbols-outlined text-[11px]" style="font-variation-settings:\'FILL\' 1">check</span></span></div>' +
        '<div class="flex flex-col min-w-0"><div class="flex items-center gap-2"><h2 class="font-headline-md text-headline-md text-on-surface truncate">' + esc(m.name) + '</h2><span class="material-symbols-outlined text-primary-container text-[16px]" style="font-variation-settings:\'FILL\' 1">verified</span></div><p class="font-body-sm text-body-sm text-on-surface-variant truncate">' + esc(m.email || "") + '</p></div></div>' +
        '<button onclick="App.editAddress()" class="shrink-0 bg-surface-container hover:bg-surface-variant active:scale-95 transition-all text-on-surface-variant rounded-full px-3 py-1.5 flex items-center gap-1 font-label-md text-label-md"><span class="material-symbols-outlined text-[14px]">edit</span><span>Edit</span></button></div>';
      html += '<button onclick="App.go(\'rewards\')" class="w-full bg-surface-container-low rounded-xl p-3 flex items-center justify-between relative z-10 text-left"><div class="flex items-center gap-2"><div class="w-7 h-7 rounded-full bg-secondary-fixed text-on-secondary-fixed flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[16px]" style="font-variation-settings:\'FILL\' 1">military_tech</span></div><div><span class="font-label-sm text-label-sm uppercase tracking-wider text-secondary block leading-none">Status Pelanggan</span><span class="font-label-md text-label-md text-on-surface font-semibold">Member Khatulistiwa</span></div></div><span class="material-symbols-outlined text-outline text-[18px]">chevron_right</span></button>';
    } else {
      html += '<div class="relative z-10"><h2 class="font-headline-md text-headline-md text-on-surface">Profile</h2><p class="font-body-sm text-body-sm text-on-surface-variant mt-1">Kamu masih pesan sebagai Guest. Masuk dengan Google untuk menyimpan alamat, lokasi delivery, dan poin.</p>' +
      '<button onclick="App.signInWithGoogle()" class="w-full mt-4 h-12 rounded-full bg-primary-container text-on-primary font-label-lg text-label-lg">Masuk dengan Google</button>' +
      '<p class="font-body-sm text-body-sm text-outline mt-3">Guest tetap bisa pesan — isi nama, nomor WA, dan alamat di checkout. Poin hanya tersimpan untuk member.</p></div>';
    }
    html += '</section>';
    if (m) {
      html += '<section class="grid grid-cols-3 gap-2.5">' +
        statCard("stars", "bg-secondary-fixed text-on-secondary-fixed", String(Number(m.points || 0)), "Poin Rewards") +
        statCard("receipt_long", "bg-primary-fixed text-on-primary-fixed", String(completedOrdersCount(m)), "Pesanan Selesai") +
        statCard("calendar_today", "bg-surface-variant text-on-surface-variant", memberSince(m), "Bergabung") +
      '</section>';
      var addr = m.address || "";
      var mapsUrl = m.maps_url || ((m.latitude && m.longitude) ? "https://maps.google.com/?q=" + m.latitude + "," + m.longitude : "");
      html += '<section class="bg-surface-container-lowest rounded-2xl p-4 shadow-[0_6px_18px_-4px_rgba(30,63,50,0.06)] flex flex-col gap-3">';
      html += '<div class="flex items-center justify-between"><div class="flex items-center gap-2"><div class="w-8 h-8 rounded-full bg-on-tertiary-container/10 flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-on-tertiary-container text-[18px]">place</span></div><div class="flex flex-col"><span class="font-label-sm text-label-sm text-secondary uppercase tracking-wider">Lokasi Utama Antar</span><h3 class="font-headline-sm text-headline-sm text-on-surface">Alamat Tersimpan</h3></div></div>' + (addr ? '<span class="bg-primary-fixed text-on-primary-fixed font-label-sm text-label-sm px-2.5 py-0.5 rounded-full font-semibold">Utama</span>' : '') + '</div>';
      html += '<div class="bg-surface-container-low rounded-xl p-3 flex flex-col gap-1.5">' + (addr ? '<p class="font-body-md text-body-md text-on-surface leading-snug font-medium">' + esc(addr) + '</p>' : '<p class="font-body-md text-body-md text-on-surface-variant">Belum ada alamat tersimpan.</p>') + '</div>';
      html += '<div class="flex items-center gap-2 pt-1">' +
        (mapsUrl ? '<a class="flex-1 bg-surface-container hover:bg-surface-variant text-on-surface font-label-md text-label-md py-2.5 px-3 rounded-full flex items-center justify-center gap-1 active:scale-95 transition-transform" href="' + esc(mapsUrl) + '" target="_blank" rel="noopener"><span>Buka di Google Maps</span><span class="material-symbols-outlined text-[15px]">arrow_outward</span></a>' : '') +
        '<button onclick="App.editAddress()" class="bg-primary-container text-on-primary font-label-md text-label-md py-2.5 px-4 rounded-full flex items-center justify-center gap-1 shadow-sm active:scale-95 transition-transform"><span class="material-symbols-outlined text-[15px]">edit_location_alt</span><span>Ubah Alamat</span></button></div>';
      html += '</section>';
      html += '<section class="bg-surface-container-lowest rounded-2xl p-4 shadow-[0_6px_18px_-4px_rgba(30,63,50,0.06)] flex flex-col gap-3">';
      html += '<span class="font-headline-sm text-headline-sm text-on-surface">Edit Profil</span>';
      html += '<label class="font-label-sm text-label-sm text-on-surface-variant">NO. WHATSAPP</label><input id="pf-phone" class="w-full p-3 rounded-xl bg-surface-container-low font-body-md text-body-md text-on-surface outline-none focus:ring-2 ring-primary-container" value="' + esc(m.phone || "") + '">';
      html += '<label class="font-label-sm text-label-sm text-on-surface-variant">ALAMAT TERSIMPAN</label><textarea id="pf-address" rows="2" class="w-full p-3 rounded-xl bg-surface-container-low font-body-md text-body-md text-on-surface outline-none focus:ring-2 ring-primary-container resize-none">' + esc(m.address || "") + '</textarea>';
      html += '<div class="flex gap-2 items-center flex-wrap"><button onclick="App.shareLocation(true)" class="flex items-center gap-1.5 font-label-md text-label-md text-primary-container bg-primary-fixed/40 px-3 py-2 rounded-full"><span class="material-symbols-outlined text-[16px]">my_location</span>Bagikan Lokasi Saya</button><span id="pf-location" class="font-body-sm text-body-sm text-on-surface-variant">' + (mapsUrl ? '<a class="underline text-primary-container" href="' + esc(mapsUrl) + '" target="_blank" rel="noopener">Lokasi tersimpan</a>' : "") + '</span></div>';
      html += '<button onclick="App.saveProfile()" class="w-full h-12 rounded-full bg-primary-container text-on-primary font-label-lg text-label-lg">Simpan Profil</button>';
      html += '</section>';
    }
    var act = activeOrdersCount();
    html += '<section class="bg-surface-container-lowest rounded-2xl p-2 shadow-[0_6px_18px_-4px_rgba(30,63,50,0.06)] flex flex-col">';
    html += menuRow("lunch_dining", "bg-primary-fixed-dim/30 text-primary-container", "Pesanan Saya", "Riwayat transaksi & status antar", act > 0 ? '<span class="bg-error-container text-on-error-container font-label-sm text-label-sm font-semibold px-2 py-0.5 rounded-full">' + act + ' Aktif</span>' : "", "App.toggleTrack()");
    html += menuRow("location_city", "bg-secondary-fixed/40 text-secondary", "Alamat Tersimpan", "Kelola daftar alamat di Kairo", "", "App.editAddress()");
    html += menuRow("support_agent", "bg-primary-fixed text-primary-container", "Bantuan CS WhatsApp", "Hubungi layanan kami di Mesir (+20)", "", null, "https://wa.me/" + ADMIN_PHONE);
    html += menuRow("info", "bg-surface-container text-on-surface-variant", "Tentang Khatulistiwa Resto", "Cita rasa Nusantara di Kairo, Mesir", "", "App.about()");
    html += '</section>';
    if (m) {
      html += '<section class="pt-1 pb-4 flex flex-col items-center"><button onclick="App.signOutGoogle()" class="w-full bg-error-container/60 hover:bg-error-container active:scale-[0.99] text-on-error-container rounded-full py-3 px-6 flex items-center justify-center gap-2 font-headline-sm text-headline-sm transition-all shadow-sm"><span class="material-symbols-outlined text-[20px]">logout</span><span>Keluar Akun</span></button><p class="font-label-sm text-label-sm text-on-surface-variant/70 mt-3 text-center">Khatulistiwa Restaurant Cairo • Taste of Archipelago</p></section>';
    }
    html += '<section class="bg-surface-container-lowest rounded-2xl p-4 shadow-[0_6px_18px_-4px_rgba(30,63,50,0.06)]"><h3 class="font-headline-sm text-headline-sm text-on-surface">Untuk Staf</h3><p class="font-body-sm text-body-sm text-on-surface-variant">POS, Kitchen, Transaksi, dan Data Pelanggan ada di halaman Admin (login PIN).</p><button onclick="App.go(\'admin\')" class="mt-2 px-4 py-2 rounded-full bg-primary-container text-on-primary font-label-md text-label-md">Buka Admin</button></section>';
    html += '</div>';
    return html;
  }

  // ---------- checkout ----------
  function syncCheckoutSelectors() {
    var ot = $("co-ordertype");
    if (ot) ot.querySelectorAll(".ot-btn").forEach(function (b) {
      var sel = b.getAttribute("data-v") === state.orderType;
      b.className = "ot-btn flex-1 py-2 px-1 rounded-full font-label-md text-label-md flex items-center justify-center gap-1 transition-all " + (sel ? "bg-primary-container text-on-primary shadow-sm" : "text-on-surface-variant");
    });
    // POS admin panel uses the same order-type control (v1 style).
    var pot = $("pos-ordertype");
    if (pot) pot.querySelectorAll(".ot-btn").forEach(function (b) {
      var sel = b.getAttribute("data-v") === state.orderType;
      b.className = "ot-btn flex-1 py-2 rounded-lg text-sm font-medium transition-all " + (sel ? "bg-white text-black shadow-sm" : "text-gray-500");
    });
    document.querySelectorAll(".co-pay-row").forEach(function (row) {
      var sel = row.getAttribute("data-v") === state.payment;
      row.classList.toggle("bg-surface-container-low", sel);
      var radio = row.querySelector(".pay-radio"), dot = row.querySelector(".pay-dot");
      if (radio) radio.className = "pay-radio w-5 h-5 rounded-full flex items-center justify-center shrink-0 " + (sel ? "bg-primary-container" : "bg-surface-dim");
      if (dot) dot.classList.toggle("hidden", !sel);
    });
  }
  // Isi awal form checkout dari data member (hanya kolom yang masih kosong).
  function prefillCheckoutForm() {
    var m = state.member;
    if (!m) return;
    if ($("co-name") && !$("co-name").value) $("co-name").value = m.name || "";
    if ($("co-phone") && !$("co-phone").value) $("co-phone").value = m.phone || "";
    if ($("co-address") && !$("co-address").value) $("co-address").value = m.address || "";
    if (m.latitude && m.longitude) {
      state.location = { latitude: m.latitude, longitude: m.longitude, mapsUrl: m.maps_url || ("https://maps.google.com/?q=" + m.latitude + "," + m.longitude) };
      var loc = $("co-location");
      if (loc) loc.innerHTML = '<span class="material-symbols-outlined text-[14px] align-middle">location_on</span> Lokasi tersimpan dipakai';
    }
  }
  // Checkout kini inline di dalam drawer keranjang (tanpa pop-up kedua):
  // cukup buka drawer dan gulir ke form checkout.
  function openCheckout() {
    if (!state.cart.length) { alert("Keranjang masih kosong."); return; }
    prefillCheckoutForm();
    App.toggleCart(true);
    setTimeout(function () { var f = $("checkout-form"); if (f && f.scrollIntoView) f.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60);
  }
  function renderCheckoutSummary() {
    var t = cartTotals();
    var idr = $("co-idr");
    if (state.payment === "Transfer") {
      var rate = Number(String(state.settings.egp_to_idr_rate || "327.7").replace(/^'/, "")) || 327.7;
      idr.textContent = "Bayar Transfer dalam IDR: Rp" + Math.round(t.total * rate).toLocaleString("id-ID") + " (kurs " + rate + " IDR/LE)";
      idr.classList.remove("hidden");
    } else idr.classList.add("hidden");
    var n = state.cart.reduce(function (a, c) { return a + c.qty; }, 0);
    $("co-summary").innerHTML = state.cart.map(function (c) {
      return '<div class="flex justify-between font-body-md text-body-md text-on-surface-variant"><span>' + c.qty + ' × ' + esc(displayName(c.name)) + (c.isRedeemed ? ' <b class="text-primary-container">(Tukar Poin)</b>' : '') + '</span><b class="font-headline-sm text-headline-sm text-on-surface">' + (c.isRedeemed ? (Number(c.point_price) * c.qty) + ' Pts' : fmt(c.price * c.qty)) + '</b></div>';
    }).join("") +
    '<div class="border-t border-surface-variant/70 mt-2 pt-2 flex flex-col gap-1.5">' +
    '<div class="flex justify-between font-body-md text-body-md text-on-surface-variant"><span>Subtotal (' + n + ' item)</span><span class="font-headline-sm text-headline-sm text-on-surface">' + fmt(t.subtotal) + '</span></div>' +
    (t.service > 0 ? '<div class="flex justify-between font-body-md text-body-md text-on-surface-variant"><span>Tausil</span><span class="font-headline-sm text-headline-sm text-on-surface">' + fmt(t.service) + '</span></div>' : '') +
    '<div class="flex justify-between font-body-md text-body-md text-on-surface-variant"><span>Tax 10%</span><span class="font-headline-sm text-headline-sm text-on-surface">' + fmt(t.tax) + '</span></div>' +
    '<div class="flex justify-between items-center pt-1"><div><span class="font-headline-md text-headline-md text-on-surface block">Total Pembayaran</span><span class="font-body-sm text-body-sm text-outline">' + (state.orderType === "Delivery" ? "Termasuk tausil &amp; pajak" : "Termasuk pajak") + '</span></div><span class="font-display-hero-mobile text-display-hero-mobile text-primary-container">' + fmt(t.total) + '</span></div>' +
    (t.pointsCost ? '<div class="flex justify-between font-label-md text-label-md text-primary-container"><span>Poin dipakai</span><span>' + t.pointsCost + ' Pts</span></div>' : '') +
    (state.member ? '<div class="flex justify-between font-label-md text-label-md text-primary-container"><span>Poin didapat</span><span>+' + t.pointsEarned + ' Pts</span></div>' : '') + '</div>';
  }
  async function lookupPhone() {
    var phone = $("co-phone").value.trim();
    if (phone.replace(/\D/g, "").length < 7) return;
    var res = await window.supabaseApi.lookupCustomerByPhone(phone);
    if (res && res.ok && res.data) {
      if (!$("co-name").value) $("co-name").value = res.data.name || "";
      if (!$("co-address").value && res.data.address) $("co-address").value = res.data.address;
    }
  }
  function shareLocation(isProfile) {
    if (!navigator.geolocation) { alert("Browser ini tidak mendukung lokasi."); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lng = pos.coords.longitude;
      state.location = { latitude: lat, longitude: lng, mapsUrl: "https://maps.google.com/?q=" + lat + "," + lng };
      var el = $(isProfile ? "pf-location" : "co-location");
      if (el) el.innerHTML = '<a class="inline-flex items-center gap-1 underline text-primary-container" href="' + state.location.mapsUrl + '" target="_blank" rel="noopener"><span class="material-symbols-outlined text-[14px]">location_on</span>Lokasi tersimpan</a>';
    }, function () { alert("Izin lokasi ditolak. Kamu tetap bisa ketik alamat manual."); });
  }
  function buildWhatsAppText(txnId, t) {
    var m = state.member;
    var lines = [];
    lines.push("*Pesanan Online - Khatulistiwa Resto*");
    lines.push("Order ID: " + txnId);
    lines.push("Nama: " + $("co-name").value.trim());
    lines.push("No. WA: " + $("co-phone").value.trim());
    lines.push("Tipe: " + (state.orderType === "Delivery" ? "Tausil" : state.orderType));
    var addr = $("co-address").value.trim();
    if (addr) lines.push("Alamat: " + addr);
    if (state.location) lines.push("Lokasi: " + state.location.mapsUrl);
    lines.push("--------------------------------");
    state.cart.forEach(function (c) {
      lines.push(c.qty + "x " + c.name + " — " + (c.isRedeemed ? (Number(c.point_price) * c.qty) + " Pts" : fmt(c.price * c.qty)));
    });
    lines.push("--------------------------------");
    lines.push("*TOTAL: " + fmt(t.total) + " (" + state.payment + ")*");
    if (t.pointsCost) lines.push("Poin dipakai: " + t.pointsCost + " Pts");
    if (m) lines.push("Poin member: " + Number(m.points || 0) + " Pts");
    if ($("co-notes").value.trim()) lines.push("Catatan: " + $("co-notes").value.trim());
    if (state.demoMode) {
      // No recorded order exists, so there is no tracking link to share.
      lines.push("Mode demo: pesanan ini tidak tercatat di database.");
    } else {
      lines.push("Lacak pesanan: " + trackingLink(txnId));
    }
    if (state.orderType === "Delivery" && !state.location) {
      lines.push("Mohon share lokasi (Share Location) via WhatsApp setelah pesan ini terkirim.");
    }
    return lines.join("\n");
  }
  async function submitOrder() {
    var name = $("co-name").value.trim(), phone = $("co-phone").value.trim(), address = $("co-address").value.trim();
    var err = $("co-error");
    // Pesan error biasa (mis. kegagalan server): teks kecil seperti semula.
    function fail(msg) { err.textContent = msg; err.classList.remove("hidden"); err.classList.remove("co-error-loud"); }
    // Kegagalan validasi: notifikasi menonjol + tombol Accept bergoyang +
    // drawer otomatis scroll ke kolom pertama yang belum diisi.
    function failValidation(msg, fieldId) {
      err.innerHTML = '<span class="material-symbols-outlined text-[18px]">warning</span><span>' + esc(msg) + '</span>';
      err.classList.remove("hidden");
      err.classList.add("co-error-loud");
      var btn = $("co-accept");
      if (btn) {
        btn.classList.remove("shake");
        void btn.offsetWidth; // restart animasi bila ditekan berulang
        btn.classList.add("shake");
        setTimeout(function () { btn.classList.remove("shake"); }, 600);
      }
      var field = fieldId ? $(fieldId) : null;
      if (field) {
        if (field.scrollIntoView) field.scrollIntoView({ behavior: "smooth", block: "center" });
        if (field.focus) field.focus({ preventScroll: true });
        field.style.outline = "2px solid #ba1a1a";
        field.style.outlineOffset = "1px";
        var clear = function () {
          field.style.outline = "";
          field.style.outlineOffset = "";
          if (field.removeEventListener) field.removeEventListener("input", clear);
        };
        if (field.addEventListener) field.addEventListener("input", clear);
      }
    }
    // Reset error dari percobaan sebelumnya.
    err.classList.add("hidden"); err.classList.remove("co-error-loud"); err.textContent = "";
    if (!name) return failValidation("Isi nama dulu.", "co-name");
    if (phone.replace(/\D/g, "").length < 7) return failValidation("Isi nomor WhatsApp yang valid.", "co-phone");
    if (state.orderType === "Delivery" && !address) return failValidation("Isi alamat Tausil dulu (atau tekan Bagikan Lokasi).", "co-address");
    var t = cartTotals();
    var btn = $("co-accept");
    var acceptHtml = 'Accept &amp; Pesan via WhatsApp <span class="material-symbols-outlined text-[20px]">arrow_forward</span>';
    btn.disabled = true; btn.textContent = "Menyimpan pesanan...";
    var items = state.cart.map(function (c) {
      return { id: c.id, name: c.name, price: c.isRedeemed ? 0 : Number(c.price), qty: c.qty, point_price: Number(c.point_price || 0), isRedeemed: !!c.isRedeemed };
    });
    var payload = {
      phone: phone, name: name, address: address,
      orderType: state.orderType, paymentMethod: state.payment,
      transferCurrency: state.payment === "Transfer" ? "IDR" : "EGP",
      notes: $("co-notes").value.trim(),
      items: items, subtotal: t.subtotal, serviceCharge: t.service, tax: t.tax, total: t.total,
      customerId: state.member ? state.member.id : (state.posCustomerId && state.posCustomerId !== "Guest" ? state.posCustomerId : undefined),
      googleId: state.member && state.member.google_id ? state.member.google_id : undefined,
      email: state.member ? state.member.email : undefined,
      avatarUrl: state.member ? state.member.avatar_url : undefined,
      latitude: state.location ? state.location.latitude : (state.member ? state.member.latitude : undefined),
      longitude: state.location ? state.location.longitude : (state.member ? state.member.longitude : undefined),
      mapsUrl: state.location ? state.location.mapsUrl : (state.member ? state.member.maps_url : undefined),
    };
    var res, txnId;
    if (state.demoMode) {
      // Demo mode: no database to record into — order goes straight to WA
      // with a local DEMO- id and no tracking link (see buildWhatsAppText).
      txnId = "DEMO-" + Date.now().toString().slice(-6);
      btn.disabled = false; btn.innerHTML = acceptHtml;
    } else {
      res = await window.supabaseApi.submitOnlineOrder(payload);
      btn.disabled = false; btn.innerHTML = acceptHtml;
      if (!res || !res.ok) return fail((res && res.message) || "Pesanan gagal disimpan. Coba lagi.");
      txnId = res.data.txnId;
    }
    // 1) order recorded first (Pending) — only now open WhatsApp.
    //    In demo mode the order is NOT recorded; WA is the only copy.
    var text = buildWhatsAppText(txnId, t);
    window.open("https://wa.me/" + ADMIN_PHONE + "?text=" + encodeURIComponent(text), "_blank");
    var demoOrder = state.demoMode ? { id: txnId, items: state.cart.slice(), total: t.total, subtotal: t.subtotal, service: t.service, tax: t.tax, orderType: state.orderType, paymentMethod: state.payment, address: address, mapsUrl: state.location ? state.location.mapsUrl : (state.member ? state.member.maps_url : ""), notes: $("co-notes").value.trim(), timestamp: new Date().toISOString() } : null;
    state.cart = []; saveCart(); renderCartBadge();
    App.toggleCart(false);
    state.view = "order"; state.orderId = txnId; state.trackOrder = null; state.trackError = "";
    state.demoOrder = demoOrder;
    history.replaceState(null, "", baseUrl() + "?view=order&id=" + encodeURIComponent(txnId));
    if (state.demoMode) render();
    else await loadTrack(txnId);
  }

  // ---------- admin (GASPOS v1 look) ----------
  // Admin/POS meniru aplikasi v1 GASPOS (khatulistiwa-resto-github-pages/
  // public/index.html): font Inter, kartu putih bento-card, tombol hitam,
  // ikon Lucide, sidebar GASPOS, kanban dapur, Customer View & Queue View.
  // Semua LOGIKA tetap v2: verifyPin (staff-api), status via staff-api,
  // submitOrder record-first-then-WhatsApp, Tausil 5 LE fixed (Delivery
  // saja) + Tax 10%, ID acak YYMMDD-XXXX, PIN 123456.
  // Ikon Lucide: panggil refreshIcons() setelah setiap render admin
  // (guarded — lucide CDN tidak ada di stub/harness offline).
  var CAT_ICON_LUCIDE = { "Nasi Gaol": "utensils", "Soup Tomyam": "soup", "Cemilan": "cookie", "Classic Drink": "coffee", "Premium Drink": "cup-soda", "Extra Topping": "plus-circle" };
  var SHEET_BY_MGMT = { products: "Products", categories: "Categories", employees: "Employees" };

  function refreshIcons() { try { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); } catch (e) {} }
  function updateClock() {
    var d = $("clock-date-part"), t = $("clock-time-part");
    if (d || t) {
      var now = new Date();
      if (d) d.textContent = now.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
      if (t) t.textContent = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    }
    var q = $("queue-clock"); if (q) q.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  function statusPill(status) {
    var cls = { "Pending": "bg-orange-100 text-orange-700", "Dibuat": "bg-blue-100 text-blue-700", "Diantar": "bg-teal-100 text-teal-700", "Selesai": "bg-green-100 text-green-700", "Void": "bg-gray-100 text-gray-500" }[status] || "bg-gray-100 text-gray-600";
    return '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ' + cls + '">' + esc(status) + '</span>';
  }
  function adminHeaderCard(title, sub, extraHtml) {
    return '<div class="flex flex-row gap-2 justify-between items-center bg-white p-4 md:p-6 border border-gray-100 rounded-3xl shadow-sm"><div class="min-w-0"><h2 class="text-xl md:text-3xl font-bold truncate">' + esc(title) + '</h2><p class="text-gray-500 text-xs md:text-base hidden md:block">' + esc(sub) + '</p></div><div class="flex flex-row items-center gap-2 shrink-0">' + (extraHtml || "") + '</div></div>';
  }
  function blackBtn(label, onclick, icon) {
    return '<button onclick="' + onclick + '" class="bg-black text-white px-3 md:px-4 py-2.5 rounded-xl text-[10px] md:text-xs font-bold flex items-center gap-1 md:gap-2 hover:opacity-90 shrink-0 justify-center">' + (icon ? '<i data-lucide="' + icon + '" class="w-4 h-4"></i>' : "") + esc(label) + '</button>';
  }

  // ---------- staff login (v1 GASPOS: glass card + PIN pad) ----------
  function staffEmployees() {
    if (state.employees && state.employees.length) return state.employees;
    return [
      { id: "E01", name: "Pak Surya Andika", role: "Admin Demo" },
      { id: "E02", name: "Mbak Fitri Lestari", role: "Admin" },
      { id: "E03", name: "Mas Bagas Nugroho", role: "Supervisor" },
      { id: "E04", name: "Mbak Sari Dewi", role: "Staff" },
    ];
  }
  function showStaffLogin() {
    var ov = $("staff-login"); if (!ov) return;
    ov.classList.remove("hidden");
    var acc = $("account-selector"), pin = $("pin-screen");
    if (acc) acc.classList.remove("hidden");
    if (pin) pin.classList.add("hidden");
    state.pinBuffer = "";
    updatePinDots();
    refreshIcons();
  }
  function hideStaffLogin() { var ov = $("staff-login"); if (ov) ov.classList.add("hidden"); }
  function openStaffModal() {
    var list = $("employee-list"); if (!list) return;
    list.innerHTML = staffEmployees().map(function (e) {
      var initial = String(e.name || "?").trim().charAt(0).toUpperCase();
      return '<button onclick="App.selectEmployee(\'' + esc(e.id) + '\')" class="w-full flex items-center gap-3 p-3 rounded-2xl border border-gray-100 hover:border-[#C7D957] hover:bg-[#F7F0DC]/40 transition-all text-left">' +
        '<span class="w-11 h-11 rounded-full bg-[#C7D957] flex items-center justify-center font-bold text-black shrink-0 overflow-hidden">' + (e.image_url ? '<img src="' + esc(e.image_url) + '" class="w-full h-full object-cover" alt="">' : esc(initial)) + '</span>' +
        '<span class="flex-1 min-w-0"><span class="block font-bold truncate">' + esc(e.name) + '</span><span class="block text-xs text-gray-400 uppercase tracking-widest">' + esc(e.role || "") + '</span></span>' +
        '<i data-lucide="chevron-right" class="w-4 h-4 text-gray-300 shrink-0"></i></button>';
    }).join("");
    var m = $("staff-selection-modal"); if (m) { m.classList.remove("hidden"); m.classList.add("flex", "modal-open"); }
    refreshIcons();
  }
  function closeStaffModal() {
    var m = $("staff-selection-modal"); if (!m) return;
    m.classList.add("hidden"); m.classList.remove("flex", "modal-open");
  }
  function selectEmployee(id) {
    state.selectedEmployeeId = id;
    var e = staffEmployees().find(function (x) { return String(x.id) === String(id); }) || {};
    var av = $("selected-employee-avatar"), nm = $("selected-employee-name");
    var initial = String(e.name || "?").trim().charAt(0).toUpperCase();
    if (av) av.innerHTML = e.image_url ? '<img src="' + esc(e.image_url) + '" class="w-full h-full object-cover" alt="">' : esc(initial);
    if (nm) nm.textContent = e.name || "";
    var acc = $("account-selector"), pin = $("pin-screen");
    if (acc) acc.classList.add("hidden");
    if (pin) pin.classList.remove("hidden");
    closeStaffModal();
    state.pinBuffer = "";
    updatePinDots();
    var err = $("staff-error"); if (err) err.classList.add("hidden");
    refreshIcons();
  }
  function backToAccounts() {
    var acc = $("account-selector"), pin = $("pin-screen");
    if (acc) acc.classList.remove("hidden");
    if (pin) pin.classList.add("hidden");
    state.pinBuffer = "";
    updatePinDots();
  }
  function updatePinDots() {
    var dots = document.querySelectorAll(".pin-dot");
    for (var i = 0; i < dots.length; i++) dots[i].classList.toggle("on", i < state.pinBuffer.length);
  }
  function pinPadDigit(d) {
    if (state.pinBuffer.length >= 6) return;
    state.pinBuffer += String(d);
    updatePinDots();
    if (state.pinBuffer.length === 6) staffLogin();
  }
  function pinPadDelete() {
    state.pinBuffer = state.pinBuffer.slice(0, -1);
    updatePinDots();
  }
  async function staffLogin() {
    var emp = state.selectedEmployeeId, pin = state.pinBuffer;
    var err = $("staff-error");
    if (err) err.classList.add("hidden");
    if (!emp) { if (err) { err.textContent = "Pilih akun staf dulu."; err.classList.remove("hidden"); } return; }
    if (pin.length !== 6) { if (err) { err.textContent = "Masukkan PIN 6 digit."; err.classList.remove("hidden"); } return; }
    var res = await window.supabaseApi.verifyPin(emp, pin);
    if (!res || !res.ok) {
      if (err) { err.textContent = (res && res.message) || "PIN salah."; err.classList.remove("hidden"); }
      state.pinBuffer = ""; updatePinDots();
      return;
    }
    state.staffUser = res.data || { id: emp };
    try { localStorage.setItem("bento_session_user", JSON.stringify(state.staffUser)); } catch (e) {}
    hideStaffLogin();
    var full = await window.supabaseApi.getAppData();
    if (full && full.ok) {
      state.products = full.data.products || state.products;
      state.customers = full.data.customers || [];
      state.transactions = full.data.transactions || [];
      state.employees = full.data.employees || state.employees;
    }
    render();
  }
  function staffLogout() {
    window.supabaseApi.clearSession();
    state.staffUser = null; state.adminTab = "pos"; state.posCustomerId = "Guest"; render();
  }
  async function refreshStaffData() {
    var full = await window.supabaseApi.getAppData();
    if (full && full.ok) {
      state.products = full.data.products || state.products;
      state.customers = full.data.customers || [];
      state.transactions = full.data.transactions || [];
    }
    render();
  }
  async function setTxnStatus(txnId, status) {
    if (!state.staffUser) { showStaffLogin(); return; }
    var res = await window.supabaseApi.updateTransactionStatus(txnId, status);
    if (res && res.ok) { await refreshStaffData(); if (state.view === "kitchen") await loadKitchen(); }
    else alert((res && res.message) || "Gagal mengubah status.");
  }
  async function voidTxn(txnId) {
    if (!state.staffUser) { showStaffLogin(); return; }
    var pin = window.prompt("Masukkan void PIN untuk membatalkan pesanan " + txnId + ":");
    if (pin === null) return;
    var res = await window.supabaseApi.voidTransaction(txnId, pin);
    if (res && res.ok) { await refreshStaffData(); }
    else alert((res && res.message) || "Gagal membatalkan pesanan.");
  }

  // ---------- sidebar GASPOS ----------
  function toggleSidebar() {
    var sb = $("sidebar"); if (!sb) return;
    var expanded = !sb.classList.contains("lg:w-64");
    sb.classList.toggle("lg:w-64", expanded);
    sb.classList.toggle("lg:w-24", !expanded);
    sb.classList.toggle("collapsed", !expanded);
    var labels = sb.querySelectorAll ? sb.querySelectorAll(".sidebar-expand-only") : [];
    for (var i = 0; i < labels.length; i++) labels[i].classList.toggle("hidden", !expanded);
    var main = $("app");
    if (main) { main.classList.toggle("lg:ml-64", expanded); main.classList.toggle("lg:ml-24", !expanded); }
    var icon = $("toggle-icon"); if (icon) icon.style.transform = expanded ? "rotate(0deg)" : "rotate(180deg)";
  }
  function updateSidebarActive() {
    var map = { pos: "pos", transactions: "transactions", customers: "customers", products: "products", categories: "categories", employees: "employees", reports: "reports", settings: "settings" };
    var want = map[state.adminTab] || "pos";
    document.querySelectorAll("#sidebar [data-nav]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-nav") === want);
    });
    var disp = $("display-menu-btn"); if (disp) disp.classList.toggle("active", state.adminTab === "pos");
  }
  function closePopovers() {
    var d = $("display-popover"); if (d) d.classList.remove("open");
    var m = $("more-popover"); if (m) m.classList.remove("open");
  }
  function toggleDisplayPopover() {
    var p = $("display-popover"); if (!p) return;
    var willOpen = !p.classList.contains("open");
    closePopovers();
    if (!willOpen) return;
    var btn = $("display-menu-btn");
    if (btn && window.innerWidth >= 1024) {
      var r = btn.getBoundingClientRect();
      p.style.left = (r.right + 12) + "px";
      p.style.top = Math.max(8, r.top) + "px";
      p.style.bottom = "auto";
    } else {
      p.style.left = ""; p.style.top = ""; p.style.bottom = "";
    }
    p.classList.add("open");
    refreshIcons();
  }
  function toggleMorePopover() {
    var p = $("more-popover"); if (!p) return;
    var willOpen = !p.classList.contains("open");
    closePopovers();
    if (willOpen) { p.classList.add("open"); refreshIcons(); }
  }
  function setDisplay(sub) {
    closePopovers();
    if (sub === "pos") { state.adminTab = "pos"; if (state.view !== "admin") App.go("admin"); else render(); }
    else if (sub === "kitchen") App.go("kitchen");
    else if (sub === "customer") App.go("customer");
    else if (sub === "queue") App.go("queue");
  }
  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    } catch (e) {}
  }
  function openScanner() { alert("Pemindai barcode belum tersedia di versi ini."); }

  // ---------- POS (v1 layout, logika v2) ----------
  function posCategoryPillsHtml() {
    var cats = ["All"].concat(CAT_ORDER.filter(function (c) { return state.categories.some(function (x) { return x.name === c; }); }));
    return cats.map(function (c) {
      var active = state.posCategory === c;
      return '<button onclick="App.setPosCategory(\'' + esc(c) + '\')" class="px-4 py-1.5 lg:px-6 lg:py-2 text-xs lg:text-sm rounded-full whitespace-nowrap font-medium transition-colors ' + (active ? "bg-[#C7D957] text-black shadow-sm" : "bg-white text-gray-500 hover:bg-gray-100") + '">' + esc(c === "All" ? "All" : c) + '</button>';
    }).join("");
  }
  function renderPosPills() { var el = $("pos-category-list"); if (el) el.innerHTML = posCategoryPillsHtml(); }
  function posVisibleProducts() {
    var list = state.products.filter(function (p) { return p.status === "Active"; });
    if (state.posCategory !== "All") list = list.filter(function (p) { return p.category === state.posCategory; });
    if (state.posSearch) {
      var q = state.posSearch.toLowerCase();
      list = list.filter(function (p) { return String(p.name).toLowerCase().indexOf(q) !== -1 || String(p.sku || "").toLowerCase().indexOf(q) !== -1; });
    }
    return list;
  }
  function renderPosGrid() {
    var grid = $("pos-product-grid"); if (!grid) return;
    var list = posVisibleProducts();
    if (!list.length) { grid.innerHTML = '<div class="col-span-full py-20 text-center text-gray-400">No products found in this category.</div>'; return; }
    grid.innerHTML = list.map(function (p) {
      var badge = "";
      if (p.stock !== null && p.stock !== undefined) {
        badge = '<div class="flex items-center gap-1 absolute top-2 right-2 px-2 py-1 rounded-lg backdrop-blur-md bg-white/80 shadow-sm border border-black/5"><i data-lucide="package" class="w-2.5 h-2.5 ' + (Number(p.stock) <= 5 ? "text-red-600" : "text-black") + '"></i><span class="text-[10px] font-black ' + (Number(p.stock) <= 5 ? "text-red-600" : "text-black") + '">' + Number(p.stock) + '</span></div>';
      }
      var img = p.imageUrl
        ? '<img src="' + esc(p.imageUrl) + '" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" onerror="this.style.display=\'none\'" alt="">'
        : '<div class="w-full h-full bg-[#F7F0DC] flex items-center justify-center"><i data-lucide="' + (CAT_ICON_LUCIDE[p.category] || "utensils") + '" class="w-8 h-8 text-gray-400"></i></div>';
      return '<button type="button" onclick="App.addToCart(\'' + esc(p.id) + '\')" class="bento-card p-4 flex flex-col text-left active:scale-95 transition-transform group">' +
        '<div class="bg-gray-100 aspect-square rounded-xl mb-3 overflow-hidden relative">' + img + badge + '</div>' +
        '<div class="flex flex-col flex-1"><h3 class="font-semibold text-sm leading-tight mb-2 line-clamp-2 h-10 text-gray-800">' + esc(displayName(p.name)) + '</h3>' +
        '<div class="mt-auto"><div class="flex justify-between items-end mb-1"><span class="text-[10px] text-gray-400 uppercase tracking-widest font-bold">' + esc(p.category) + '</span></div>' +
        '<p class="text-lg font-bold text-black">' + fmt(p.price) + '</p></div></div></button>';
    }).join("");
    refreshIcons();
  }
  function posCustomerName() {
    if (!state.posCustomerId || state.posCustomerId === "Guest") return "Select Customer";
    var c = (state.customers || []).find(function (x) { return String(x.id) === String(state.posCustomerId); });
    return c ? c.name : "Select Customer";
  }
  function renderPosCartPanel() {
    var itemsEl = $("pos-cart-items"), emptyEl = $("pos-cart-empty"), totalsEl = $("pos-cart-totals");
    var barCount = $("pos-cart-bar-count"), barTotal = $("pos-cart-bar-total"), custBtn = $("pos-customer-name");
    if (!itemsEl && !barCount) return;
    var t = cartTotals();
    var n = state.cart.reduce(function (a, c) { return a + c.qty; }, 0);
    if (custBtn) custBtn.textContent = posCustomerName();
    if (barCount) barCount.textContent = n + (n === 1 ? " Item" : " Items");
    if (barTotal) barTotal.textContent = fmt(t.total);
    if (emptyEl) emptyEl.style.display = state.cart.length ? "none" : "flex";
    if (itemsEl) {
      itemsEl.style.display = state.cart.length ? "block" : "none";
      itemsEl.innerHTML = state.cart.map(function (c) {
        return '<div class="flex items-start gap-3 p-3 border-2 border-gray-100 rounded-2xl mb-2">' +
          '<div class="flex-1 min-w-0"><div class="font-bold text-sm truncate">' + esc(displayName(c.name)) + '</div>' +
          '<div class="flex items-center gap-2 mt-1"><span class="text-xs text-gray-500">' + (c.isRedeemed ? "FREE (Redeemed)" : fmt(c.price)) + '</span>' +
          (c.isRedeemed ? '<span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-lg bg-[#C7D957]/30 text-black">Redeem (' + (Number(c.point_price) * c.qty) + ' Pts)</span>' : "") + '</div></div>' +
          '<div class="flex items-center gap-2 shrink-0"><div class="flex items-center bg-gray-100 rounded-lg p-1">' +
          '<button type="button" onclick="App.changeQty(\'' + esc(c.key) + '\', -1)" class="w-6 h-6 flex items-center justify-center font-bold">-</button>' +
          '<span class="w-8 text-center text-sm font-bold">' + c.qty + '</span>' +
          '<button type="button" onclick="App.changeQty(\'' + esc(c.key) + '\', 1)" class="w-6 h-6 flex items-center justify-center font-bold">+</button></div>' +
          '<button type="button" onclick="App.removeFromCart(\'' + esc(c.key) + '\')" class="p-2 text-gray-400 hover:text-red-600 transition-colors"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div></div>';
      }).join("");
    }
    if (totalsEl) {
      totalsEl.innerHTML =
        '<div class="flex justify-between items-center w-full text-sm text-gray-500 mb-1"><span>Subtotal</span><span class="font-bold text-black">' + fmt(t.subtotal) + '</span></div>' +
        (t.service > 0 ? '<div class="flex justify-between text-xs text-gray-400"><span>Tausil</span><span class="font-bold text-black">' + fmt(t.service) + '</span></div>' : "") +
        '<div class="flex justify-between text-xs text-gray-400"><span>Tax (' + Number(state.settings.tax_rate || 10) + '%)</span><span class="font-bold text-black">' + fmt(t.tax) + '</span></div>' +
        (t.pointsCost ? '<div class="flex justify-between text-xs text-gray-400"><span>Poin dipakai</span><span class="font-bold text-black">' + t.pointsCost + ' Pts</span></div>' : "") +
        '<div class="flex justify-between text-xl font-bold pt-2 border-t border-gray-100 mt-2"><span>Total</span><span>' + fmt(t.total) + '</span></div>';
    }
    refreshIcons();
  }
  function renderAdminPos() {
    var html = '<div class="lg:grid lg:grid-cols-12 lg:gap-6">' +
      '<div class="lg:col-span-7 xl:col-span-8 flex flex-col gap-2 p-3 md:p-0 pb-24 lg:pb-0">' +
      '<div class="sticky top-0 bg-[#F7F0DC]/90 backdrop-blur-md z-30 -mx-4 pt-4 px-4 space-y-2 md:space-y-4">' +
      '<div class="relative"><i data-lucide="search" class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 pointer-events-none"></i>' +
      '<input type="text" id="pos-search" placeholder="Search product name or SKU..." value="' + esc(state.posSearch) + '" oninput="App.posSearch(this.value)" class="w-full pl-12 pr-24 py-3 md:py-4 bg-white border border-gray-100 rounded-2xl outline-none focus:border-[#C7D957] transition-all shadow-sm">' +
      '<div class="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1">' +
      '<button onclick="App.toggleFullscreen()" class="p-2 text-gray-400 hover:text-black hover:bg-gray-100 rounded-xl transition-all" title="Toggle Fullscreen"><i data-lucide="maximize" class="w-5 h-5"></i></button>' +
      '<button onclick="App.openScanner()" class="p-2 text-gray-400 hover:text-black hover:bg-gray-100 rounded-xl transition-all" title="Scan Barcode"><i data-lucide="camera" class="w-5 h-5"></i></button>' +
      '</div></div>' +
      '<div class="relative"><nav id="pos-category-list" class="flex gap-3 overflow-x-auto pb-2 no-scrollbar">' + posCategoryPillsHtml() + '</nav></div>' +
      '</div>' +
      '<main id="pos-product-grid" class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8"></main>' +
      '</div>' +
      // Right cart panel (desktop) — v1 #cart-panel
      '<div class="hidden lg:block lg:col-span-5 xl:col-span-4 border-l border-gray-100 bg-white lg:bg-white/50 backdrop-blur-sm lg:p-6 relative">' +
      '<section class="bento-card border-0 lg:border lg:p-6 flex flex-col lg:sticky lg:top-6 h-[calc(100vh-3rem)] shadow-none lg:shadow-xl rounded-none lg:rounded-3xl">' +
      '<div class="justify-between items-center mb-4 flex gap-4"><h2 class="text-xl font-bold flex items-center gap-2 shrink-0"><i data-lucide="shopping-cart" class="text-[#C7D957]"></i> Order</h2>' +
      '<div class="flex-1 max-w-[180px] relative"><button onclick="App.togglePosCustomerPicker()" class="w-full px-3 py-2 bg-gray-50 border border-gray-100 rounded-xl text-xs font-medium text-left flex justify-between items-center hover:border-[#C7D957] transition-all"><span id="pos-customer-name" class="truncate">' + esc(posCustomerName()) + '</span><i data-lucide="search" class="w-3 h-3 text-gray-400"></i></button>' +
      '<div id="pos-customer-picker" class="hidden absolute top-full right-0 mt-2 w-64 bg-white border border-gray-100 rounded-2xl shadow-2xl p-2 z-[70] max-h-72 overflow-y-auto"></div></div></div>' +
      '<div id="pos-ordertype" class="flex bg-gray-100 p-1 rounded-xl mb-4">' +
      ["Dine In", "Take Away", "Delivery"].map(function (v) {
        return '<button data-v="' + v + '" onclick="App.setOrderType(this)" class="ot-btn flex-1 py-2 rounded-lg text-sm font-medium transition-all">' + (v === "Delivery" ? "Tausil" : v) + '</button>';
      }).join("") + '</div>' +
      '<div id="pos-cart-empty" class="text-center text-gray-400 flex-1 overflow-y-auto mb-4 items-center justify-center" style="display:flex">Your cart is empty</div>' +
      '<div id="pos-cart-items" class="flex-1 overflow-y-auto space-y-2 pr-2 mb-4" style="display:none"></div>' +
      '<div class="border-t space-y-1 py-4"><div id="pos-cart-totals"></div>' +
      '<div class="pt-2"><button onclick="App.toggleCart(true)" class="w-full py-4 rounded-2xl bg-black text-white font-bold hover:opacity-90 flex items-center justify-center gap-2 transition-all active:scale-95"><i data-lucide="credit-card" class="w-5 h-5"></i> Pay Now</button></div>' +
      '<p class="text-[11px] text-gray-400 text-center pt-2">Tekan Pay Now untuk membuka checkout — isi nama &amp; nomor WA pelanggan, lalu Accept &amp; Pesan via WhatsApp.</p>' +
      '</div></section></div>' +
      // Mobile cart bar (v1 mobile-cart-handle)
      '<div id="pos-cart-bar" class="lg:hidden fixed left-0 right-0 bottom-[72px] z-30 px-4"><button onclick="App.toggleCart(true)" class="w-full bg-[#C7D957] text-black rounded-2xl shadow-lg px-4 py-3 flex items-center justify-between"><span class="flex items-center gap-2 font-bold text-sm"><i data-lucide="shopping-bag" class="w-5 h-5"></i><span id="pos-cart-bar-count">0 Items</span></span><span class="flex items-center gap-2"><span id="pos-cart-bar-total" class="font-black text-lg">0 LE</span><i data-lucide="chevron-up" class="w-5 h-5"></i></span></button></div>' +
      '</div>';
    setTimeout(function () { renderPosGrid(); renderPosCartPanel(); syncCheckoutSelectors(); }, 0);
    return html;
  }
  function posSearch(v) { state.posSearch = v; renderPosGrid(); }
  function setPosCategory(c) { state.posCategory = c; renderPosPills(); renderPosGrid(); }
  function togglePosCustomerPicker() {
    var el = $("pos-customer-picker"); if (!el) return;
    if (!el.classList.contains("hidden")) { el.classList.add("hidden"); return; }
    var rows = '<button onclick="App.selectPosCustomer(\'Guest\')" class="w-full text-left px-3 py-2.5 rounded-xl hover:bg-[#F7F0DC] font-medium text-sm">Guest</button>' +
      (state.customers || []).slice(0, 50).map(function (c) {
        return '<button onclick="App.selectPosCustomer(\'' + esc(c.id) + '\')" class="w-full text-left px-3 py-2.5 rounded-xl hover:bg-[#F7F0DC] text-sm"><span class="font-bold block truncate">' + esc(c.name || "(tanpa nama)") + '</span><span class="text-xs text-gray-400">' + esc(c.phone || "") + (c.points ? ' • ' + Number(c.points) + ' Pts' : '') + '</span></button>';
      }).join("");
    el.innerHTML = rows || '<p class="text-sm text-gray-400 p-3">Belum ada pelanggan.</p>';
    el.classList.remove("hidden");
  }
  function selectPosCustomer(id) {
    state.posCustomerId = id;
    var picker = $("pos-customer-picker"); if (picker) picker.classList.add("hidden");
    var c = (state.customers || []).find(function (x) { return String(x.id) === String(id); });
    if (c) {
      // Isi form checkout dari pelanggan yang dipilih (dipakai submitOrder).
      if ($("co-name")) $("co-name").value = c.name || "";
      if ($("co-phone")) $("co-phone").value = c.phone || "";
      if ($("co-address")) $("co-address").value = c.address || "";
    }
    renderPosCartPanel();
  }

  // ---------- Kitchen Display (v1 kanban, logika status v2) ----------
  function kitchenNext(t) {
    if (t.status === "Pending") return { status: "Dibuat", label: "Dibuat / Start Prep", cls: "bg-blue-500" };
    if (t.status === "Dibuat") return t.orderType === "Delivery" ? { status: "Diantar", label: "Diantar", cls: "bg-teal-600" } : { status: "Selesai", label: "Selesai / Ready", cls: "bg-green-600" };
    if (t.status === "Diantar") return { status: "Selesai", label: "Selesai", cls: "bg-green-600" };
    return null;
  }
  function kanbanLaneHtml(id, title, dotCls, count, innerId) {
    return '<div class="flex-1 min-w-[320px] flex flex-col bg-gray-100/50 rounded-3xl border border-gray-200">' +
      '<div class="p-4 flex items-center justify-between"><h3 class="font-black text-sm uppercase tracking-widest text-gray-500 flex items-center gap-2"><span class="w-2 h-2 rounded-full ' + dotCls + '"></span> ' + title + '</h3>' +
      '<span id="' + count + '" class="bg-white px-2 py-0.5 rounded-lg text-[10px] font-bold shadow-sm">0</span></div>' +
      '<div id="' + innerId + '" class="flex-1 p-3 space-y-3 overflow-y-auto"></div></div>';
  }
  function renderKitchen() {
    var html = '<div class="flex flex-col h-screen overflow-hidden p-4 md:p-6 bg-gray-50">' +
      '<div class="mb-6 flex justify-between items-center bg-white p-4 rounded-2xl shadow-sm border border-gray-100"><div class="flex items-center gap-4">' +
      '<button onclick="App.go(\'admin\')" class="p-2 hover:bg-gray-100 rounded-xl transition-all" title="Kembali ke Admin"><i data-lucide="arrow-left" class="w-6 h-6"></i></button>' +
      '<div><h2 class="text-xl md:text-2xl font-black uppercase tracking-tight">Kitchen Workflow</h2><p class="text-xs font-bold text-gray-400 uppercase tracking-widest">Live Kanban Board</p></div></div>' +
      '<button onclick="App.loadKitchen()" class="p-3 bg-gray-100 rounded-xl hover:bg-[#C7D957] transition-all" title="Refresh"><i data-lucide="refresh-cw" class="w-5 h-5"></i></button></div>' +
      '<div class="flex-1 flex gap-4 overflow-x-auto pb-4 items-stretch">' +
      kanbanLaneHtml("pending", "Pending", "bg-orange-400", "count-pending", "kanban-Pending") +
      kanbanLaneHtml("dibuat", "Dibuat", "bg-blue-400", "count-dibuat", "kanban-Dibuat") +
      kanbanLaneHtml("diantar", "Diantar", "bg-teal-400", "count-diantar", "kanban-Diantar") +
      kanbanLaneHtml("selesai", "Selesai", "bg-green-600", "count-selesai", "kanban-Selesai") +
      '</div></div>';
    setTimeout(loadKitchen, 0);
    return html;
  }
  async function loadKitchen() {
    var lanes = { "Pending": $("kanban-Pending"), "Dibuat": $("kanban-Dibuat"), "Diantar": $("kanban-Diantar"), "Selesai": $("kanban-Selesai") };
    if (!lanes["Pending"]) return;
    var today = new Date().toISOString().slice(0, 10);
    try {
      var res = await window.supabaseApi.getTransactions();
      if (!res || !res.ok) throw new Error((res && res.message) || "gagal memuat pesanan");
      var rows = res.data || [];
      // Sinkron dengan Queue: pesanan aktif (Pending/Dibuat/Diantar) tampil
      // apa pun tanggalnya — jangan hilang cuma karena lewat tengah malam.
      // Yang Selesai hanya yang hari ini.
      rows = rows.filter(function (t) { return t.status !== "Void" && (t.status !== "Selesai" || String(t.timestamp || "").slice(0, 10) === today); });
    Object.keys(lanes).forEach(function (k) { if (lanes[k]) lanes[k].innerHTML = ""; });
    rows.forEach(function (t) {
      var lane = lanes[t.status] || lanes["Pending"];
      var items = [];
      try { items = JSON.parse(t.items || "[]"); } catch (e) {}
      var timeAgo = Math.max(0, Math.floor((Date.now() - new Date(t.timestamp).getTime()) / 60000));
      var itemsHtml = items.map(function (it) {
        return '<div class="flex gap-2 p-1.5 bg-gray-50 rounded-lg"><span class="font-black text-[10px] bg-black text-white w-5 h-5 flex items-center justify-center rounded shrink-0">' + Number(it.qty || 0) + '</span>' +
          '<div class="flex-1 min-w-0"><p class="text-xs font-bold leading-tight">' + esc(displayName(it.name || "")) + '</p>' +
          (it.notes ? '<p class="text-[10px] text-orange-600 italic font-bold mt-1 bg-orange-50 p-1 rounded">Note: ' + esc(it.notes) + '</p>' : '') + '</div></div>';
      }).join("");
      var shortId = String(t.id).indexOf("-") > -1 ? String(t.id).split("-")[1] : String(t.id).slice(-4);
      var next = kitchenNext(t);
      var nextBtn = next
        ? '<button onclick="App.setTxnStatus(\'' + esc(t.id) + '\', \'' + next.status + '\')" class="w-full py-2 ' + next.cls + ' text-white text-xs font-bold rounded-xl mt-2">' + esc(next.label) + '</button>'
        : '<span class="inline-flex items-center gap-1 mt-2 text-[11px] font-bold text-green-700 bg-green-100 px-3 py-1 rounded-full"><i data-lucide="check-circle" class="w-3.5 h-3.5"></i>Selesai</span>';
      lane.innerHTML += '<div class="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 hover:border-[#C7D957] transition-all">' +
        '<div class="flex justify-between items-start mb-2"><span class="text-[10px] font-black uppercase text-gray-400">#' + esc(shortId) + '</span>' +
        '<span class="text-[10px] font-bold ' + (timeAgo > 15 ? "text-red-600" : "text-gray-400") + '">' + timeAgo + 'm</span></div>' +
        '<div class="space-y-1 mb-2">' + itemsHtml + '</div>' +
        '<div class="flex justify-between items-center text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2"><span>' + esc(t.orderType || "") + '</span><span>' + esc(t.paymentMethod || "Cash") + '</span></div>' +
        nextBtn + '</div>';
    });
    var setCount = function (id, n) { var el = $(id); if (el) el.textContent = n; };
    setCount("count-pending", rows.filter(function (o) { return o.status === "Pending"; }).length);
    setCount("count-dibuat", rows.filter(function (o) { return o.status === "Dibuat"; }).length);
    setCount("count-diantar", rows.filter(function (o) { return o.status === "Diantar"; }).length);
    setCount("count-selesai", rows.filter(function (o) { return o.status === "Selesai"; }).length);
    refreshIcons();
    } catch (e) {
      // Gagal memuat harus terlihat — bukan lane kosong yang menyesatkan.
      Object.keys(lanes).forEach(function (k) { if (lanes[k]) lanes[k].innerHTML = '<p class="text-sm text-red-600 font-bold p-3">Gagal memuat dapur. Tekan Refresh.</p>'; });
    }
  }

  // ---------- Transactions / History (v1) ----------
  function txnCustomerName(t) {
    var c = (state.customers || []).find(function (x) { return String(x.id) === String(t.customer_id || ""); });
    return c ? c.name : "Guest";
  }
  function txnItems(t) {
    var items = [];
    try { items = typeof t.items === "string" ? JSON.parse(t.items) : (t.items || []); } catch (e) {}
    return Array.isArray(items) ? items : [];
  }
  function renderTxnList() {
    var el = $("txn-list"); if (!el) return;
    var f = state.txnFilter;
    var list = (state.transactions || []).filter(function (t) {
      if (f.type !== "All" && t.orderType !== f.type) return false;
      if (f.date && String(t.timestamp || "").slice(0, 10) !== f.date) return false;
      if (f.q) {
        var q = f.q.toLowerCase();
        var hay = (String(t.id || "") + " " + txnCustomerName(t)).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    if (!list.length) { el.innerHTML = '<p class="text-center text-gray-400 py-10">Tidak ada transaksi yang cocok.</p>'; return; }
    el.innerHTML = list.slice(0, 100).map(function (t) {
      var items = txnItems(t);
      return '<div class="bento-card p-4"><div class="flex justify-between flex-wrap gap-2 items-center"><b class="font-mono text-sm">' + esc(t.id) + '</b>' + statusPill(t.status) + '</div>' +
        '<p class="text-sm text-gray-500 mt-1">' + esc(txnCustomerName(t)) + ' • ' + esc(t.orderType || "") + ' • ' + fmt(t.total_amount) + ' • ' + esc(t.paymentMethod || "") + ' • ' + esc(String(t.timestamp || "").slice(0, 16).replace("T", " ")) + '</p>' +
        '<p class="text-sm text-gray-800 mt-1">' + items.map(function (it) { return Number(it.qty || 0) + " × " + esc(displayName(it.name || "")); }).join(", ") + '</p>' +
        '<div class="flex gap-2 mt-3 flex-wrap">' +
        ["Dibuat", "Diantar", "Selesai"].map(function (s) {
          return '<button onclick="App.setTxnStatus(\'' + esc(t.id) + '\', \'' + s + '\')" class="text-xs font-bold px-3 py-1.5 rounded-full bg-gray-100 hover:bg-[#C7D957] transition-colors">' + s + '</button>';
        }).join("") +
        '<a class="text-xs font-bold px-3 py-1.5 rounded-full bg-[#C7D957]/30 text-black hover:bg-[#C7D957] transition-colors" href="' + trackingLink(t.id) + '" target="_blank" rel="noopener">Link Lacak</a>' +
        (t.status !== "Void" && t.status !== "Selesai" ? '<button onclick="App.voidTxn(\'' + esc(t.id) + '\')" class="text-xs font-bold px-3 py-1.5 rounded-full text-red-600 hover:bg-red-50 transition-colors">Void</button>' : "") +
        '</div></div>';
    }).join("");
  }
  function renderAdminTransactions() {
    var f = state.txnFilter;
    var html = adminHeaderCard("Transactions", "Recent orders and payment status", "") +
      '<div class="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-3">' +
      '<div class="flex-1 flex items-center gap-2 bg-gray-50 rounded-xl px-3"><i data-lucide="search" class="w-4 h-4 text-gray-400 shrink-0"></i><input id="txn-q" type="text" placeholder="Search ID or Customer..." value="' + esc(f.q) + '" oninput="App.setTxnFilter(\'q\', this.value)" class="bg-transparent border-0 text-sm font-medium outline-none w-full py-2.5"></div>' +
      '<select id="txn-type" onchange="App.setTxnFilter(\'type\', this.value)" class="bg-white border border-gray-100 rounded-xl px-3 py-2.5 text-sm font-bold outline-none">' +
      ["All", "Dine In", "Take Away", "Delivery"].map(function (v) { return '<option value="' + v + '"' + (f.type === v ? " selected" : "") + '>' + (v === "All" ? "Semua Tipe" : v === "Delivery" ? "Tausil" : v) + '</option>'; }).join("") + '</select>' +
      '<input id="txn-date" type="date" value="' + esc(f.date) + '" onchange="App.setTxnFilter(\'date\', this.value)" class="bg-white border border-gray-100 rounded-xl px-4 py-2.5 text-sm font-bold outline-none">' +
      '</div>' +
      '<div id="txn-list" class="space-y-3"></div>';
    setTimeout(renderTxnList, 0);
    return html;
  }
  function setTxnFilter(field, value) {
    state.txnFilter[field] = value;
    if (field !== "q") render(); else renderTxnList();
  }

  // ---------- Customers (v1 white cards, data v2) ----------
  function renderAdminCustomers() {
    var html = adminHeaderCard("Customers", "Member Google dan Guest — data yang sama dengan yang dilihat member di Profile", "") +
      '<p class="text-sm text-gray-500">Satu baris per pelanggan — member Google dan Guest dengan nomor WA yang sama digabung (cocok nomor WA / email).</p>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-6">' + (state.customers || []).map(function (c) {
        var initial = String(c.name || "?").trim().charAt(0).toUpperCase();
        return '<div class="bento-card p-4"><div class="flex items-center gap-3">' +
          (c.avatar_url ? '<img src="' + esc(c.avatar_url) + '" class="w-11 h-11 rounded-full object-cover shrink-0" alt="">' : '<span class="w-11 h-11 rounded-full bg-[#C7D957] text-black flex items-center justify-center font-bold shrink-0">' + esc(initial) + '</span>') +
          '<div class="flex-1 min-w-0"><b class="font-bold truncate block">' + esc(c.name || "(tanpa nama)") + '</b>' + (c.google_id ? ' <span class="text-[10px] font-black bg-[#C7D957] text-black px-2 py-0.5 rounded-full">MEMBER GOOGLE</span>' : "") +
          '<p class="text-xs text-gray-400 truncate">' + esc(c.phone || "") + (c.email ? " • " + esc(c.email) : "") + '</p></div>' +
          '<div class="text-right shrink-0"><b class="text-sm font-bold text-black flex items-center gap-1 justify-end"><i data-lucide="star" class="w-3.5 h-3.5 fill-current"></i>' + Number(c.points || 0) + ' Pts</b><span class="text-xs text-gray-400">Belanja ' + fmt(c.total_purchases || 0) + '</span></div></div>' +
          (c.address ? '<p class="text-sm text-gray-600 mt-2 flex items-start gap-1"><i data-lucide="map-pin" class="w-4 h-4 text-gray-400 shrink-0 mt-0.5"></i>' + esc(c.address) + '</p>' : "") +
          (c.maps_url ? '<a class="text-xs font-bold underline text-black" href="' + esc(c.maps_url) + '" target="_blank" rel="noopener">Buka lokasi di Google Maps</a>' : "") +
          (c.last_visit ? '<p class="text-xs text-gray-400 mt-1">Terakhir pesan: ' + esc(String(c.last_visit).slice(0, 10)) + '</p>' : "") + '</div>';
      }).join("") + '</div>';
    if (!(state.customers || []).length) html += '<p class="text-center text-gray-400 py-10">Belum ada pelanggan.</p>';
    return html;
  }

  // ---------- Management: Products / Categories / Staff (v1 bento cards) ----------
  function mgmtTitle(tab) {
    return { products: ["Products", "Kelola menu, harga, stok, dan foto produk"], categories: ["Categories", "Kelola kategori menu"], employees: ["Staff", "Kelola akun staf dan PIN login"] }[tab] || ["Management", ""];
  }
  function renderAdminManagement(tab) {
    var t = mgmtTitle(tab);
    var html = adminHeaderCard(t[0], t[1], blackBtn("Add New", "App.openMgmtForm('" + tab + "')", "plus"));
    if (tab === "products") {
      html += '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-6">' + state.products.map(function (p) {
        var stockClass = (p.stock !== null && Number(p.stock) <= 5) ? "text-red-600 font-bold" : "text-gray-500";
        return '<div class="bento-card p-4 flex gap-4 items-center">' +
          (p.imageUrl ? '<img src="' + esc(p.imageUrl) + '" class="w-16 h-16 rounded-xl object-cover bg-gray-50 shrink-0" alt="">' : '<div class="w-16 h-16 rounded-xl bg-[#F7F0DC] flex items-center justify-center shrink-0"><i data-lucide="' + (CAT_ICON_LUCIDE[p.category] || "utensils") + '" class="w-6 h-6 text-gray-400"></i></div>') +
          '<div class="flex-1 min-w-0"><h4 class="font-bold truncate">' + esc(displayName(p.name)) + '</h4>' +
          '<p class="text-sm text-gray-400 uppercase tracking-tighter mb-1">' + esc(p.sku || "No SKU") + '</p>' +
          '<p class="text-sm text-gray-500">' + esc(p.category) + ' &bull; ' + fmt(p.price) + (Number(p.point_price) > 0 ? " &bull; " + Number(p.point_price) + " Pts" : "") +
          '<br><span class="' + stockClass + '">In Stock: ' + (p.stock === null || p.stock === undefined ? "&infin;" : Number(p.stock)) + '</span> &bull; ' + esc(p.status || "") + '</p></div>' +
          '<div class="flex flex-col gap-2 shrink-0">' +
          '<button onclick="App.openMgmtForm(\'products\', \'' + esc(p.id) + '\')" class="p-2 hover:bg-gray-100 rounded-lg" title="Edit"><i data-lucide="edit-3" class="w-4 h-4"></i></button>' +
          '<button onclick="App.deleteMgmtRecord(\'products\', \'' + esc(p.id) + '\')" class="p-2 hover:bg-red-50 text-red-600 rounded-lg" title="Hapus"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
          '</div></div>';
      }).join("") + '</div>';
    } else if (tab === "categories") {
      html += '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-6">' + state.categories.map(function (c) {
        return '<div class="bento-card p-6 flex justify-between items-center"><span class="font-bold text-lg">' + esc(c.name) + '</span><div class="flex gap-2">' +
          '<button onclick="App.openMgmtForm(\'categories\', \'' + esc(c.id) + '\')" class="p-2 hover:bg-gray-100 rounded-lg" title="Edit"><i data-lucide="edit-3" class="w-4 h-4"></i></button>' +
          '<button onclick="App.deleteMgmtRecord(\'categories\', \'' + esc(c.id) + '\')" class="p-2 hover:bg-red-50 text-red-600 rounded-lg" title="Hapus"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
          '</div></div>';
      }).join("") + '</div>';
    } else if (tab === "employees") {
      html += '<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-6">' + (state.employees || []).map(function (e) {
        var initial = String(e.name || "?").trim().charAt(0).toUpperCase();
        return '<div class="bento-card p-4 flex gap-4 items-center">' +
          '<div class="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center font-bold overflow-hidden shrink-0">' + (e.image_url ? '<img src="' + esc(e.image_url) + '" class="w-full h-full object-cover" alt="">' : esc(initial)) + '</div>' +
          '<div class="flex-1 min-w-0"><h4 class="font-bold truncate">' + esc(e.name) + '</h4><p class="text-xs text-gray-400 uppercase tracking-widest">' + esc(e.role || "") + '</p></div>' +
          '<div class="flex flex-col gap-2 shrink-0">' +
          '<button onclick="App.openMgmtForm(\'employees\', \'' + esc(e.id) + '\')" class="p-2 hover:bg-gray-100 rounded-lg" title="Edit / ganti PIN"><i data-lucide="edit-3" class="w-4 h-4"></i></button>' +
          '<button onclick="App.deleteMgmtRecord(\'employees\', \'' + esc(e.id) + '\')" class="p-2 hover:bg-red-50 text-red-600 rounded-lg" title="Hapus"><i data-lucide="trash-2" class="w-4 h-4"></i></button>' +
          '</div></div>';
      }).join("") + '</div>';
    }
    return html;
  }
  function mgmtField(label, inner) {
    return '<div><label class="text-xs font-bold uppercase text-gray-400">' + esc(label) + '</label>' + inner + '</div>';
  }
  function mgmtInput(name, value, opts) {
    opts = opts || {};
    return '<input name="' + name + '" value="' + esc(value == null ? "" : value) + '" ' + (opts.type ? 'type="' + opts.type + '" ' : "") + (opts.placeholder ? 'placeholder="' + esc(opts.placeholder) + '" ' : "") + (opts.required ? "required " : "") + 'class="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 outline-none focus:border-[#C7D957]">';
  }
  function mgmtFormFields(type, item) {
    item = item || {};
    if (type === "products") {
      var catOptions = state.categories.map(function (c) { return '<option value="' + esc(c.name) + '"' + (item.category === c.name ? " selected" : "") + '>' + esc(c.name) + '</option>'; }).join("");
      return mgmtField("Nama Produk", mgmtInput("name", item.name, { required: true })) +
        '<div class="grid grid-cols-2 gap-3">' + mgmtField("SKU", mgmtInput("sku", item.sku)) + mgmtField("Kategori", '<select name="category" class="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 outline-none">' + catOptions + '</select>') + '</div>' +
        '<div class="grid grid-cols-3 gap-3">' + mgmtField("Harga (LE)", mgmtInput("price", item.price, { type: "number", required: true })) + mgmtField("Stok", mgmtInput("stock", item.stock, { type: "number" })) + mgmtField("Harga Poin", mgmtInput("point_price", item.point_price || 0, { type: "number" })) + '</div>' +
        mgmtField("Status", '<select name="status" class="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 outline-none"><option' + (item.status !== "Inactive" ? " selected" : "") + '>Active</option><option' + (item.status === "Inactive" ? " selected" : "") + '>Inactive</option></select>') +
        mgmtField("Foto (image_url)", mgmtInput("image_url", item.imageUrl, { placeholder: "https://... (kosong = tanpa foto)" }));
    }
    if (type === "categories") {
      return mgmtField("Nama Kategori", mgmtInput("name", item.name, { required: true }));
    }
    if (type === "employees") {
      var roles = ["Admin", "Admin Demo", "Supervisor", "Staff"];
      var roleOptions = roles.map(function (r) { return '<option' + (item.role === r ? " selected" : "") + '>' + r + '</option>'; }).join("");
      return mgmtField("Nama", mgmtInput("name", item.name, { required: true })) +
        mgmtField("Peran", '<select name="role" class="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 outline-none">' + roleOptions + '</select>') +
        mgmtField("PIN Baru (6 digit)", mgmtInput("pin", "", { type: "password", placeholder: "Kosongkan = PIN lama tetap" })) +
        mgmtField("Foto (image_url)", mgmtInput("image_url", item.image_url, { placeholder: "https://... (opsional)" }));
    }
    return "";
  }
  function openMgmtForm(type, id) {
    state.mgmtType = type; state.mgmtId = id || null;
    var coll = type === "products" ? state.products : type === "categories" ? state.categories : state.employees;
    var item = id ? (coll || []).find(function (x) { return String(x.id) === String(id); }) : null;
    if (id && !item) item = {};
    var title = (id ? "Edit " : "Add New ") + ({ products: "Product", categories: "Category", employees: "Staff" }[type] || "");
    var t = $("crud-title"); if (t) t.textContent = title;
    var f = $("crud-fields"); if (f) f.innerHTML = mgmtFormFields(type, item || {});
    var err = $("crud-error"); if (err) err.classList.add("hidden");
    var m = $("crud-modal"); if (m) { m.classList.remove("hidden"); m.classList.add("flex"); }
    refreshIcons();
  }
  function closeMgmtForm() {
    var m = $("crud-modal"); if (m) { m.classList.add("hidden"); m.classList.remove("flex"); }
    state.mgmtType = ""; state.mgmtId = null;
  }
  async function saveMgmtForm() {
    var type = state.mgmtType; if (!type) return;
    var prefix = { products: "P", categories: "CAT", employees: "E" }[type] || "X";
    var record = { id: state.mgmtId || (prefix + Date.now()) };
    var fields = document.querySelectorAll("#crud-fields [name]");
    for (var i = 0; i < fields.length; i++) {
      var name = fields[i].getAttribute("name"), val = fields[i].value;
      if (name === "price" || name === "stock" || name === "point_price") record[name] = val === "" ? null : Number(val);
      else record[name] = val;
    }
    if (type === "products" && !record.name) { var e1 = $("crud-error"); if (e1) { e1.textContent = "Nama produk wajib diisi."; e1.classList.remove("hidden"); } return; }
    if (type === "employees" && record.pin && !/^\d{6}$/.test(String(record.pin))) { var e2 = $("crud-error"); if (e2) { e2.textContent = "PIN harus 6 digit angka."; e2.classList.remove("hidden"); } return; }
    var res = await window.supabaseApi.saveRecord(SHEET_BY_MGMT[type], record);
    if (!res || !res.ok) { var e3 = $("crud-error"); if (e3) { e3.textContent = (res && res.message) || "Gagal menyimpan."; e3.classList.remove("hidden"); } return; }
    closeMgmtForm();
    await refreshStaffData();
  }
  async function deleteMgmtRecord(type, id) {
    if (!window.confirm("Hapus data ini?")) return;
    var res = await window.supabaseApi.deleteRecord(SHEET_BY_MGMT[type], id);
    if (!res || !res.ok) { alert((res && res.message) || "Gagal menghapus."); return; }
    await refreshStaffData();
  }

  // ---------- Reports (dihitung dari transaksi — tanpa endpoint baru) ----------
  function reportTxns() {
    var from = state.reportFrom, to = state.reportTo;
    return (state.transactions || []).filter(function (t) {
      if (t.status === "Void") return false;
      var d = String(t.timestamp || "").slice(0, 10);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }
  function renderAdminReports() {
    var list = reportTxns();
    var revenue = list.reduce(function (a, t) { return a + Number(t.total_amount || 0); }, 0);
    var items = 0, topMap = {}, payMap = {};
    list.forEach(function (t) {
      txnItems(t).forEach(function (it) {
        items += Number(it.qty || 0);
        var k = displayName(it.name || "");
        topMap[k] = (topMap[k] || 0) + Number(it.qty || 0);
      });
      var pm = t.paymentMethod || "Cash";
      payMap[pm] = payMap[pm] || { count: 0, sum: 0 };
      payMap[pm].count += 1; payMap[pm].sum += Number(t.total_amount || 0);
    });
    var top = Object.keys(topMap).map(function (k) { return { name: k, qty: topMap[k] }; }).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 5);
    var stat = function (label, value) {
      return '<div class="bento-card p-5"><p class="text-xs font-bold uppercase tracking-widest text-gray-400">' + esc(label) + '</p><h3 class="text-2xl font-black mt-1">' + esc(value) + '</h3></div>';
    };
    var html = adminHeaderCard("Reports", "Ringkasan penjualan dari transaksi (dihitung di aplikasi)", "") +
      '<div class="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-3 items-center">' +
      '<label class="text-xs font-bold uppercase text-gray-400">Dari</label><input type="date" value="' + esc(state.reportFrom) + '" onchange="App.setReportDate(\'from\', this.value)" class="p-2.5 bg-gray-50 rounded-xl border border-gray-100 text-sm font-bold outline-none">' +
      '<label class="text-xs font-bold uppercase text-gray-400">Sampai</label><input type="date" value="' + esc(state.reportTo) + '" onchange="App.setReportDate(\'to\', this.value)" class="p-2.5 bg-gray-50 rounded-xl border border-gray-100 text-sm font-bold outline-none">' +
      '<span class="text-sm text-gray-400">' + list.length + ' transaksi</span></div>' +
      '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">' +
      stat("Total Revenue", fmt(revenue)) + stat("Orders", String(list.length)) +
      stat("Avg Ticket", fmt(list.length ? Math.round(revenue / list.length) : 0)) + stat("Avg Items / Order", list.length ? (items / list.length).toFixed(1) : "0.0") +
      '</div>' +
      '<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">' +
      '<div class="bento-card p-5"><h3 class="font-bold mb-3">Top Products</h3>' + (top.length ? top.map(function (p, i) {
        return '<div class="flex justify-between items-center py-2 border-b border-gray-50 last:border-0"><span class="text-sm font-medium">' + (i + 1) + '. ' + esc(p.name) + '</span><b class="text-sm">' + p.qty + '×</b></div>';
      }).join("") : '<p class="text-sm text-gray-400">Belum ada penjualan pada periode ini.</p>') + '</div>' +
      '<div class="bento-card p-5"><h3 class="font-bold mb-3">Pembayaran</h3>' + (Object.keys(payMap).length ? Object.keys(payMap).map(function (k) {
        var pct = revenue ? Math.round(payMap[k].sum / revenue * 100) : 0;
        return '<div class="py-2"><div class="flex justify-between text-sm"><span class="font-medium">' + esc(k) + '</span><b>' + fmt(payMap[k].sum) + ' (' + payMap[k].count + '×)</b></div><div class="h-2 bg-gray-100 rounded-full mt-1 overflow-hidden"><div class="h-full bg-[#C7D957] rounded-full" style="width:' + pct + '%"></div></div></div>';
      }).join("") : '<p class="text-sm text-gray-400">Belum ada penjualan pada periode ini.</p>') + '</div></div>';
    return html;
  }
  function setReportDate(which, value) {
    if (which === "from") state.reportFrom = value; else state.reportTo = value;
    render();
  }

  // ---------- Settings (hanya field yang ada — via updateSetting) ----------
  function renderAdminSettings() {
    var s = state.settings || {};
    var fields = [
      ["restaurant_name", "Nama Resto", "text"],
      ["currency", "Mata Uang", "text"],
      ["whatsapp_admin_phone", "WhatsApp Admin", "text"],
      ["tausil_fee", "Biaya Tausil (LE, Delivery saja)", "number"],
      ["tax_rate", "Pajak (%)", "number"],
      ["loyalty_rate", "Poin: 1 poin tiap X LE", "number"],
      ["egp_to_idr_rate", "Kurs EGP → IDR", "text"],
    ];
    var html = adminHeaderCard("Settings", "Pengaturan resto — tersimpan di database, langsung berlaku", blackBtn("Simpan", "App.saveSettings()", "save")) +
      '<div class="bento-card p-6 grid grid-cols-1 md:grid-cols-2 gap-4">' +
      fields.map(function (f) {
        return '<div><label class="text-xs font-bold uppercase text-gray-400">' + esc(f[1]) + '</label>' +
          '<input id="set-' + f[0] + '" type="' + f[2] + '" value="' + esc(s[f[0]] || "") + '" class="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 outline-none focus:border-[#C7D957] mt-1"></div>';
      }).join("") + '</div>' +
      '<p class="text-sm text-gray-400">PIN staf diganti lewat menu Staff (Edit → PIN Baru). Void PIN &amp; Kitchen PIN tidak ditampilkan di sini.</p>';
    return html;
  }
  async function saveSettings() {
    var keys = ["restaurant_name", "currency", "whatsapp_admin_phone", "tausil_fee", "tax_rate", "loyalty_rate", "egp_to_idr_rate"];
    var map = {};
    keys.forEach(function (k) { var el = $("set-" + k); if (el) map[k] = el.value; });
    var res = await window.supabaseApi.updateSettingsBulk(map);
    if (!res || !res.ok) { alert((res && res.message) || "Gagal menyimpan pengaturan."); return; }
    await refreshStaffData();
    alert("Pengaturan tersimpan.");
  }

  // ---------- Customer View (publik, tanpa PIN, refresh 15 dtk) ----------
  function custViewTotals(order) {
    var items = Array.isArray(order.items) ? order.items : [];
    if (!items.length && typeof order.items === "string") { try { items = JSON.parse(order.items) || []; } catch (e) {} }
    var sub = items.reduce(function (a, it) { return a + Number(it.price || 0) * Number(it.qty || 0); }, 0);
    var service = order.orderType === "Delivery" ? Number(state.settings.tausil_fee || 5) : 0;
    var tax = Math.round(sub * Number(state.settings.tax_rate || 10) / 100);
    return { items: items, subtotal: sub, service: service, tax: tax, total: (order.total_amount != null ? Number(order.total_amount) : sub + service + tax) };
  }
  async function loadCustomerView() {
    if (state.demoMode) { state.customerView = { order: null, error: "" }; render(); return; }
    try {
      var order = null, error = "";
      if (state.orderId) {
        var res = await window.supabaseApi.trackOrder(state.orderId);
        if (res && res.ok) order = res.data; else error = (res && res.message) || "Order tidak ditemukan.";
      } else {
        var list = await window.supabaseApi.getTransactions();
        var rows = (list && list.ok) ? (list.data || []) : [];
        var active = rows.filter(function (t) { return ["Pending", "Dibuat", "Diantar"].indexOf(t.status) !== -1; });
        active.sort(function (a, b) { return String(b.timestamp || "").localeCompare(String(a.timestamp || "")); });
        if (active.length) {
          var r2 = await window.supabaseApi.trackOrder(active[0].id);
          order = (r2 && r2.ok) ? r2.data : active[0];
        }
      }
      state.customerView = { order: order, error: error };
    } catch (e) { state.customerView = { order: null, error: String(e) }; }
    render();
  }
  function renderCustomerView() {
    var cv = state.customerView;
    if (!cv) { setTimeout(loadCustomerView, 0); return '<div class="h-screen flex items-center justify-center bg-white"><p class="text-gray-400 font-medium">Memuat pesanan...</p></div>'; }
    var order = cv.order;
    var staffName = state.staffUser ? (state.staffUser.name || "Staff") : "—";
    var left;
    if (cv.error) {
      left = '<div class="h-full flex flex-col items-center justify-center text-center py-20"><p class="text-lg font-bold">' + esc(cv.error) + '</p><p class="text-sm text-gray-400 mt-1">Periksa nomor order lalu coba lagi.</p></div>';
    } else if (!order) {
      left = '<div class="h-full flex flex-col items-center justify-center text-center py-20 opacity-30"><i data-lucide="shopping-basket" class="w-12 h-12 mb-2"></i><p class="text-sm font-bold uppercase tracking-widest">Awaiting Order</p></div>';
    } else {
      var t = custViewTotals(order);
      var itemsHtml = t.items.map(function (it) {
        return '<div class="flex items-start justify-between py-2 border-b border-gray-100/50"><div class="flex-1"><div class="flex items-center gap-2"><span class="font-black text-xs bg-black text-white px-1.5 rounded">' + Number(it.qty || 0) + 'x</span><h3 class="text-sm font-bold truncate">' + esc(displayName(it.name || "")) + '</h3></div>' +
          (it.notes ? '<p class="text-[10px] text-orange-500 italic font-medium ml-7 mt-1">"' + esc(it.notes) + '"</p>' : "") + '</div>' +
          '<p class="text-sm font-black">' + fmt(Number(it.price || 0) * Number(it.qty || 0)) + '</p></div>';
      }).join("");
      left = '<div id="cust-view-items" class="flex-1 overflow-y-auto space-y-2 pr-2 mb-6 border-y border-gray-200 py-4">' + itemsHtml + '</div>' +
        '<div class="space-y-2"><div class="flex justify-between text-sm text-gray-500"><span class="font-medium">Subtotal</span><span class="font-bold">' + fmt(t.subtotal) + '</span></div>' +
        '<div class="flex justify-between text-sm text-gray-500"><span class="font-medium">Service &amp; Tax</span><span class="font-bold">' + fmt(t.service + t.tax) + '</span></div>' +
        '<div class="pt-4 mt-2 border-t-2 border-dashed border-gray-300 flex justify-between items-end"><span class="text-xl font-black">GRAND TOTAL</span><span class="text-4xl font-black tracking-tighter">' + fmt(t.total) + '</span></div></div>';
    }
    var name = order ? (order.customerName || "Guest") : "Guest";
    var type = order ? (order.orderType || "-") : "-";
    var total = order ? fmt(custViewTotals(order).total) : fmt(0);
    var status = order ? order.status : "";
    var html = '<div class="grid grid-cols-1 lg:grid-cols-12 h-screen overflow-hidden bg-white">' +
      '<div class="lg:col-span-7 xl:col-span-8 p-8 flex flex-col border-r border-gray-100 bg-gray-50">' +
      '<div class="mb-4 flex items-center gap-4">' +
      (state.staffUser ? '<button onclick="App.go(\'admin\')" class="w-12 h-12 bg-white text-gray-600 rounded-2xl flex items-center justify-center hover:bg-[#C7D957] hover:text-black transition-all shadow-sm border border-gray-100"><i data-lucide="arrow-left" class="w-6 h-6"></i></button>' : "") +
      '<div><h2 class="text-xl md:text-4xl font-black uppercase tracking-tighter">SUMMARY</h2>' +
      '<div class="flex items-center gap-2 text-gray-400 font-bold uppercase text-[10px] tracking-widest mt-1"><span>' + esc(name) + '</span> &bull; <span>' + esc(staffName) + '</span> &bull; <span>' + esc(type) + '</span></div></div></div>' +
      left +
      '</div>' +
      '<div class="lg:col-span-5 xl:col-span-4 relative overflow-hidden bg-black text-white hidden lg:flex flex-col items-center justify-center p-8 text-center">' +
      '<i data-lucide="layout-grid" class="w-12 h-12 mb-4"></i>' +
      '<h3 class="text-3xl font-black uppercase tracking-tighter">Khatulistiwa Resto</h3>' +
      '<p class="text-gray-400 text-sm mt-1">Cita Rasa Nusantara &bull; Cairo, Mesir</p>' +
      (order ? '<p class="text-xs font-bold uppercase tracking-widest text-gray-400 mt-8">Order #' + esc(String(order.id).split("-").pop()) + '</p>' +
      '<p class="text-5xl font-black tracking-tighter mt-2">' + total + '</p>' +
      '<div class="mt-4">' + statusPill(status) + '</div>' : "") +
      '</div></div>';
    return html;
  }

  // ---------- Queue View (publik, tanpa PIN, refresh 15 dtk) ----------
  function queueShortId(id) {
    var s = String(id || "");
    return s.indexOf("-") > -1 ? s.split("-").pop() : s.slice(-4);
  }
  async function loadQueueView() {
    if (state.demoMode) { state.queueView = { preparing: [], ready: [] }; render(); return; }
    try {
      var list = await window.supabaseApi.getTransactions();
      var rows = (list && list.ok) ? (list.data || []) : [];
      var today = new Date().toISOString().slice(0, 10);
      // Sinkron dengan Kitchen: pesanan aktif tampil apa pun tanggalnya.
      rows = rows.filter(function (t) { return t.status !== "Void" && (t.status !== "Selesai" || String(t.timestamp || "").slice(0, 10) === today); });
      rows.sort(function (a, b) { return String(a.timestamp || "").localeCompare(String(b.timestamp || "")); });
      state.queueView = {
        preparing: rows.filter(function (t) { return t.status === "Pending" || t.status === "Dibuat"; }),
        ready: rows.filter(function (t) { return t.status === "Diantar"; }),
      };
    } catch (e) { state.queueView = { preparing: [], ready: [] }; }
    render();
  }
  function queueCardHtml(t, ready) {
    return '<div class="' + (ready ? "bg-green-50 border border-green-200" : "bg-gray-100") + ' px-8 py-4 rounded-2xl flex justify-between items-center"><span class="text-3xl font-black text-gray-800">#' + esc(queueShortId(t.id)) + '</span><span class="text-xs font-bold text-gray-400 uppercase tracking-widest">' + esc(t.orderType || "") + '</span></div>';
  }
  function renderQueueView() {
    var q = state.queueView;
    if (!q) { setTimeout(loadQueueView, 0); return '<div class="h-screen flex items-center justify-center bg-white"><p class="text-gray-400 font-medium">Memuat antrean...</p></div>'; }
    var prep = q.preparing.map(function (t) { return queueCardHtml(t, false); }).join("") || '<p class="text-gray-400 text-sm py-4">Belum ada pesanan yang disiapkan.</p>';
    var ready = q.ready.map(function (t) { return queueCardHtml(t, true); }).join("") || '<p class="text-gray-400 text-sm py-4">Belum ada pesanan yang siap.</p>';
    var html = '<div class="grid grid-cols-1 lg:grid-cols-12 h-screen overflow-hidden bg-white">' +
      '<div class="lg:col-span-8 grid grid-cols-1 lg:grid-cols-2 h-full">' +
      '<div class="p-8 border-r border-gray-100 flex flex-col"><div class="flex items-center gap-4 mb-8">' +
      (state.staffUser ? '<button onclick="App.go(\'admin\')" class="w-12 h-12 bg-gray-100 text-gray-600 rounded-2xl flex items-center justify-center hover:bg-[#C7D957] hover:text-black transition-all"><i data-lucide="arrow-left" class="w-6 h-6"></i></button>' : "") +
      '<div><h2 class="text-3xl font-black uppercase tracking-tighter">Preparing</h2><p class="text-xs font-bold text-gray-400 uppercase tracking-widest">In the Kitchen</p></div></div>' +
      '<div class="flex-1 space-y-3 content-start overflow-y-auto pr-2">' + prep + '</div></div>' +
      '<div class="p-8 bg-green-50/60 flex flex-col"><div class="flex items-center gap-4 mb-8">' +
      '<div class="w-12 h-12 bg-green-600 text-white rounded-2xl flex items-center justify-center"><i data-lucide="check-check" class="w-6 h-6"></i></div>' +
      '<div><h2 class="text-3xl font-black uppercase tracking-tighter">Ready</h2><p class="text-xs font-bold text-green-700 uppercase tracking-widest">Pick Up Now</p></div></div>' +
      '<div class="flex-1 space-y-3 content-start overflow-y-auto pr-2">' + ready + '</div></div>' +
      '</div>' +
      '<div class="lg:col-span-4 relative overflow-hidden bg-black text-white hidden lg:flex flex-col items-center justify-center p-8 text-center">' +
      '<i data-lucide="layout-grid" class="w-12 h-12 mb-4"></i>' +
      '<h3 class="text-3xl font-black uppercase tracking-tighter">Khatulistiwa Resto</h3>' +
      '<p class="text-gray-400 text-sm mt-1">Antrean Pesanan</p>' +
      '<p id="queue-clock" class="text-5xl font-black tracking-tighter mt-8">--:--</p>' +
      '<p class="text-sm text-gray-400 mt-4">' + q.preparing.length + ' disiapkan &bull; ' + q.ready.length + ' siap</p>' +
      '</div></div>';
    return html;
  }

  // ---------- admin shell ----------
  function renderAdmin() {
    if (!state.staffUser) { showStaffLogin(); return '<div class="mt-8 text-center text-gray-500 font-medium">Masuk sebagai staf untuk membuka Admin.</div>'; }
    hideStaffLogin();
    var tab = state.adminTab === "kitchen" ? "pos" : state.adminTab;
    var html = '<div class="flex flex-col gap-3 md:gap-6 py-4 md:py-8 px-3 md:px-6">';
    if (tab === "pos") html += renderAdminPos();
    else if (tab === "transactions") html += renderAdminTransactions();
    else if (tab === "customers") html += renderAdminCustomers();
    else if (tab === "products" || tab === "categories" || tab === "employees") html += renderAdminManagement(tab);
    else if (tab === "reports") html += renderAdminReports();
    else if (tab === "settings") html += renderAdminSettings();
    else html += renderAdminPos();
    html += '</div>';
    setTimeout(function () { updateSidebarActive(); refreshIcons(); }, 0);
    return html;
  }
  // ---------- router / render ----------
  function stopTimers() {
    if (state.trackTimer) { clearInterval(state.trackTimer); state.trackTimer = null; }
    if (state.kitchenTimer) { clearInterval(state.kitchenTimer); state.kitchenTimer = null; }
    if (state.customerTimer) { clearInterval(state.customerTimer); state.customerTimer = null; }
    if (state.queueTimer) { clearInterval(state.queueTimer); state.queueTimer = null; }
  }
  function render() {
    stopTimers();
    updateHeaderMember(); renderCartBadge();
    var main = $("app");
    var nav = $("bottom-nav"), header = $("app-header"), sidebar = $("sidebar");
    var isAdminView = state.view === "admin" || state.view === "kitchen";
    var isDisplayView = state.view === "customer" || state.view === "queue";
    if (header) header.style.display = (isAdminView || isDisplayView) ? "none" : "";
    if (nav) nav.style.display = (isAdminView || isDisplayView) ? "none" : "";
    if (sidebar) sidebar.classList.toggle("hidden", state.view !== "admin" || !state.staffUser);
    var fullBleed = isAdminView || isDisplayView;
    main.classList.toggle("max-w-3xl", !fullBleed);
    main.classList.toggle("px-5", !fullBleed);
    main.classList.toggle("pt-32", !fullBleed);
    main.classList.toggle("pb-44", !fullBleed);
    main.classList.toggle("pb-32", isAdminView);
    main.classList.toggle("p-0", isDisplayView);
    main.classList.toggle("admin-font", fullBleed);
    if (state.view !== "admin" && state.view !== "kitchen") hideStaffLogin();
    if (state.view === "admin" && sidebar) {
      var expanded = sidebar.classList.contains("lg:w-64");
      main.classList.toggle("lg:ml-64", expanded);
      main.classList.toggle("lg:ml-24", !expanded);
    } else { main.classList.remove("lg:ml-24", "lg:ml-64"); }
    document.querySelectorAll("[data-nav]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-nav") === state.view || (state.view === "online" && b.getAttribute("data-nav") === "online"));
    });
    if (state.loading) { main.innerHTML = '<p class="text-center py-16 font-body-md text-body-md text-on-surface-variant">Memuat menu...</p>'; return; }
    if (state.loadError && !state.products.length) {
      main.innerHTML = '<div class="mt-8 bg-surface-container-lowest rounded-[24px] shadow p-5 text-center"><h2 class="font-headline-md text-headline-md text-on-surface">Belum terhubung ke Supabase</h2><p class="font-body-sm text-body-sm text-on-surface-variant mt-1">' + esc(state.loadError) + '</p><p class="font-body-md text-body-md text-on-surface mt-3">Isi <b>public/config.js</b> dengan Project URL dan anon key (lihat README.md), lalu deploy ulang.</p></div>';
      return;
    }
    if (state.view === "online") main.innerHTML = renderOnline();
    else if (state.view === "order") {
      main.innerHTML = renderOrder();
      // Demo mode: no tracking (nothing recorded) — renderOrder shows the
      // local demo order summary instead; never call loadTrack here.
      if (!state.demoMode) {
        if (state.orderId && !state.trackOrder) loadTrack(state.orderId);
        state.trackTimer = setInterval(function () { if (state.orderId) loadTrack(state.orderId); }, 15000);
      }
    }
    else if (state.view === "rewards") main.innerHTML = renderRewards();
    else if (state.view === "profile") main.innerHTML = renderProfile();
    else if (state.view === "admin") main.innerHTML = renderAdmin();
    else if (state.view === "kitchen") {
      main.innerHTML = renderKitchen();
      state.kitchenTimer = setInterval(loadKitchen, 15000);
    }
    else if (state.view === "customer") {
      main.innerHTML = renderCustomerView();
      state.customerTimer = setInterval(loadCustomerView, 15000);
    }
    else if (state.view === "queue") {
      main.innerHTML = renderQueueView();
      state.queueTimer = setInterval(loadQueueView, 15000);
    }
    else main.innerHTML = renderOnline();
    refreshCartDrawer();
    if (isAdminView || isDisplayView) refreshIcons();
    // Jam sidebar / queue baru dibuat ulang tiap render — isi langsung,
    // jangan tunggu interval 10 detik (kalau tidak, queue tampil "--:--").
    updateClock();
  }

  // ---------- public API ----------
  window.App = {
    go: function (view, orderId) {
      state.view = view; state.orderId = orderId || null; state.trackOrder = null; state.trackError = "";
      history.pushState(null, "", baseUrl() + "?view=" + view + (orderId ? "&id=" + encodeURIComponent(orderId) : ""));
      window.scrollTo(0, 0); render();
    },
    setCategory: function (c) { state.category = c; render(); },
    onSearch: function (v) { state.search = v; if (state.view !== "online") { state.view = "online"; } render(); },
    addToCart: addToCart,
    changeQty: changeQty,
    removeFromCart: removeFromCart,
    copyTrackingLink: copyTrackingLink,
    editAddress: editAddress,
    about: aboutApp,
    toggleCart: function (open) {
      var d = $("cart-drawer");
      if (open === undefined) open = d.classList.contains("hidden");
      d.classList.toggle("hidden", !open);
      if (open) refreshCartDrawer();
    },
    openCheckout: openCheckout,
    setOrderType: function (btn) {
      state.orderType = btn.getAttribute("data-v");
      syncCheckoutSelectors();
      refreshCartDrawer(); // total berubah (Tausil hanya untuk Delivery)
      renderPosCartPanel();
    },
    setPayment: function (btn) {
      state.payment = btn.getAttribute("data-v");
      syncCheckoutSelectors();
      renderCheckoutSummary();
    },
    lookupPhone: lookupPhone,
    shareLocation: shareLocation,
    submitOrder: submitOrder,
    toggleTrack: function () { $("track-modal").classList.toggle("hidden"); },
    trackFromInput: function () { var id = $("track-input").value.trim().toUpperCase(); if (!id) return; App.toggleTrack(); App.go("order", id); },
    trackFromInline: function () { var id = $("track-inline").value.trim().toUpperCase(); if (!id) return; state.orderId = id; state.trackOrder = null; loadTrack(id); },
    signInWithGoogle: signInWithGoogle,
    signOutGoogle: signOutGoogle,
    saveProfile: async function () {
      var res = await syncMember({ phone: $("pf-phone").value.trim(), address: $("pf-address").value.trim(), latitude: state.location ? state.location.latitude : undefined, longitude: state.location ? state.location.longitude : undefined, mapsUrl: state.location ? state.location.mapsUrl : undefined });
      alert(res ? "Profil tersimpan." : "Gagal menyimpan profil.");
      render();
    },
    staffLogin: staffLogin,
    staffLogout: staffLogout,
    setAdminTab: function (t) { state.adminTab = t; closePopovers(); render(); },
    setTxnStatus: setTxnStatus,
    voidTxn: voidTxn,
    toggleSidebar: toggleSidebar,
    setDisplay: setDisplay,
    toggleDisplayPopover: toggleDisplayPopover,
    toggleMorePopover: toggleMorePopover,
    closePopovers: closePopovers,
    openStaffModal: openStaffModal,
    closeStaffModal: closeStaffModal,
    selectEmployee: selectEmployee,
    backToAccounts: backToAccounts,
    pinPadDigit: pinPadDigit,
    pinPadDelete: pinPadDelete,
    posSearch: posSearch,
    setPosCategory: setPosCategory,
    selectPosCustomer: selectPosCustomer,
    togglePosCustomerPicker: togglePosCustomerPicker,
    toggleFullscreen: toggleFullscreen,
    openScanner: openScanner,
    setTxnFilter: setTxnFilter,
    loadKitchen: loadKitchen,
    openMgmtForm: openMgmtForm,
    closeMgmtForm: closeMgmtForm,
    saveMgmtForm: saveMgmtForm,
    deleteMgmtRecord: deleteMgmtRecord,
    setReportDate: setReportDate,
    saveSettings: saveSettings,
  };

  window.addEventListener("popstate", function () {
    var q = params();
    state.view = q.get("view") || "online";
    state.orderId = q.get("id") || null;
    state.trackOrder = null;
    render();
  });

  document.addEventListener("DOMContentLoaded", boot);
})();
