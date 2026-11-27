// POST /functions/v1/staff-api
// Authenticated staff API — replaces every remaining server function in
// Kode.js that the POS uses after login: getAppData, getTransactions,
// getStaffLogs, saveRecord, deleteRecord, updateTransactionStatus,
// voidTransaction, verifyPin, recordStaffLog, updateSetting,
// updateSettingsBulk, submitOrder (staff POS), sendWhatsAppReceipt,
// testWhatsAppMessage, uploadToDrive.
// AUTH: every action except verifyPin / verifyKitchenPin requires a staff
// session token (X-Staff-Session header or `sessionToken` in the body).
// The token is issued by verifyPin() after a SHA-256 PIN check against
// employees.pin_hash — the original login model, preserved (see
// _shared/session.ts). It is NOT Supabase Auth; see MIGRATION_NOTES.md §5.
// The SERVICE_ROLE key is used inside this function only, so RLS on the
// tables does not block staff reads/writes.
// Deploy: supabase functions deploy staff-api
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STAFF_SESSION_SECRET
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleOptions, json, readJson } from "../_shared/cors.ts";
import { serviceClient, getSettings } from "../_shared/supabase.ts";
import { verifySession, signSession, sha256Hex, type StaffSession } from "../_shared/session.ts";
import { normalizeForWhatsApp, normalizePhoneDigits } from "../_shared/phone.ts";
import { createOrder, type OrderInput } from "../_shared/order.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Settings keys that are NEVER sent to the browser (original getAppData()
// sent them to every visitor — a leak this migration closes). PINs can be
// SET through updateSettingsBulk (empty = keep the current value) but are
// never read back. whatsapp_api_url is only used server-side.
const SECRET_SETTINGS = new Set(["void_pin", "kitchen_pin", "whatsapp_api_url"]);

const SHEET_TO_TABLE: Record<string, string> = {
  Products: "products",
  Categories: "categories",
  Customers: "customers",
  Employees: "employees",
  Staff: "staff",
  Ingredients: "ingredients",
  Transactions: "transactions",
  StaffLogs: "staff_logs",
};

// Frontend record keys (camelCase / legacy) -> DB columns.
const KEY_MAP: Record<string, string> = {
  imageUrl: "image_url",
  point_price: "point_price",
  stock_source: "stock_source",
  recipe: "recipe_json",
  recipe_json: "recipe_json",
  variations: "variations_json",
  variations_json: "variations_json",
  product_count: "product_count",
  total_purchases: "total_purchases",
  last_visit: "last_visit",
  created_at: "created_at",
  min_stock: "min_stock",
  last_active: "last_active",
  items_json: "items_json",
  total_amount: "total_amount",
  payment_method: "payment_method",
  order_type: "order_type",
  table_number: "table_number",
  customer_id: "customer_id",
  employee_id: "employee_id",
  completed_at: "completed_at",
  cash_received: "cash_received",
};

function mapRecord(sheetName: string, record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === "pin_hash") continue; // never accept a hash from the client
    if (k === "pin") continue; // handled separately for Employees
    const col = KEY_MAP[k] ?? k;
    let val: unknown = v;
    if (typeof val === "string") val = val.replace(/^'/, ""); // drop the Sheet leading-quote hack
    if ((col === "stock" || col === "cost") && val === "") val = null;
    out[col] = val;
  }
  if (sheetName === "Products" && out["recipe_json"] !== undefined && !out["recipe_json"]) {
    out["recipe_json"] = [];
  }
  if (sheetName === "Categories" && out["variations_json"] !== undefined && !out["variations_json"]) {
    out["variations_json"] = [];
  }
  return out;
}

function txnShape(t: Record<string, unknown>) {
  return {
    id: t.id,
    timestamp: t.timestamp,
    items: typeof t.items_json === "string" ? t.items_json : JSON.stringify(t.items_json ?? []),
    total_amount: t.total_amount,
    paymentMethod: t.payment_method,
    orderType: t.order_type,
    tableNumber: t.table_number,
    customer_id: t.customer_id ?? "Guest",
    status: t.status ?? "Pending",
    employee_id: t.employee_id ?? "",
    completed_at: t.completed_at ?? null,
    cash_received: t.cash_received ?? 0,
    change: t.change ?? 0,
  };
}

