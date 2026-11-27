/* Khatulistiwa Resto v2 — single-page app (Cloudflare Pages + Supabase).
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
  var CAT_ORDER = ["Nasi Gaol", "Soup Tomyam", "Cemilan", "Classic Drink", "Premium Drink", "Extra Topping", "Fresh Milk"];
  var CAT_EMOJI = { "Nasi Gaol": "🍚", "Soup Tomyam": "🍲", "Cemilan": "🍢", "Classic Drink": "🥤", "Premium Drink": "🧋", "Extra Topping": "✨", "Fresh Milk": "🥛" };
  var POPULAR_SKUS = ["NG01", "NG05", "ST03", "CM01", "PD03", "PD01", "PD08", "CD14"];
  var STATUS_STEPS = ["Pending", "Dibuat", "Diantar", "Selesai"];
  var CART_KEY = "khatulistiwa_cart_v2";
  var MEMBER_KEY = "khatulistiwa_member_v2";

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
  function fmt(n) { return "LE" + Number(n || 0).toLocaleString("en-US"); }
  function money(n) { return Number(n || 0); }
  function params() { return new URLSearchParams(location.search); }
  function baseUrl() { return location.origin + location.pathname; }
  function trackingLink(txnId) { return baseUrl() + "?view=order&id=" + encodeURIComponent(txnId); }
  function loadCart() { try { state.cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]"); } catch (e) { state.cart = []; } }
  function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch (e) {} }
  function loadMember() { try { state.member = JSON.parse(localStorage.getItem(MEMBER_KEY) || "null"); } catch (e) { state.member = null; } }
  function saveMember(m) { state.member = m || null; try { if (m) localStorage.setItem(MEMBER_KEY, JSON.stringify(m)); else localStorage.removeItem(MEMBER_KEY); } catch (e) {} }

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
    return '<div class="mt-4 bg-khatulistiwa-lime/60 border-2 border-khatulistiwa-dark/20 rounded-2xl px-4 py-3 text-sm font-bold text-khatulistiwa-dark">Mode Demo — Supabase belum tersambung. Menu bisa dilihat dan pesan ke WA tetap jalan, tapi pesanan belum tercatat dan belum bisa dilacak.</div>';
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
  function productById(id) { return state.products.find(function (p) { return String(p.id) === String(id); }); }
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
    var b = $("cart-badge"); if (!b) return;
    b.textContent = n; b.classList.toggle("hidden", n === 0);
  }

  // ---------- render: online home ----------
  function heroHtml() {
    var m = state.member;
    return '' +
    '<section class="mt-4 rounded-3xl overflow-hidden bg-khatulistiwa-dark text-white shadow-lg">' +
      '<div class="p-5 sm:p-6">' +
        '<p class="text-khatulistiwa-lime font-black text-xs tracking-widest uppercase">Khatulistiwa Resto • Cairo</p>' +
        '<h2 class="font-black text-3xl leading-tight mt-1">Rasa Indonesia,<br>sekali klik sampai.</h2>' +
        '<p class="text-white/80 text-sm mt-2">Pesan online, tercatat dulu, lalu langsung dibuka WhatsApp admin. Tanpa antre.</p>' +
        '<button onclick="document.getElementById(\'menu-section\')?.scrollIntoView({behavior:\'smooth\'})" class="mt-4 px-5 py-3 rounded-full bg-khatulistiwa-lime text-khatulistiwa-dark font-black text-sm">Order Now →</button>' +
      '</div>' +
      '<div class="px-5 pb-5">' +
        (m
          ? '<div class="bg-white/10 rounded-2xl p-4 flex items-center gap-3"><span class="text-2xl">⭐</span><div class="flex-1"><p class="font-bold text-sm">Halo, ' + esc(m.name) + '</p><p class="text-xs text-white/70">Kamu punya <b class="text-khatulistiwa-lime">' + Number(m.points || 0) + ' poin</b> • 1 poin tiap 10 LE</p></div><button onclick="App.go(\'rewards\')" class="text-xs font-black bg-khatulistiwa-lime text-khatulistiwa-dark px-3 py-2 rounded-full">Lihat Rewards</button></div>'
          : '<div class="bg-white/10 rounded-2xl p-4 flex items-center gap-3"><span class="text-2xl">🎁</span><div class="flex-1"><p class="font-bold text-sm">Jadi Member, dapat poin tiap pesan!</p><p class="text-xs text-white/70">Masuk dengan Google • 1 poin tiap 10 LE • Tukar poin dengan menu</p></div><button onclick="App.signInWithGoogle()" class="text-xs font-black bg-white text-khatulistiwa-dark px-3 py-2 rounded-full whitespace-nowrap">Join Now</button></div>') +
      '</div>' +
    '</section>';
  }
  function categoriesHtml() {
    var cats = ["All"].concat(CAT_ORDER.filter(function (c) { return state.categories.some(function (x) { return x.name === c; }); }));
    return '<div class="flex gap-3 overflow-x-auto no-scrollbar py-4">' + cats.map(function (c) {
      var active = state.category === c;
      var emoji = c === "All" ? "🍽️" : (CAT_EMOJI[c] || "🍴");
      return '<button onclick="App.setCategory(\'' + esc(c) + '\')" class="cat-circle shrink-0 flex flex-col items-center gap-1 ' + (active ? "active" : "") + '">' +
        '<span class="w-16 h-16 rounded-full bg-white shadow flex items-center justify-center text-2xl border-2 ' + (active ? "border-khatulistiwa-dark" : "border-transparent") + '">' + emoji + '</span>' +
        '<span class="text-[11px] font-bold ' + (active ? "" : "text-stone-600") + '">' + esc(c) + '</span></button>';
    }).join("") + '</div>';
  }
  function productCard(p, opts) {
    opts = opts || {};
    var img = p.imageUrl
      ? '<img src="' + esc(p.imageUrl) + '" alt="' + esc(p.name) + '" class="w-full h-36 object-cover" loading="lazy" onerror="this.style.display=\'none\'">'
      : '<div class="w-full h-36 bg-khatulistiwa-creamDark flex items-center justify-center text-4xl">' + (CAT_EMOJI[p.category] || "🍽️") + '</div>';
    var badge = opts.badge ? '<span class="absolute top-2 left-2 bg-khatulistiwa-dark text-khatulistiwa-lime text-[10px] font-black px-2 py-1 rounded-full">' + esc(opts.badge) + '</span>' : '';
    var pts = Number(p.point_price || 0) > 0 ? '<span class="text-[11px] text-stone-500">• ' + Number(p.point_price) + ' Pts</span>' : '';
    return '<div class="bg-white rounded-3xl overflow-hidden shadow-sm relative">' + badge + img +
      '<div class="p-3"><h3 class="font-bold text-sm leading-snug">' + esc(p.name) + '</h3>' +
      '<p class="text-xs text-stone-500">' + esc(p.category) + '</p>' +
      '<div class="flex items-center justify-between mt-2"><span class="font-black text-khatulistiwa-dark">' + fmt(p.price) + ' ' + pts + '</span>' +
      '<button onclick="App.addToCart(\'' + esc(p.id) + '\')" class="w-9 h-9 rounded-full bg-khatulistiwa-dark text-khatulistiwa-lime font-black text-lg leading-none">+</button></div>' +
      (Number(p.point_price || 0) > 0 ? '<button onclick="App.addToCart(\'' + esc(p.id) + '\', true)" class="mt-2 w-full text-[11px] font-black text-khatulistiwa-dark bg-khatulistiwa-lime/50 py-1.5 rounded-full">Tukar ' + Number(p.point_price) + ' Pts</button>' : '') +
      '</div></div>';
  }
  function renderOnline() {
    var popular = POPULAR_SKUS.map(productById).filter(Boolean);
    var list = visibleProducts();
    var html = demoBannerHtml() + heroHtml() + categoriesHtml();
    if (popular.length && state.category === "All" && !state.search) {
      html += '<div class="flex items-center justify-between mt-1"><h2 class="font-black text-lg">Popular Items</h2><button onclick="App.setCategory(\'All\')" class="text-xs font-bold text-khatulistiwa-dark">View All →</button></div>';
      html += '<div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">' + popular.map(function (p, i) { return productCard(p, { badge: i === 0 ? "BESTSELLER" : "POPULAR" }); }).join("") + '</div>';
    }
    html += '<h2 id="menu-section" class="font-black text-lg mt-6 mb-2">' + (state.category === "All" ? "Semua Menu" : esc(state.category)) + ' <span class="text-sm font-bold text-stone-500">(' + list.length + ')</span></h2>';
    html += list.length
      ? '<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">' + list.map(function (p) { return productCard(p); }).join("") + '</div>'
      : '<p class="text-stone-500 text-sm py-6 text-center">Menu tidak ditemukan.</p>';
    html += '<p class="text-center text-xs text-stone-400 mt-6">Harga dalam LE (EGP) • Pesanan tercatat dulu, lalu dibuka WhatsApp admin • <button class="underline font-bold" onclick="App.toggleTrack()">Lacak Pesanan</button></p>';
    return html;
  }

  // ---------- render: tracking ----------
  function statusStepsHtml(status) {
    var flow = state.trackOrderType === "Delivery" ? STATUS_STEPS : ["Pending", "Dibuat", "Selesai"];
    var idx = flow.indexOf(status);
    if (status === "Preparing") idx = 1;
    if (status === "Completed") idx = flow.length - 1;
    if (idx < 0) idx = 0;
    return '<div class="flex items-center justify-between my-5">' + flow.map(function (s, i) {
      var cls = i < idx ? "done" : (i === idx ? "now" : "");
      var label = s === "Dibuat" ? "Dibuat" : s;
      return '<div class="flex flex-col items-center flex-1">' +
        '<div class="step-dot ' + cls + ' w-10 h-10 rounded-full border-2 border-stone-300 bg-white flex items-center justify-center font-black">' + (i < idx ? "✓" : (i + 1)) + '</div>' +
        '<span class="text-[11px] font-bold mt-1 text-center">' + label + '</span></div>' +
        (i < flow.length - 1 ? '<div class="flex-1 h-0.5 bg-stone-300 -mt-6"></div>' : '');
    }).join("") + '</div>';
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
    var html = demoBannerHtml() + '<div class="mt-4 bg-white rounded-3xl shadow p-5">';
    html += '<h2 class="font-black text-xl">Lacak Pesanan</h2>';
    html += '<div class="flex gap-2 mt-3"><input id="track-inline" class="flex-1 p-3 rounded-xl border-2 border-khatulistiwa-creamDark outline-none font-mono uppercase" placeholder="YYMMDD-XXX" value="' + esc(state.orderId || "") + '"><button onclick="App.trackFromInline()" class="px-4 rounded-xl bg-khatulistiwa-dark text-white font-bold">Lacak</button></div>';
    if (state.demoMode && state.demoOrder && String(state.demoOrder.id) === String(state.orderId)) {
      var d = state.demoOrder;
      html += '<div class="mt-4 border-t pt-4"><div class="flex justify-between"><span class="text-sm text-stone-500">Order ID</span><b class="font-mono">' + esc(d.id) + '</b></div>' +
        '<div class="flex justify-between mt-1"><span class="text-sm text-stone-500">Tipe</span><b>' + esc(d.orderType) + '</b></div>' +
        '<div class="flex justify-between mt-1"><span class="text-sm text-stone-500">Pembayaran</span><b>' + esc(d.paymentMethod) + '</b></div></div>';
      html += '<div class="space-y-2 mt-3">' + d.items.map(function (it) {
        return '<div class="flex justify-between text-sm"><span>' + Number(it.qty || 0) + ' × ' + esc(it.name || "") + '</span><b>' + fmt(Number(it.price || 0) * Number(it.qty || 0)) + '</b></div>';
      }).join("") + '</div>';
      html += '<div class="flex justify-between font-black text-lg border-t mt-3 pt-3"><span>Total</span><span>' + fmt(d.total) + '</span></div>';
      html += '<p class="text-sm font-bold text-khatulistiwa-dark mt-3">Pesananmu sudah dikirim ke WhatsApp admin. ' +
        'Mode demo: pesanan ini tidak tercatat di database, jadi statusnya tidak bisa dilacak di sini — admin akan konfirmasi lewat WhatsApp.</p>';
    }
    if (state.trackError) html += '<p class="text-sm font-bold text-red-600 mt-3">' + esc(state.trackError) + '</p>';
    if (t) {
      html += '<div class="mt-4 border-t pt-4"><div class="flex justify-between"><span class="text-sm text-stone-500">Order ID</span><b class="font-mono">' + esc(t.id) + '</b></div>' +
        '<div class="flex justify-between mt-1"><span class="text-sm text-stone-500">Status</span><b class="text-khatulistiwa-dark">' + esc(t.status) + '</b></div>' +
        '<div class="flex justify-between mt-1"><span class="text-sm text-stone-500">Tipe</span><b>' + esc(t.orderType) + '</b></div>' +
        '<div class="flex justify-between mt-1"><span class="text-sm text-stone-500">Pembayaran</span><b>' + esc(t.paymentMethod) + '</b></div></div>';
      html += statusStepsHtml(t.status);
      html += '<div class="space-y-2">' + (t.items || []).map(function (it) {
        return '<div class="flex justify-between text-sm"><span>' + Number(it.qty || 0) + ' × ' + esc(it.name || "") + '</span><b>' + fmt(Number(it.price || 0) * Number(it.qty || 0)) + '</b></div>';
      }).join("") + '</div>';
      html += '<div class="flex justify-between font-black text-lg border-t mt-3 pt-3"><span>Total</span><span>' + fmt(t.total_amount) + '</span></div>';
      if (t.customerName) html += '<p class="text-sm text-stone-500 mt-2">Atas nama: ' + esc(t.customerName) + '</p>';
      html += '<p class="text-xs text-stone-400 mt-3">Status diperbarui otomatis tiap 15 detik — sama seperti yang dilihat kitchen/admin.</p>';
      html += '<a class="block text-center mt-3 py-3 rounded-2xl bg-khatulistiwa-lime text-khatulistiwa-dark font-black" href="' + trackingLink(t.id) + '">Salin / Bagikan Link Pesanan</a>';
    }
    html += '</div>';
    return html;
  }

  // ---------- render: rewards & profile ----------
  function renderRewards() {
    var m = state.member;
    var redeemable = state.products.filter(function (p) { return Number(p.point_price || 0) > 0 && p.status === "Active"; });
    var html = '<div class="mt-4 bg-khatulistiwa-dark text-white rounded-3xl p-5 text-center shadow">';
    if (m) {
      html += '<p class="text-khatulistiwa-lime font-black text-xs tracking-widest">POIN SAYA</p><p class="font-black text-5xl mt-1">' + Number(m.points || 0) + '</p><p class="text-white/70 text-sm mt-1">1 poin tiap 10 LE • ' + esc(m.name) + '</p>';
    } else {
      html += '<p class="font-black text-xl">Khatulistiwa Rewards</p><p class="text-white/80 text-sm mt-1">Masuk dengan Google untuk mengumpulkan poin tiap pesan dan menukarnya dengan menu.</p><button onclick="App.signInWithGoogle()" class="mt-3 px-5 py-3 rounded-full bg-white text-khatulistiwa-dark font-black text-sm">Masuk dengan Google</button>';
    }
    html += '</div>';
    html += '<h2 class="font-black text-lg mt-6 mb-2">Tukar Poin dengan Menu</h2>';
    html += '<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">' + redeemable.slice(0, 12).map(function (p) { return productCard(p, { badge: Number(p.point_price) + " PTS" }); }).join("") + '</div>';
    return html;
  }
  function renderProfile() {
    var m = state.member;
    var html = '<div class="mt-4 bg-white rounded-3xl shadow p-5">';
    if (m) {
      html += '<div class="flex items-center gap-3">' + (m.avatar_url ? '<img src="' + esc(m.avatar_url) + '" class="w-16 h-16 rounded-full object-cover">' : '<span class="text-4xl">👤</span>') +
        '<div><h2 class="font-black text-lg">' + esc(m.name) + '</h2><p class="text-sm text-stone-500">' + esc(m.email || "") + '</p><p class="text-sm font-bold text-khatulistiwa-dark">⭐ ' + Number(m.points || 0) + ' poin • Total belanja ' + fmt(m.total_purchases || 0) + '</p></div></div>';
      html += '<label class="text-xs font-bold text-stone-500 block mt-4">NO. WHATSAPP</label><input id="pf-phone" class="w-full p-3 rounded-xl border-2 border-khatulistiwa-creamDark outline-none" value="' + esc(m.phone || "") + '">';
      html += '<label class="text-xs font-bold text-stone-500 block mt-3">ALAMAT TERSIMPAN</label><textarea id="pf-address" rows="2" class="w-full p-3 rounded-xl border-2 border-khatulistiwa-creamDark outline-none">' + esc(m.address || "") + '</textarea>';
      html += '<div class="flex gap-2 mt-2"><button onclick="App.shareLocation(true)" class="text-xs font-bold bg-khatulistiwa-lime/50 px-3 py-2 rounded-full">📍 Bagikan Lokasi Saya</button><span id="pf-location" class="text-xs text-stone-500 self-center">' + (m.maps_url ? '<a class="underline" href="' + esc(m.maps_url) + '" target="_blank">📍 Lokasi tersimpan</a>' : "") + '</span></div>';
      html += '<button onclick="App.saveProfile()" class="w-full mt-4 py-3 rounded-2xl bg-khatulistiwa-dark text-white font-black">Simpan Profil</button>';
      html += '<button onclick="App.signOutGoogle()" class="w-full mt-2 py-2 text-sm text-stone-500">Keluar dari akun Google</button>';
    } else {
      html += '<h2 class="font-black text-lg">Profile</h2><p class="text-sm text-stone-500 mt-1">Kamu masih pesan sebagai Guest. Masuk dengan Google untuk menyimpan alamat, lokasi delivery, dan poin.</p>';
      html += '<button onclick="App.signInWithGoogle()" class="w-full mt-4 py-3 rounded-2xl bg-khatulistiwa-dark text-white font-black">Masuk dengan Google</button>';
      html += '<p class="text-xs text-stone-400 mt-3">Guest tetap bisa pesan — isi nama, nomor WA, dan alamat di checkout. Poin hanya tersimpan untuk member.</p>';
    }
    html += '</div>';
    html += '<div class="mt-4 bg-white rounded-3xl shadow p-5"><h3 class="font-black">Untuk Staf</h3><p class="text-sm text-stone-500">POS, Kitchen, Transaksi, dan Data Pelanggan ada di halaman Admin (login PIN).</p><button onclick="App.go(\'admin\')" class="mt-2 px-4 py-2 rounded-full bg-khatulistiwa-dark text-white text-sm font-bold">Buka Admin →</button></div>';
    return html;
  }

  // ---------- checkout ----------
  function openCheckout() {
    if (!state.cart.length) { alert("Keranjang masih kosong."); return; }
    var m = state.member;
    if (m) {
      if (!$("co-name").value) $("co-name").value = m.name || "";
      if (!$("co-phone").value) $("co-phone").value = m.phone || "";
      if (!$("co-address").value) $("co-address").value = m.address || "";
      if (m.latitude && m.longitude) { state.location = { latitude: m.latitude, longitude: m.longitude, mapsUrl: m.maps_url || ("https://maps.google.com/?q=" + m.latitude + "," + m.longitude) }; $("co-location").textContent = "📍 Lokasi tersimpan dipakai"; }
    }
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
    $("co-summary").innerHTML = state.cart.map(function (c) {
      return '<div class="flex justify-between"><span>' + c.qty + ' × ' + esc(c.name) + (c.isRedeemed ? ' <b>(Tukar Poin)</b>' : '') + '</span><b>' + (c.isRedeemed ? Number(c.point_price) * c.qty + ' Pts' : fmt(c.price * c.qty)) + '</b></div>';
    }).join("") +
    '<div class="border-t mt-2 pt-2 space-y-1"><div class="flex justify-between"><span>Subtotal</span><span>' + fmt(t.subtotal) + '</span></div>' +
    '<div class="flex justify-between"><span>Service 5%</span><span>' + fmt(t.service) + '</span></div>' +
    '<div class="flex justify-between"><span>Tax 10%</span><span>' + fmt(t.tax) + '</span></div>' +
    '<div class="flex justify-between font-black"><span>Total</span><span>' + fmt(t.total) + '</span></div>' +
    (t.pointsCost ? '<div class="flex justify-between font-bold text-khatulistiwa-dark"><span>Poin dipakai</span><span>' + t.pointsCost + ' Pts</span></div>' : '') +
    (state.member ? '<div class="flex justify-between text-khatulistiwa-dark"><span>Poin didapat</span><span>+' + t.pointsEarned + ' Pts</span></div>' : '') + '</div>';
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
      if (el) el.innerHTML = '<a class="underline" href="' + state.location.mapsUrl + '" target="_blank">📍 Lokasi tersimpan</a>';
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
    var btn = $("co-accept"); btn.disabled = true; btn.textContent = "Menyimpan pesanan...";
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
      btn.disabled = false; btn.textContent = "Accept & Kirim ke WhatsApp Admin →";
    } else {
      res = await window.supabaseApi.submitOnlineOrder(payload);
      btn.disabled = false; btn.textContent = "Accept & Kirim ke WhatsApp Admin →";
      if (!res || !res.ok) return fail((res && res.message) || "Pesanan gagal disimpan. Coba lagi.");
      txnId = res.data.txnId;
    }
    // 1) order recorded first (Pending) — only now open WhatsApp.
    //    In demo mode the order is NOT recorded; WA is the only copy.
    var text = buildWhatsAppText(txnId, t);
    window.open("https://wa.me/" + ADMIN_PHONE + "?text=" + encodeURIComponent(text), "_blank");
    var demoOrder = state.demoMode ? { id: txnId, items: state.cart.slice(), total: t.total, orderType: state.orderType, paymentMethod: state.payment } : null;
    state.cart = []; saveCart(); renderCartBadge();
    closeCheckout();
    state.view = "order"; state.orderId = txnId; state.trackOrder = null; state.trackError = "";
    state.demoOrder = demoOrder;
    history.replaceState(null, "", baseUrl() + "?view=order&id=" + encodeURIComponent(txnId));
    if (state.demoMode) render();
    else await loadTrack(txnId);
  }

  // ---------- admin (staff PIN) ----------
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
      return '<div class="bg-white rounded-3xl shadow p-4 mb-3"><div class="flex justify-between"><b class="font-mono">' + esc(t.id) + '</b><span class="font-black text-khatulistiwa-dark">' + esc(t.status) + '</span></div>' +
        '<p class="text-sm text-stone-500">' + esc(t.orderType) + ' • ' + fmt(t.total_amount) + ' • ' + esc(t.paymentMethod || "") + '</p>' +
        '<div class="text-sm mt-2">' + items.map(function (it) { return '<div>' + Number(it.qty || 0) + ' × ' + esc(it.name || "") + '</div>'; }).join("") + '</div>' +
        (next ? '<button onclick="App.setTxnStatus(\'' + esc(t.id) + '\', \'' + next + '\')" class="mt-3 px-4 py-2 rounded-full bg-khatulistiwa-dark text-white text-sm font-bold">Ubah ke ' + next + ' →</button>' : '<span class="inline-block mt-3 text-xs font-bold text-green-700 bg-green-100 px-3 py-1 rounded-full">Selesai ✓</span>') +
        '</div>';
    }).join("") : '<p class="text-stone-500 text-center py-8">Belum ada pesanan hari ini.</p>';
  }
  function renderAdmin() {
    if (!state.staffUser) { showStaffLogin(); return '<div class="mt-8 text-center text-stone-500">Masuk sebagai staf untuk membuka Admin.</div>'; }
    var tabs = [["pos", "POS"], ["kitchen", "Kitchen"], ["transactions", "Transaksi"], ["customers", "Pelanggan"]];
    var html = '<div class="mt-4"><div class="flex items-center justify-between"><h2 class="font-black text-xl">Admin — ' + esc(state.staffUser.name || "Staf") + '</h2><button onclick="App.staffLogout()" class="text-xs font-bold bg-white px-3 py-2 rounded-full shadow">Keluar</button></div>';
    html += '<div class="flex gap-2 overflow-x-auto no-scrollbar mt-3">' + tabs.map(function (t) {
      return '<button onclick="App.setAdminTab(\'' + t[0] + '\')" class="px-4 py-2 rounded-full font-bold text-sm whitespace-nowrap ' + (state.adminTab === t[0] ? "bg-khatulistiwa-dark text-white" : "bg-white shadow") + '">' + t[1] + '</button>';
    }).join("") + '</div>';
    if (state.adminTab === "pos") {
      html += '<div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">' + state.products.filter(function (p) { return p.status === "Active"; }).map(function (p) {
        return '<div class="bg-white rounded-3xl overflow-hidden shadow-sm"><img src="' + esc(p.imageUrl || "") + '" class="w-full h-24 object-cover" onerror="this.style.display=\'none\'"><div class="p-3"><p class="font-bold text-sm">' + esc(p.name) + '</p><p class="text-xs text-stone-500">' + fmt(p.price) + '</p><button onclick="App.addToCart(\'' + esc(p.id) + '\')" class="mt-2 w-full py-1.5 rounded-full bg-khatulistiwa-dark text-khatulistiwa-lime text-xs font-black">+ Tambah</button></div></div>';
      }).join("") + '</div>';
      html += '<button onclick="App.toggleCart(true)" class="fixed bottom-24 right-4 z-40 px-5 py-3 rounded-full bg-khatulistiwa-dark text-white font-black shadow-lg">🛒 Keranjang (' + state.cart.reduce(function (a, c) { return a + c.qty; }, 0) + ')</button>';
      html += '<p class="text-xs text-stone-500 mt-4">Checkout POS memakai keranjang yang sama — tombol Checkout di keranjang akan memakai akun staf (bukan WhatsApp online).</p>';
    } else if (state.adminTab === "kitchen") {
      html += '<div id="kitchen-list" class="mt-4"></div><p class="text-xs text-stone-400">Kitchen diperbarui otomatis tiap 15 detik.</p>';
      setTimeout(loadKitchen, 0);
    } else if (state.adminTab === "transactions") {
      html += '<div class="mt-4 space-y-3">' + (state.transactions || []).slice(0, 50).map(function (t) {
        var items = [];
        try { items = typeof t.items === "string" ? JSON.parse(t.items) : (t.items_json || t.items || []); } catch (e) {}
        if (!Array.isArray(items)) items = [];
        return '<div class="bg-white rounded-3xl shadow p-4"><div class="flex justify-between flex-wrap gap-2"><b class="font-mono">' + esc(t.id) + '</b><span class="font-black text-khatulistiwa-dark">' + esc(t.status) + '</span></div>' +
          '<p class="text-sm text-stone-500">' + esc(t.orderType || "") + ' • ' + fmt(t.total_amount) + ' • ' + esc(t.paymentMethod || t.payment_method || "") + ' • ' + esc(String(t.timestamp || "").slice(0, 16).replace("T", " ")) + '</p>' +
          '<p class="text-sm">' + items.map(function (it) { return Number(it.qty || 0) + " × " + esc(it.name || ""); }).join(", ") + '</p>' +
          '<div class="flex gap-2 mt-2 flex-wrap">' + ["Dibuat", "Diantar", "Selesai"].map(function (s) {
            return '<button onclick="App.setTxnStatus(\'' + esc(t.id) + '\', \'' + s + '\')" class="text-xs font-bold px-3 py-1.5 rounded-full bg-khatulistiwa-cream">' + s + '</button>';
          }).join("") + '<a class="text-xs font-bold px-3 py-1.5 rounded-full bg-khatulistiwa-lime/50" href="' + trackingLink(t.id) + '">Link Lacak ↗</a></div></div>';
      }).join("") + '</div>';
    } else if (state.adminTab === "customers") {
      html += '<p class="text-xs text-stone-500 mt-2">Satu baris per pelanggan — member Google dan Guest dengan nomor WA yang sama digabung (cocok nomor WA / email). Data ini sama dengan yang dilihat member di Profile.</p>';
      html += '<div class="mt-3 space-y-3">' + (state.customers || []).map(function (c) {
        return '<div class="bg-white rounded-3xl shadow p-4"><div class="flex items-center gap-3">' + (c.avatar_url ? '<img src="' + esc(c.avatar_url) + '" class="w-10 h-10 rounded-full object-cover">' : '<span class="text-2xl">👤</span>') +
          '<div class="flex-1 min-w-0"><b>' + esc(c.name || "(tanpa nama)") + '</b>' + (c.google_id ? ' <span class="text-[10px] font-black bg-khatulistiwa-lime/60 px-2 py-0.5 rounded-full">MEMBER GOOGLE</span>' : '') +
          '<p class="text-xs text-stone-500 truncate">' + esc(c.phone || "") + (c.email ? ' • ' + esc(c.email) : '') + '</p></div>' +
          '<div class="text-right text-xs"><b class="text-khatulistiwa-dark">⭐ ' + Number(c.points || 0) + ' Pts</b><br><span class="text-stone-500">Belanja ' + fmt(c.total_purchases || 0) + '</span></div></div>' +
          (c.address ? '<p class="text-sm mt-2">📍 ' + esc(c.address) + '</p>' : '') +
          (c.maps_url ? '<a class="text-xs underline text-khatulistiwa-dark" href="' + esc(c.maps_url) + '" target="_blank">Buka lokasi di Google Maps ↗</a>' : '') +
          (c.last_visit ? '<p class="text-xs text-stone-400 mt-1">Terakhir pesan: ' + esc(String(c.last_visit).slice(0, 10)) + '</p>' : '') + '</div>';
      }).join("") + '</div>';
    }
    html += '</div>';
    return html;
  }
  function renderKitchen() {
    var html = '<div class="mt-4"><h2 class="font-black text-xl">Kitchen Display</h2><p class="text-sm text-stone-500">Pesanan hari ini — ubah status, link lacak pelanggan ikut berubah.</p><div id="kitchen-list" class="mt-4"></div></div>';
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
    if (state.loading) { main.innerHTML = '<p class="text-center py-16 text-stone-500">Memuat menu...</p>'; return; }
    if (state.loadError && !state.products.length) {
      main.innerHTML = '<div class="mt-8 bg-white rounded-3xl shadow p-5 text-center"><h2 class="font-black text-lg">Belum terhubung ke Supabase</h2><p class="text-sm text-stone-500 mt-1">' + esc(state.loadError) + '</p><p class="text-sm mt-3">Isi <b>public/config.js</b> dengan Project URL dan anon key (lihat README.md), lalu deploy ulang.</p></div>';
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
    toggleCart: function (open) {
      var d = $("cart-drawer");
      if (open === undefined) open = d.classList.contains("hidden");
      d.classList.toggle("hidden", !open);
      if (open) {
        var t = cartTotals();
        $("cart-items").innerHTML = state.cart.length ? state.cart.map(function (c) {
          return '<div class="bg-white rounded-2xl p-3 flex items-center gap-3"><img src="' + esc(c.imageUrl || "") + '" class="w-12 h-12 rounded-xl object-cover" onerror="this.style.display=\'none\'"><div class="flex-1 min-w-0"><p class="font-bold text-sm truncate">' + esc(c.name) + '</p><p class="text-xs text-stone-500">' + (c.isRedeemed ? Number(c.point_price) * c.qty + ' Pts' : fmt(c.price * c.qty)) + '</p></div><div class="flex items-center gap-2"><button onclick="App.changeQty(\'' + esc(c.key) + '\', -1)" class="w-7 h-7 rounded-full bg-khatulistiwa-cream font-black">−</button><b>' + c.qty + '</b><button onclick="App.changeQty(\'' + esc(c.key) + '\', 1)" class="w-7 h-7 rounded-full bg-khatulistiwa-cream font-black">+</button></div></div>';
        }).join("") : '<p class="text-stone-500 text-center py-8">Keranjang masih kosong.</p>';
        $("cart-totals").innerHTML = '<div class="flex justify-between"><span>Subtotal</span><span>' + fmt(t.subtotal) + '</span></div><div class="flex justify-between"><span>Service 5% + Tax 10%</span><span>' + fmt(t.service + t.tax) + '</span></div><div class="flex justify-between font-black text-base"><span>Total</span><span>' + fmt(t.total) + '</span></div>' + (t.pointsCost ? '<div class="flex justify-between font-bold text-khatulistiwa-dark"><span>Poin dipakai</span><span>' + t.pointsCost + ' Pts</span></div>' : '');
      }
    },
    openCheckout: function () { App.toggleCart(false); openCheckout(); },
    closeCheckout: closeCheckout,
    setOrderType: function (btn) {
      state.orderType = btn.getAttribute("data-v");
      btn.parentElement.querySelectorAll("button").forEach(function (b) { b.className = "py-2 rounded-xl border-2 font-bold text-sm"; });
      btn.className = "py-2 rounded-xl border-2 font-bold text-sm bg-khatulistiwa-dark text-white border-khatulistiwa-dark";
    },
    setPayment: function (btn) {
      state.payment = btn.getAttribute("data-v");
      btn.parentElement.querySelectorAll("button").forEach(function (b) { b.className = "py-2 rounded-xl border-2 font-bold text-sm"; });
      btn.className = "py-2 rounded-xl border-2 font-bold text-sm bg-khatulistiwa-dark text-white border-khatulistiwa-dark";
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
