// supabaseApi.js — the single replacement for the old Apps Script RPC.
// Every server call the original Index.html made through
// The old <fn>(...) server calls are now supabaseApi.<fn>(...) returning a
// Promise that resolves to the SAME shape the original returned:
//   { ok: true, data: ... }  /  { ok: false, message: "..." }
// To avoid rewriting ~40 call sites in a 7,700-line file, this file also
// exposes supabaseApi.run — a chaining shim with the same
// .withSuccessHandler() / .withFailureHandler() / .<fn>() shape the old
// code used. The adapted index.html only changes `the old RPC object` to
// `supabaseApi.run`; all the handler code is untouched. New code should
// call supabaseApi.<fn>() directly and await it.
//
// Routing (see README.md "Security model"):
//  - Public reads (menu, categories, public settings): anon client + RLS.
//  - Online order / customer lookup / upsert: public Edge Functions.
//  - Display views (kitchen/customer/queue): display-transactions function
//    (today's orders, no customer/employee data).
//  - Everything staff-only: staff-api Edge Function, with the staff session
//    token issued by verifyPin() (PIN model preserved, see
//    supabase/functions/_shared/session.ts). The token lives in
//    localStorage next to the original 'bento_session_user' entry and
//    expires after 12h server-side.
(function () {
  "use strict";

  var STAFF_TOKEN_KEY = "supabase_staff_session";
  var DISPLAY_TOKEN_KEY = "supabase_display_session";

  function cfg() { return window.SUPABASE_CONFIG || {}; }
  function functionsBase() {
    return String(cfg().url || "").replace(/\/$/, "") + "/functions/v1";
  }
  function anonHeaders(extra) {
    var h = {
      "Content-Type": "application/json",
      apikey: cfg().anonKey || "",
      Authorization: "Bearer " + (cfg().anonKey || ""),
    };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }

  async function callFunction(name, body, extraHeaders) {
    if (!window.SUPABASE_CONFIGURED) {
      return { ok: false, message: "Supabase is not configured yet (see public/config.js)." };
    }
    var res = await fetch(functionsBase() + "/" + name, {
      method: "POST",
      headers: anonHeaders(extraHeaders),
      body: JSON.stringify(body || {}),
    });
    var data;
    try { data = await res.json(); } catch (e) { data = { ok: false, message: "Bad response from " + name }; }
    if (!res.ok && data && data.ok === undefined) {
      return { ok: false, message: data.message || ("HTTP " + res.status + " from " + name) };
    }
    return data;
  }

  function staffToken() { try { return localStorage.getItem(STAFF_TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function displayToken() { try { return localStorage.getItem(DISPLAY_TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function setStaffToken(t) { try { if (t) localStorage.setItem(STAFF_TOKEN_KEY, t); else localStorage.removeItem(STAFF_TOKEN_KEY); } catch (e) {} }
  function setDisplayToken(t) { try { if (t) localStorage.setItem(DISPLAY_TOKEN_KEY, t); else localStorage.removeItem(DISPLAY_TOKEN_KEY); } catch (e) {} }

  function staffCall(action, body) {
    var payload = Object.assign({ action: action, sessionToken: staffToken() }, body || {});
    return callFunction("staff-api", payload, { "x-staff-session": staffToken() });
  }

  // Shape helpers — the frontend expects the getAppData() shape from
  // Kode.js, with the CORRECTED column mapping (see MIGRATION_NOTES.md §1).
  function mapProducts(rows) {
    return (rows || []).map(function (r) {
      return {
        id: r.id, sku: r.sku, name: r.name, category: r.category, price: r.price,
        imageUrl: r.image_url, status: r.status,
        stock: r.stock === null || r.stock === undefined ? null : Number(r.stock),
        point_price: Number(r.point_price || 0),
        stock_source: r.stock_source || "Regular",
        recipe: r.recipe_json || [],
      };
    });
  }
  function mapSettings(rows) {
    var out = {};
    (rows || []).forEach(function (r) { out[String(r.key).trim()] = String(r.value == null ? "" : r.value); });
    return out;
  }

  var api = {
    // -- session -----------------------------------------------------------
    clearSession: function () { setStaffToken(""); setDisplayToken(""); try { localStorage.removeItem("bento_session_user"); } catch (e) {} },

    // -- bootstrap ---------------------------------------------------------
    // Staff (token present): full data via staff-api, exactly like the
    // original getAppData(). Public (online/display views): menu +
    // categories + public settings via the anon client; transactions,
    // customers and employees are empty by design (RLS denies anon).
    getAppData: async function () {
      if (staffToken()) {
        var staff = await staffCall("getAppData", {});
        if (staff && staff.ok) return staff;
        // Token expired/invalid: fall through to the public subset so the
        // online view still works; the POS will ask for login again.
        setStaffToken("");
      }
      var sb = window.supabaseClient;
      if (!sb) return { ok: false, message: "Supabase is not configured yet." };
      var products = await sb.from("products").select("*").eq("status", "Active").order("name");
      var categories = await sb.from("categories").select("*").order("name");
      var settings = await sb.from("settings").select("key, value");
      if (products.error || categories.error || settings.error) {
        return { ok: false, message: (products.error || categories.error || settings.error).message };
      }
      return {
        ok: true,
        data: {
          products: mapProducts(products.data),
          ingredients: [],
          categories: (categories.data || []).map(function (r) {
            return { id: r.id, name: r.name, description: r.description || "", product_count: Number(r.product_count || 0), variations: r.variations_json || [] };
          }),
          customers: [],
          employees: [],
          transactions: [],
          settings: mapSettings(settings.data),
        },
      };
    },

    getTransactions: async function () {
      if (staffToken()) return staffCall("getTransactions", {});
      // Display views: today's orders only, no customer/employee data.
      return callFunction("display-transactions", {});
    },

    getStaffLogs: function () { return staffCall("getStaffLogs", {}); },

    // -- auth (PIN model preserved) ---------------------------------------
    verifyPin: async function (employeeId, pin) {
      var res = await callFunction("staff-api", { action: "verifyPin", employeeId: employeeId, pin: pin });
      if (res && res.ok && res.sessionToken) setStaffToken(res.sessionToken);
      return res;
    },

    verifyKitchenPin: async function (pin) {
      var res = await callFunction("staff-api", { action: "verifyKitchenPin", pin: pin });
      if (res && res.ok && res.sessionToken) setDisplayToken(res.sessionToken);
      return res;
    },

    recordStaffLog: function (employeeId, action) {
      return staffCall("recordStaffLog", { employeeId: employeeId, logAction: action });
    },

    // -- orders ------------------------------------------------------------
    // Staff POS (session present): staff-api submitOrder, same logic as
    // Kode.js submitOrder(). Without a session this is refused — the
    // online flow must use submitOnlineOrder() below instead.
    submitOrder: function (order) {
      if (!staffToken()) {
        return Promise.resolve({ ok: false, message: "Staff session required. Please log in again." });
      }
      return staffCall("submitOrder", { order: order });
    },

    // Online order: ONE call to submit-online-order (upsert customer +
    // record Transaction Pending + stock validation). The client opens
    // wa.me only after this resolves ok — see submitOnlineOrder() in
    // index.html. Body: {phone, name, address, orderType, paymentMethod,
    // transferCurrency, notes, items, subtotal, serviceCharge, tax, total}
    submitOnlineOrder: function (payload) {
      return callFunction("submit-online-order", payload || {});
    },

    updateTransactionStatus: function (txnId, status) {
      return staffCall("updateTransactionStatus", { txnId: txnId, status: status });
    },

    voidTransaction: function (txnId, pin) {
      return staffCall("voidTransaction", { txnId: txnId, pin: pin });
    },

    // -- customers (online form) ------------------------------------------
    lookupCustomerByPhone: function (phone) {
      return callFunction("lookup-customer", { phone: phone });
    },
    upsertCustomerByPhone: function (phone, name, address) {
      return callFunction("upsert-customer", { phone: phone, name: name, address: address });
    },

    // -- generic CRUD (Settings / Products / Categories / Customers /
    //    Employees / Ingredients) — sheetName is the ORIGINAL sheet name.
    saveRecord: function (sheetName, record) {
      return staffCall("saveRecord", { sheetName: sheetName, record: record });
    },
    deleteRecord: function (sheetName, id) {
      return staffCall("deleteRecord", { sheetName: sheetName, id: id });
    },

    // -- settings ----------------------------------------------------------
    updateSetting: function (key, value) {
      return staffCall("updateSetting", { key: key, value: value });
    },
    updateSettingsBulk: function (settingsMap) {
      return staffCall("updateSettingsBulk", { settingsMap: settingsMap });
    },

    // -- WhatsApp (server-side, uses settings.whatsapp_api_url) -----------
    sendWhatsAppReceipt: function (order, txnId) {
      return staffCall("sendWhatsAppReceipt", { order: order, txnId: txnId });
    },
    testWhatsAppMessage: function (phone, message) {
      return staffCall("testWhatsAppMessage", { phone: phone, message: message });
    },

    // -- v2: order tracking + member sync ---------------------------------
    // trackOrder: public, looks one transaction up by id (YYMMDD-XXX).
    trackOrder: function (txnId) {
      return callFunction("track-order", { txnId: txnId });
    },
    // memberSync: JWT-verified (verify_jwt = true). Sends the member's
    // current Auth session so the function can only sync their own row.
    memberSync: async function (extra) {
      var sb = window.supabaseClient;
      if (!sb) return { ok: false, message: "Supabase is not configured yet." };
      var session = await sb.auth.getSession();
      var token = session && session.data && session.data.session ? session.data.session.access_token : "";
      if (!token) return { ok: false, message: "Not signed in." };
      return callFunction("member-sync", extra || {}, { Authorization: "Bearer " + token });
    },

    // -- uploads (Supabase Storage "assets" bucket, replaces Drive) -------
    uploadToDrive: function (base64Data, filename) {
      return staffCall("upload", { base64Data: base64Data, filename: filename });
    },
  };

  // -- legacy RPC compatibility shim ---------------------------------
  // The adapted index.html calls supabaseApi.run.withSuccessHandler(fn)
  // .withFailureHandler(fn).<method>(...). Each access to .run returns a
  // FRESH shim, so handlers from one call can never leak into the next.
  function makeRunShim2() {
    var handlers = { success: null, failure: null };
    var proxy = new Proxy({}, {
      get: function (_target, prop) {
        if (prop === "withSuccessHandler") {
          return function (fn) { handlers.success = fn; return proxy; };
        }
        if (prop === "withFailureHandler") {
          return function (fn) { handlers.failure = fn; return proxy; };
        }
        if (typeof prop === "string") {
          return function () {
            var args = Array.prototype.slice.call(arguments);
            var p = Promise.resolve().then(function () {
              var fn = api[prop];
              if (typeof fn !== "function") throw new Error("supabaseApi." + prop + " is not implemented");
              return fn.apply(api, args);
            });
            if (handlers.success) p.then(handlers.success);
            if (handlers.failure) p.catch(handlers.failure);
            else p.catch(function () {});
            return p;
          };
        }
        return undefined;
      },
    });
    return proxy;
  }

  Object.defineProperty(api, "run", {
    get: function () { return makeRunShim2(); },
    configurable: true,
  });

  window.supabaseApi = api;
})();