async function getAppData(sb: SupabaseClient) {
  const [products, ingredients, categories, customers, employees, transactions, settings] =
    await Promise.all([
      sb.from("products").select("*").order("name"),
      sb.from("ingredients").select("*").order("name"),
      sb.from("categories").select("*").order("name"),
      sb.from("customers").select("*").order("name"),
      sb.from("employees").select("id, name, role, image_url").order("name"),
      sb.from("transactions").select("*").order("timestamp", { ascending: false }).limit(500),
      sb.from("settings").select("key, value"),
    ]);
  for (const r of [products, ingredients, categories, customers, employees, transactions, settings]) {
    if (r.error) throw new Error(r.error.message);
  }
  const settingsObj: Record<string, string> = {};
  for (const row of settings.data ?? []) {
    if (!SECRET_SETTINGS.has(String(row.key))) {
      settingsObj[String(row.key).trim()] = String(row.value ?? "");
    }
  }
  return {
    ok: true,
    data: {
      // Column mapping is the CORRECTED one (see MIGRATION_NOTES.md §1):
      // imageUrl/status/stock/point_price/recipe now come from their own
      // columns instead of the shifted getAppData() positions.
      products: (products.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id, sku: r.sku, name: r.name, category: r.category, price: r.price,
        imageUrl: r.image_url, status: r.status,
        stock: r.stock === null || r.stock === undefined ? null : Number(r.stock),
        point_price: Number(r.point_price || 0),
        stock_source: r.stock_source || "Regular",
        recipe: r.recipe_json ?? [],
      })),
      ingredients: (ingredients.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id, name: r.name, unit: r.unit,
        stock: Number(r.stock || 0), min_stock: Number(r.min_stock || 0),
      })),
      categories: (categories.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id, name: r.name, description: r.description ?? "",
        product_count: Number(r.product_count || 0),
        variations: r.variations_json ?? [],
      })),
      // v2: extra synced member data (Google login + saved delivery
      // location) so the admin Customers view shows the same record the
      // member sees in Profile — one source of truth, no second copy.
      customers: (customers.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id, name: r.name,
        phone: String(r.phone ?? "").replace(/^'/, ""),
        email: r.email ?? "", address: r.address ?? "",
        points: Number(r.points || 0),
        total_purchases: Number(r.total_purchases || 0),
        last_visit: r.last_visit ?? null, created_at: r.created_at ?? null,
        google_id: r.google_id ?? "", avatar_url: r.avatar_url ?? "",
        latitude: r.latitude ?? null, longitude: r.longitude ?? null,
        maps_url: r.maps_url ?? "",
      })),
      employees: (employees.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id, name: r.name, role: r.role, imageUrl: r.image_url ?? "",
      })),
      transactions: (transactions.data ?? []).map((r: Record<string, unknown>) => txnShape(r)),
      settings: settingsObj,
    },
  };
}

async function sendWhatsApp(
  sb: SupabaseClient, settings: Record<string, string>,
  phone: string, message: string,
): Promise<{ ok: boolean; message?: string }> {
  const apiUrlTemplate = settings["whatsapp_api_url"] || "";
  if (!apiUrlTemplate) return { ok: false, message: "WhatsApp API URL is not configured in settings." };
  const countryCode = settings["default_country_code"] || "62";
  const cleaned = normalizeForWhatsApp(phone, countryCode);
  if (!cleaned) return { ok: false, message: "Please provide a phone number." };
  const url = apiUrlTemplate
    .replace(/{phone}/g, encodeURIComponent(cleaned))
    .replace(/{message}/g, encodeURIComponent(message));
  await fetch(url, { method: "GET" });
  return { ok: true };
}

const ALLOWED_STATUSES = [
  "Pending", "Awaiting Approval", "Preparing", "Dibuat",
  "Completed", "Selesai", "Diantar", "Void",
];

serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return json({ ok: false, message: "POST only." }, 405);

  try {
    const body = await readJson(req);
    const action = String(body.action ?? "");
    const sb = serviceClient();
    const token = (req.headers.get("x-staff-session") ?? String(body.sessionToken ?? "")) || "";

    // ---- Public (no session) actions -------------------------------------
    if (action === "verifyPin") {
      const employeeId = String(body.employeeId ?? "");
      const pin = String(body.pin ?? "");
      const { data: row } = await sb.from("employees")
        .select("id, name, role, pin_hash").eq("id", employeeId).maybeSingle();
      if (!row) return json({ ok: false, message: "Employee not found" }, 404);
      const hashed = await sha256Hex(pin);
      if (String(row.pin_hash) !== hashed) {
        return json({ ok: false, message: "Incorrect PIN" }, 401);
      }
      const sessionToken = await signSession({
        employeeId: String(row.id), name: String(row.name),
        role: String(row.role), scope: "staff",
      });
      // Admin Demo keeps the same server-side treatment as the original
      // (verifyPin returned ok for it); role checks stay in the frontend.
      return json({ ok: true, data: { id: row.id, name: row.name, role: row.role }, sessionToken });
    }

    if (action === "verifyKitchenPin") {
      const settings = await getSettings(sb);
      const pin = String(body.pin ?? "");
      if (!settings["kitchen_pin"] || pin !== String(settings["kitchen_pin"])) {
        return json({ ok: false, message: "Incorrect Kitchen PIN" }, 401);
      }
      const sessionToken = await signSession({
        employeeId: "kitchen-display", name: "Kitchen Display",
        role: "Display", scope: "display",
      });
      return json({ ok: true, sessionToken });
    }

    // ---- All other actions require a staff session -----------------------
    const session: StaffSession | null = await verifySession(token);
    if (!session || session.scope !== "staff") {
      return json({ ok: false, message: "Staff session required. Please log in again." }, 401);
    }

    switch (action) {
      case "getAppData":
        return json(await getAppData(sb));

      case "getTransactions": {
        const { data, error } = await sb.from("transactions").select("*")
          .order("timestamp", { ascending: false }).limit(1000);
        if (error) return json({ ok: false, message: error.message }, 500);
        return json({ ok: true, data: (data ?? []).map((r: Record<string, unknown>) => txnShape(r)) });
      }

      case "getStaffLogs": {
        const { data, error } = await sb.from("staff_logs").select("*")
          .order("timestamp", { ascending: false }).limit(500);
        if (error) return json({ ok: false, message: error.message }, 500);
        return json({ ok: true, data: data ?? [] });
      }

      case "recordStaffLog": {
        const employeeId = String(body.employeeId ?? session.employeeId);
        const { data: emp } = await sb.from("employees").select("name").eq("id", employeeId).maybeSingle();
        const { error } = await sb.from("staff_logs").insert({
          id: `LOG-${Date.now()}`,
          employee_id: employeeId,
          employee_name: emp?.name ?? "Unknown",
          timestamp: new Date().toISOString(),
          action: String(body.action_name ?? body.logAction ?? ""),
        });
        if (error) return json({ ok: false, message: error.message }, 500);
        return json({ ok: true });
      }

      case "submitOrder": {
        const order = body.order as OrderInput;
        if (!order) return json({ ok: false, message: "Missing order." }, 400);
        order.employeeId = order.employeeId || session.employeeId;
        const res = await createOrder(sb, order);
        if (!res.ok) return json({ ok: false, message: res.message }, 400);
        return json({ ok: true, data: { txnId: res.txnId, timestamp: res.timestamp, alerts: res.alerts ?? [] } });
      }

      case "updateTransactionStatus": {
        const txnId = String(body.txnId ?? "");
        const status = String(body.status ?? "");
        if (!ALLOWED_STATUSES.includes(status)) {
          return json({ ok: false, message: `Invalid status: ${status}` }, 400);
        }
        const { data, error } = await sb.from("transactions")
          .update({ status }).eq("id", txnId).select("id").maybeSingle();
        if (error) return json({ ok: false, message: error.message }, 500);
        if (!data) return json({ ok: false, message: "Transaction not found" }, 404);
        return json({ ok: true, data: { status } });
      }

      case "voidTransaction": {
        const txnId = String(body.txnId ?? "");
        const settings = await getSettings(sb);
        if (String(body.pin ?? "") !== String(settings["void_pin"] ?? "")) {
          return json({ ok: false, message: "Invalid Void Authorization PIN" }, 401);
        }
        const { data: txn } = await sb.from("transactions")
          .select("items_json").eq("id", txnId).maybeSingle();
        if (!txn) return json({ ok: false, message: "Transaction not found" }, 404);
        // Restock Regular products (the original restocked only Regular
        // stock on void; ingredient restock was not implemented there).
        try {
          const items = (txn.items_json ?? []) as Array<{ id: string; qty: number }>;
          for (const item of items) {
            const { data: p } = await sb.from("products")
              .select("stock, stock_source").eq("id", String(item.id)).maybeSingle();
            if (p && p.stock !== null && p.stock !== undefined && p.stock_source !== "Ingredients") {
              await sb.from("products").update({ stock: Number(p.stock) + Number(item.qty || 0) }).eq("id", String(item.id));
            }
          }
        } catch { /* restock failure must not block the void */ }
        const { error } = await sb.from("transactions").delete().eq("id", txnId);
        if (error) return json({ ok: false, message: error.message }, 500);
        return json({ ok: true });
      }

      case "saveRecord": {
        const sheetName = String(body.sheetName ?? "");
        const record = (body.record ?? {}) as Record<string, unknown>;
        const table = SHEET_TO_TABLE[sheetName];
        if (!table) return json({ ok: false, message: `Unknown sheet: ${sheetName}` }, 400);
        if (!record.id) return json({ ok: false, message: "Record needs an id." }, 400);
        const row = mapRecord(sheetName, record);
        if (sheetName === "Employees") {
          if (record.pin && String(record.pin).trim() !== "") {
            row["pin_hash"] = await sha256Hex(String(record.pin));
          } else {
            delete row["pin_hash"]; // keep the existing hash on update
          }
        }
        if (sheetName === "Staff" && record.pin && String(record.pin).trim() !== "") {
          row["pin_hash"] = await sha256Hex(String(record.pin));
        }
        const { error } = await sb.from(table).upsert(row, { onConflict: "id" });
        if (error) return json({ ok: false, message: error.message }, 500);
        return json({ ok: true, data: record });
      }

      case "deleteRecord": {
        const sheetName = String(body.sheetName ?? "");
        const table = SHEET_TO_TABLE[sheetName];
        if (!table) return json({ ok: false, message: `Unknown sheet: ${sheetName}` }, 400);
        const { error } = await sb.from(table).delete().eq("id", String(body.id ?? ""));
        if (error) return json({ ok: false, message: error.message }, 500);
        return json({ ok: true });
      }

      case "updateSetting":
      case "updateSettingsBulk": {
        const map: Record<string, unknown> = action === "updateSetting"
          ? { [String(body.key ?? "")]: body.value }
          : ((body.settingsMap ?? {}) as Record<string, unknown>);
        for (const [key, raw] of Object.entries(map)) {
          if (!key) continue;
          // Empty PIN = keep the current value (the frontend can no longer
          // read PINs back, so a blank field means "unchanged").
          if ((key === "void_pin" || key === "kitchen_pin") && String(raw ?? "").trim() === "") continue;
          const value = String(raw ?? "").replace(/^'/, ""); // store clean, no leading quote
          await sb.from("settings").upsert({ key, value }, { onConflict: "key" });
        }
        return json({ ok: true });
      }

      case "sendWhatsAppReceipt": {
        const order = (body.order ?? {}) as Record<string, unknown>;
        const txnId = String(body.txnId ?? "");
        const settings = await getSettings(sb);
        if (!settings["whatsapp_api_url"] || !order.customerId || order.customerId === "Guest") {
          return json({ ok: false, message: "WhatsApp not configured or Guest order" });
        }
        const { data: customer } = await sb.from("customers")
          .select("phone").eq("id", String(order.customerId)).maybeSingle();
        if (!customer || !customer.phone) {
          return json({ ok: false, message: "Customer phone not found" });
        }
        const currency = settings["currency"] || "Rp";
        const items = (order.items ?? []) as Array<{ name: string; qty: number; price: number }>;
        const itemsText = items.map((i) => `• ${i.name} (${i.qty}x) @ ${currency}${Math.round(Number(i.price || 0)).toLocaleString()}`).join("\n");
        const message = (settings["whatsapp_template"] || "*RECEIPT: {restaurant_name}*\nOrder ID: {order_id}\n{items}\n*TOTAL: {total}*")
          .replace(/{restaurant_name}/g, settings["restaurant_name"] || "Bento Bistro")
          .replace(/{order_id}/g, txnId)
          .replace(/{date}/g, new Date().toLocaleString())
          .replace(/{order_type}/g, String(order.orderType ?? ""))
          .replace(/{items}/g, itemsText)
          .replace(/{total}/g, currency + Math.round(Number(order.total || 0)).toLocaleString())
          .replace(/{footer}/g, settings["receipt_footer"] || "Thank you!");
        return json(await sendWhatsApp(sb, settings, String(customer.phone), message));
      }

      case "testWhatsAppMessage": {
        const settings = await getSettings(sb);
        const res = await sendWhatsApp(
          sb, settings,
          String(body.phone ?? ""),
          String(body.message ?? "Test message from Bento POS"),
        );
        return json(res);
      }

      case "upload": {
        // Replaces uploadToDrive(): stores the file in the public "assets"
        // Storage bucket instead of a Google Drive folder, and returns a
        // public Supabase Storage URL instead of an lh3.googleusercontent
        // link. Existing Drive image URLs in the data keep working as-is.
        const base64Data = String(body.base64Data ?? "");
        const filename = String(body.filename ?? `asset_${Date.now()}`);
        const m = base64Data.match(/^data:(.*?);base64,(.*)$/);
        if (!m) return json({ ok: false, message: "Invalid base64 data URL." }, 400);
        const contentType = m[1];
        const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
        const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");
        const path = `${Date.now()}_${safeName}`;
        const { error } = await sb.storage.from("assets").upload(path, bytes, { contentType, upsert: false });
        if (error) return json({ ok: false, message: error.message }, 500);
        const { data } = sb.storage.from("assets").getPublicUrl(path);
        return json({ ok: true, url: data.publicUrl });
      }

      default:
        return json({ ok: false, message: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    return json({ ok: false, message: String(e) }, 500);
  }
});
