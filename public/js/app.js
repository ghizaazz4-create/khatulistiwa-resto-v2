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
 * admin (staff PIN: POS / Kitchen / Transactions / Customers),
 * kitchen (display, auto-refresh).
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
    if (state.view === "customer" || state.view === "queue") state.view = "admin";
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
    var pts = $("header-points");
    if (pts) {
      if (m) { pts.textContent = Number(m.points || 0); pts.classList.remove("hidden"); }
      else pts.classList.add("hidden");
    }
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
    saveCart(); renderCartBadge(); render();
  }
  function changeQty(key, d) {
    var it = state.cart.find(function (c) { return c.key === key; }); if (!it) return;
    it.qty += d; if (it.qty <= 0) state.cart = state.cart.filter(function (c) { return c.key !== key; });
    saveCart(); renderCartBadge(); render();
  }
  function removeFromCart(key) {
    state.cart = state.cart.filter(function (c) { return c.key !== key; });
    saveCart(); renderCartBadge(); render();
  }
  function cartTotals() {
    var sub = 0, pts = 0;
    state.cart.forEach(function (c) {
      if (c.isRedeemed) pts += Number(c.point_price || 0) * c.qty;
      else sub += Number(c.price || 0) * c.qty;
    });
    var service = Math.round(sub * Number(state.settings.service_charge || 5) / 100);
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
      '<div class="flex justify-between font-body-md text-body-md text-on-surface-variant"><span>Service 5%</span><span class="font-headline-sm text-headline-sm text-on-surface">' + fmt(t.service) + '</span></div>' +
      '<div class="flex justify-between font-body-md text-body-md text-on-surface-variant"><span>Tax 10%</span><span class="font-headline-sm text-headline-sm text-on-surface">' + fmt(t.tax) + '</span></div>' +
      (t.pointsCost ? '<div class="flex justify-between font-label-md text-label-md text-primary-container"><span>Poin dipakai</span><span>' + t.pointsCost + ' Pts</span></div>' : '') +
      '<div class="flex justify-between items-center border-t border-surface-variant/70 pt-2"><span class="font-headline-md text-headline-md text-on-surface">Total</span><span class="font-display-hero-mobile text-display-hero-mobile text-primary-container">' + fmt(t.total) + '</span></div></div>';
    var lbl = $("cart-checkout-label"); if (lbl) lbl.textContent = "Checkout • " + fmt(t.total);
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
    return '<div class="bg-surface-container-lowest rounded-2xl p-3 flex flex-col justify-between shadow-[0_4px_16px_-2px_rgba(30,63,50,0.06)] ' + (opts.carousel ? "shrink-0 w-40" : "") + '">' +
      '<div class="flex flex-col"><div class="relative w-full ' + imgH + ' rounded-xl overflow-hidden bg-surface-container-low mb-2.5">' + img + badge + '</div>' +
      '<h3 class="font-headline-sm text-headline-sm text-on-surface leading-tight line-clamp-1">' + esc(displayName(p.name)) + '</h3></div>' +
      '<div class="flex items-center justify-between mt-2 pt-1"><span class="font-price-tag text-price-tag text-primary-container">' + fmt(p.price) + '</span>' +
      '<button onclick="App.addToCart(\'' + esc(p.id) + '\')" class="w-8 h-8 rounded-full bg-primary-container text-on-primary flex items-center justify-center active:scale-90 transition-transform shadow-sm" aria-label="Tambah"><span class="material-symbols-outlined text-[18px]">add</span></button></div>' +
      (Number(p.point_price || 0) > 0 ? '<button onclick="App.addToCart(\'' + esc(p.id) + '\', true)" class="mt-2 w-full py-1.5 rounded-full bg-secondary-container text-on-secondary-container font-label-md text-label-md font-bold">Tukar ' + Number(p.point_price) + ' Pts</button>' : '') +
      '</div>';
  }
  function renderOnline() {
    var popular = POPULAR_SKUS.map(productBySku).filter(Boolean);
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
  // Ringkasan tagihan ASLI: Subtotal dari item + Layanan 5% + Pajak 10%
  // (tarif dari settings, sama seperti cartTotals); Total = total_amount tersimpan.
  // TIDAK ada ongkir / kupon (tidak ada di data).
  function trackBillHtml(t, items, subtotal, service, tax) {
    var qty = (items || []).reduce(function (a, it) { return a + Number(it.qty || 0); }, 0);
    var serviceRate = Number(state.settings.service_charge || 5);
    var taxRate = Number(state.settings.tax_rate || 10);
    var sub = (subtotal != null) ? subtotal : (items || []).reduce(function (a, it) { return a + Number(it.price || 0) * Number(it.qty || 0); }, 0);
    var svc = (service != null) ? service : Math.round(sub * serviceRate / 100);
    var tx = (tax != null) ? tax : Math.round(sub * taxRate / 100);
    var total = (t.total_amount != null) ? t.total_amount : t.total;
    return '<div class="mt-4 pt-3 flex flex-col gap-2 bg-surface-container-lowest">' +
      '<div class="flex justify-between items-center text-on-surface-variant font-body-sm text-body-sm"><span>Subtotal (' + qty + ' item)</span><span class="font-semibold text-on-surface">' + fmt(sub) + '</span></div>' +
      '<div class="flex justify-between items-center text-on-surface-variant font-body-sm text-body-sm"><span>Layanan (' + serviceRate + '%)</span><span class="font-semibold text-on-surface">' + fmt(svc) + '</span></div>' +
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
    html += '<div class="flex items-center gap-2.5"><div class="flex-1 h-12 bg-surface-container-lowest rounded-full px-4 flex items-center gap-2.5 shadow-[0_2px_10px_rgba(30,63,50,0.05)]"><span class="material-symbols-outlined text-outline text-[20px]">search</span><input id="track-inline" class="w-full bg-transparent font-body-md text-body-md text-on-surface placeholder:text-outline focus:outline-none font-mono uppercase" placeholder="YYMMDD-XXX" value="' + esc(state.orderId || "") + '"></div><button onclick="App.trackFromInline()" class="w-12 h-12 rounded-full bg-primary-container text-on-primary flex items-center justify-center shadow-sm active:scale-95 transition-transform" aria-label="Lacak"><span class="material-symbols-outlined text-[20px]">search</span></button></div>';
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
    return '<article class="flex flex-col rounded-[20px] bg-surface-container-lowest p-3 shadow-[0_6px_18px_-4px_rgba(30,63,50,0.06)] justify-between">' +
      '<div class="flex flex-col gap-2"><div class="relative w-full aspect-square rounded-[16px] overflow-hidden bg-surface-container">' + img + '</div>' +
      '<div class="flex flex-col"><h3 class="font-headline-sm text-headline-sm text-on-surface truncate">' + esc(displayName(p.name)) + '</h3>' +
      '<div class="flex items-center gap-1 text-on-tertiary-container mt-0.5"><span class="material-symbols-outlined text-[14px]" style="font-variation-settings:\'FILL\' 1">stars</span><span class="font-price-tag text-price-tag font-bold">' + Number(p.point_price) + ' Poin</span></div></div></div>' +
      '<button onclick="App.addToCart(\'' + esc(p.id) + '\', true)" class="mt-3 w-full h-9 rounded-full bg-primary-container text-on-primary font-label-md text-label-md flex items-center justify-center active:scale-95 transition-transform">Tukar</button></article>';
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
    document.querySelectorAll(".co-pay-row").forEach(function (row) {
      var sel = row.getAttribute("data-v") === state.payment;
      row.classList.toggle("bg-surface-container-low", sel);
      var radio = row.querySelector(".pay-radio"), dot = row.querySelector(".pay-dot");
      if (radio) radio.className = "pay-radio w-5 h-5 rounded-full flex items-center justify-center shrink-0 " + (sel ? "bg-primary-container" : "bg-surface-dim");
      if (dot) dot.classList.toggle("hidden", !sel);
    });
  }
  function openCheckout() {
    if (!state.cart.length) { alert("Keranjang masih kosong."); return; }
    var m = state.member;
    if (m) {
      if (!$("co-name").value) $("co-name").value = m.name || "";
      if (!$("co-phone").value) $("co-phone").value = m.phone || "";
      if (!$("co-address").value) $("co-address").value = m.address || "";
      if (m.latitude && m.longitude) { state.location = { latitude: m.latitude, longitude: m.longitude, mapsUrl: m.maps_url || ("https://maps.google.com/?q=" + m.latitude + "," + m.longitude) }; $("co-location").innerHTML = '<span class="material-symbols-outlined text-[14px] align-middle">location_on</span> Lokasi tersimpan dipakai'; }
    }
    syncCheckoutSelectors();
    renderCheckoutSummary();
    $("checkout-modal").classList.remove("hidden");
  }
  function closeCheckout() { $("checkout-modal").classList.add("hidden"); var e = $("co-error"); if (e) e.classList.add("hidden"); }
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
    '<div class="flex justify-between font-body-md text-body-md text-on-surface-variant"><span>Service 5%</span><span class="font-headline-sm text-headline-sm text-on-surface">' + fmt(t.service) + '</span></div>' +
    '<div class="flex justify-between font-body-md text-body-md text-on-surface-variant"><span>Tax 10%</span><span class="font-headline-sm text-headline-sm text-on-surface">' + fmt(t.tax) + '</span></div>' +
    '<div class="flex justify-between items-center pt-1"><div><span class="font-headline-md text-headline-md text-on-surface block">Total Pembayaran</span><span class="font-body-sm text-body-sm text-outline">Termasuk service &amp; pajak</span></div><span class="font-display-hero-mobile text-display-hero-mobile text-primary-container">' + fmt(t.total) + '</span></div>' +
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
    lines.push("Tipe: " + state.orderType);
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
    function fail(msg) { err.textContent = msg; err.classList.remove("hidden"); }
    if (!name) return fail("Isi nama dulu.");
    if (phone.replace(/\D/g, "").length < 7) return fail("Isi nomor WhatsApp yang valid.");
    if (state.orderType === "Delivery" && !address) return fail("Isi alamat delivery dulu (atau tekan Bagikan Lokasi).");
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
      customerId: state.member ? state.member.id : undefined,
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
    closeCheckout();
    state.view = "order"; state.orderId = txnId; state.trackOrder = null; state.trackError = "";
    state.demoOrder = demoOrder;
    history.replaceState(null, "", baseUrl() + "?view=order&id=" + encodeURIComponent(txnId));
    if (state.demoMode) render();
    else await loadTrack(txnId);
  }

  // ---------- admin (staff PIN) — restyle ringan ke token Stitch ----------
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
    var sel = $("staff-employee");
    sel.innerHTML = staffEmployees().map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name) + ' (' + esc(e.role) + ')</option>'; }).join("");
    $("staff-login").classList.remove("hidden");
  }
  async function staffLogin() {
    var emp = $("staff-employee").value, pin = $("staff-pin").value.trim();
    var err = $("staff-error"); err.classList.add("hidden");
    var res = await window.supabaseApi.verifyPin(emp, pin);
    if (!res || !res.ok) { err.textContent = (res && res.message) || "PIN salah."; err.classList.remove("hidden"); return; }
    state.staffUser = res.data || { id: emp };
    try { localStorage.setItem("bento_session_user", JSON.stringify(state.staffUser)); } catch (e) {}
    $("staff-login").classList.add("hidden");
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
    state.staffUser = null; state.adminTab = "pos"; render();
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
  async function loadKitchen() {
    var res = await window.supabaseApi.getTransactions();
    var rows = (res && res.ok) ? (res.data || []) : [];
    var el = $("kitchen-list");
    if (!el) return;
    var today = new Date().toISOString().slice(0, 10);
    rows = rows.filter(function (t) { return String(t.timestamp || "").slice(0, 10) === today && t.status !== "Void"; });
    el.innerHTML = rows.length ? rows.map(function (t) {
      var items = [];
      try { items = JSON.parse(t.items || "[]"); } catch (e) {}
      var next = t.status === "Pending" ? "Dibuat" : (t.status === "Dibuat" ? (t.orderType === "Delivery" ? "Diantar" : "Selesai") : (t.status === "Diantar" ? "Selesai" : null));
      return '<div class="bg-surface-container-lowest rounded-2xl shadow-sm p-4 mb-3"><div class="flex justify-between"><b class="font-mono">' + esc(t.id) + '</b><span class="font-headline-sm text-headline-sm text-primary-container">' + esc(t.status) + '</span></div>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(t.orderType) + ' • ' + fmt(t.total_amount) + ' • ' + esc(t.paymentMethod || "") + '</p>' +
        '<div class="font-body-md text-body-md text-on-surface mt-2">' + items.map(function (it) { return '<div>' + Number(it.qty || 0) + ' × ' + esc(displayName(it.name || "")) + '</div>'; }).join("") + '</div>' +
        (next ? '<button onclick="App.setTxnStatus(\'' + esc(t.id) + '\', \'' + next + '\')" class="mt-3 px-4 py-2 rounded-full bg-primary-container text-on-primary font-label-md text-label-md">Ubah ke ' + next + '</button>' : '<span class="inline-flex items-center gap-1 mt-3 font-label-sm text-label-sm text-primary font-bold bg-primary-fixed/40 px-3 py-1 rounded-full"><span class="material-symbols-outlined text-[15px]">check_circle</span>Selesai</span>') +
        '</div>';
    }).join("") : '<p class="font-body-md text-body-md text-on-surface-variant text-center py-8">Belum ada pesanan hari ini.</p>';
  }
  function renderAdmin() {
    if (!state.staffUser) { showStaffLogin(); return '<div class="mt-8 text-center font-body-md text-body-md text-on-surface-variant">Masuk sebagai staf untuk membuka Admin.</div>'; }
    var tabs = [["pos", "POS"], ["kitchen", "Kitchen"], ["transactions", "Transaksi"], ["customers", "Pelanggan"]];
    var html = '<div class="mt-4"><div class="flex items-center justify-between"><h2 class="font-headline-md text-headline-md text-on-surface">Admin — ' + esc(state.staffUser.name || "Staf") + '</h2><button onclick="App.staffLogout()" class="font-label-md text-label-md bg-surface-container-lowest px-3 py-2 rounded-full shadow-sm">Keluar</button></div>';
    html += '<div class="flex gap-2 overflow-x-auto no-scrollbar mt-3">' + tabs.map(function (t) {
      return '<button onclick="App.setAdminTab(\'' + t[0] + '\')" class="px-4 py-2 rounded-full font-label-md text-label-md whitespace-nowrap ' + (state.adminTab === t[0] ? "bg-primary-container text-on-primary" : "bg-surface-container-lowest shadow-sm text-on-surface-variant") + '">' + t[1] + '</button>';
    }).join("") + '</div>';
    if (state.adminTab === "pos") {
      html += '<div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">' + state.products.filter(function (p) { return p.status === "Active"; }).map(function (p) {
        return '<div class="bg-surface-container-lowest rounded-2xl overflow-hidden shadow-sm">' + (p.imageUrl ? '<img src="' + esc(p.imageUrl) + '" class="w-full h-24 object-cover" onerror="this.style.display=\'none\'" alt="">' : '<div class="w-full h-24 bg-surface-container flex items-center justify-center"><span class="material-symbols-outlined text-[28px] text-outline">' + (CAT_ICON[p.category] || "local_dining") + '</span></div>') + '<div class="p-3"><p class="font-headline-sm text-headline-sm text-on-surface">' + esc(displayName(p.name)) + '</p><p class="font-price-tag text-price-tag text-primary-container">' + fmt(p.price) + '</p><button onclick="App.addToCart(\'' + esc(p.id) + '\')" class="mt-2 w-full py-1.5 rounded-full bg-primary-container text-on-primary font-label-md text-label-md">+ Tambah</button></div></div>';
      }).join("") + '</div>';
      html += '<button onclick="App.toggleCart(true)" class="fixed bottom-24 right-4 z-40 px-5 py-3 rounded-full bg-primary-container text-on-primary font-label-md text-label-md shadow-lg flex items-center gap-2"><span class="material-symbols-outlined text-[20px]">shopping_bag</span>Keranjang (' + state.cart.reduce(function (a, c) { return a + c.qty; }, 0) + ')</button>';
      html += '<p class="font-body-sm text-body-sm text-on-surface-variant mt-4">Checkout POS memakai keranjang yang sama — tombol Checkout di keranjang akan memakai akun staf (bukan WhatsApp online).</p>';
    } else if (state.adminTab === "kitchen") {
      html += '<div id="kitchen-list" class="mt-4"></div><p class="font-body-sm text-body-sm text-outline">Kitchen diperbarui otomatis tiap 15 detik.</p>';
      setTimeout(loadKitchen, 0);
    } else if (state.adminTab === "transactions") {
      html += '<div class="mt-4 space-y-3">' + (state.transactions || []).slice(0, 50).map(function (t) {
        var items = [];
        try { items = typeof t.items === "string" ? JSON.parse(t.items) : (t.items_json || t.items || []); } catch (e) {}
        if (!Array.isArray(items)) items = [];
        return '<div class="bg-surface-container-lowest rounded-2xl shadow-sm p-4"><div class="flex justify-between flex-wrap gap-2"><b class="font-mono">' + esc(t.id) + '</b><span class="font-headline-sm text-headline-sm text-primary-container">' + esc(t.status) + '</span></div>' +
          '<p class="font-body-sm text-body-sm text-on-surface-variant">' + esc(t.orderType || "") + ' • ' + fmt(t.total_amount) + ' • ' + esc(t.paymentMethod || t.payment_method || "") + ' • ' + esc(String(t.timestamp || "").slice(0, 16).replace("T", " ")) + '</p>' +
          '<p class="font-body-md text-body-md text-on-surface">' + items.map(function (it) { return Number(it.qty || 0) + " × " + esc(displayName(it.name || "")); }).join(", ") + '</p>' +
          '<div class="flex gap-2 mt-2 flex-wrap">' + ["Dibuat", "Diantar", "Selesai"].map(function (s) {
            return '<button onclick="App.setTxnStatus(\'' + esc(t.id) + '\', \'' + s + '\')" class="font-label-md text-label-md px-3 py-1.5 rounded-full bg-surface-container">' + s + '</button>';
          }).join("") + '<a class="font-label-md text-label-md px-3 py-1.5 rounded-full bg-secondary-container text-on-secondary-container" href="' + trackingLink(t.id) + '">Link Lacak</a></div></div>';
      }).join("") + '</div>';
    } else if (state.adminTab === "customers") {
      html += '<p class="font-body-sm text-body-sm text-on-surface-variant mt-2">Satu baris per pelanggan — member Google dan Guest dengan nomor WA yang sama digabung (cocok nomor WA / email). Data ini sama dengan yang dilihat member di Profile.</p>';
      html += '<div class="mt-3 space-y-3">' + (state.customers || []).map(function (c) {
        return '<div class="bg-surface-container-lowest rounded-2xl shadow-sm p-4"><div class="flex items-center gap-3">' + (c.avatar_url ? '<img src="' + esc(c.avatar_url) + '" class="w-10 h-10 rounded-full object-cover">' : '<span class="w-10 h-10 rounded-full bg-primary-container text-on-primary flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[20px]">person</span></span>') +
          '<div class="flex-1 min-w-0"><b class="font-headline-sm text-headline-sm text-on-surface">' + esc(c.name || "(tanpa nama)") + '</b>' + (c.google_id ? ' <span class="font-label-sm text-label-sm font-bold bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full">MEMBER GOOGLE</span>' : '') +
          '<p class="font-body-sm text-body-sm text-on-surface-variant truncate">' + esc(c.phone || "") + (c.email ? ' • ' + esc(c.email) : '') + '</p></div>' +
          '<div class="text-right"><b class="font-label-md text-label-md text-primary-container flex items-center gap-1 justify-end"><span class="material-symbols-outlined text-[14px]" style="font-variation-settings:\'FILL\' 1">stars</span>' + Number(c.points || 0) + ' Pts</b><span class="font-body-sm text-body-sm text-on-surface-variant">Belanja ' + fmt(c.total_purchases || 0) + '</span></div></div>' +
          (c.address ? '<p class="font-body-md text-body-md text-on-surface mt-2 flex items-start gap-1"><span class="material-symbols-outlined text-[16px] text-on-tertiary-container shrink-0 mt-0.5">location_on</span>' + esc(c.address) + '</p>' : '') +
          (c.maps_url ? '<a class="font-label-md text-label-md underline text-primary-container" href="' + esc(c.maps_url) + '" target="_blank" rel="noopener">Buka lokasi di Google Maps</a>' : '') +
          (c.last_visit ? '<p class="font-body-sm text-body-sm text-outline mt-1">Terakhir pesan: ' + esc(String(c.last_visit).slice(0, 10)) + '</p>' : '') + '</div>';
      }).join("") + '</div>';
    }
    html += '</div>';
    return html;
  }
  function renderKitchen() {
    var html = '<div class="mt-4"><h2 class="font-headline-md text-headline-md text-on-surface">Kitchen Display</h2><p class="font-body-sm text-body-sm text-on-surface-variant">Pesanan hari ini — ubah status, link lacak pelanggan ikut berubah.</p><div id="kitchen-list" class="mt-4"></div></div>';
    setTimeout(loadKitchen, 0);
    return html;
  }

  // ---------- router / render ----------
  function stopTimers() {
    if (state.trackTimer) { clearInterval(state.trackTimer); state.trackTimer = null; }
    if (state.kitchenTimer) { clearInterval(state.kitchenTimer); state.kitchenTimer = null; }
  }
  function render() {
    stopTimers();
    updateHeaderMember(); renderCartBadge();
    var main = $("app");
    var nav = $("bottom-nav"), header = $("app-header");
    var isAdminView = state.view === "admin" || state.view === "kitchen";
    if (header) header.style.display = isAdminView ? "none" : "";
    if (nav) nav.style.display = isAdminView ? "none" : "";
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
    else main.innerHTML = renderOnline();
    refreshCartDrawer();
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
    openCheckout: function () { App.toggleCart(false); openCheckout(); },
    closeCheckout: closeCheckout,
    setOrderType: function (btn) {
      state.orderType = btn.getAttribute("data-v");
      syncCheckoutSelectors();
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
    setAdminTab: function (t) { state.adminTab = t; render(); },
    setTxnStatus: setTxnStatus,
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
