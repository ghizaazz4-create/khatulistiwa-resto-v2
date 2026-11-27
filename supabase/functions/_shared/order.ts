// Core order creation — a port of submitOrder() from Kode.js, shared by
// submit-online-order (public) and staff-api (staff POS).
// Faithful to the original except for the two documented fixes in
// MIGRATION_NOTES.md §1/§4:
//  (a) loyalty points are updated in customers.points (the original read
//      the points from the wrong sheet column in getAppData() and wrote
//      them to column 5 in submitOrder());
//  (b) subtotal / service_charge / tax are stored in their own columns
//      instead of the grand total being written under the `subtotal` header.
// Prices are still taken from the client-supplied cart items, exactly as
// the original did (it never re-priced from the sheet). Re-pricing from
// the DB (including variation price deltas) is a recommended hardening —
// see MIGRATION_NOTES.md §4 — but is NOT silently introduced here.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSettings } from "./supabase.ts";

export interface OrderItem {
  id: string;
  name?: string;
  price?: number;
  qty?: number;
  point_price?: number;
  isRedeemed?: boolean;
  selectedVariations?: unknown;
  note?: string;
}

export interface OrderInput {
  items: OrderItem[];
  subtotal?: number;
  serviceCharge?: number;
  tax?: number;
  total: number;
  paymentMethod: string;
  orderType: string;
  tableNumber?: string;
  customerId?: string;
  employeeId?: string;
  cashReceived?: number;
  change?: number;
  needsApproval?: boolean;
  notes?: string;
}

export interface LowStockAlert {
  kind: "product" | "ingredient";
  productId?: string;
  ingredientId?: string;
  name: string;
  stock: number;
  threshold: number;
}

export interface CreateOrderResult {
  ok: boolean;
  txnId?: string;
  timestamp?: string;
  alerts?: LowStockAlert[];
  message?: string;
}

type ProductRow = {
  id: string;
  name: string;
  stock: number | null;
  stock_source: string;
  recipe_json: Array<{ id: string; amount: number }>;
};

type IngredientRow = {
  id: string;
  name: string;
  unit: string;
  stock: number;
  min_stock: number;
};

export async function createOrder(
  sb: SupabaseClient,
  order: OrderInput,
): Promise<CreateOrderResult> {
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) return { ok: false, message: "Order has no items." };
  if (!(Number(order.total) >= 0)) return { ok: false, message: "Invalid total." };

  const settings = await getSettings(sb);
  const threshold = Number(settings["low_stock_threshold"] || 5);
  const loyaltyRate = Number(settings["loyalty_rate"] || 0);
  const adminPhone = (settings["whatsapp_admin_phone"] || "").trim();

  const productIds = [...new Set(items.map((i) => String(i.id)))];
  const { data: products, error: prodErr } = await sb
    .from("products")
    .select("id, name, stock, stock_source, recipe_json")
    .in("id", productIds);
  if (prodErr) return { ok: false, message: prodErr.message };
  const byId = new Map<string, ProductRow>(
    ((products ?? []) as ProductRow[]).map((p) => [String(p.id), p]),
  );

  // 1. Ingredient-stock validation (submitOrder: validate BEFORE saving,
  //    so ingredients never go negative). Regular-stock products are NOT
  //    validated up front in the original — only deducted — and that is kept.
  const required = new Map<string, { amount: number; productName: string }>();
  for (const item of items) {
    const p = byId.get(String(item.id));
    if (!p) continue; // original silently skipped unknown products here
    if (p.stock_source === "Ingredients" && Array.isArray(p.recipe_json)) {
      for (const ing of p.recipe_json) {
        const cur = required.get(String(ing.id)) ?? { amount: 0, productName: p.name };
        cur.amount += Number(ing.amount || 0) * Number(item.qty || 0);
        required.set(String(ing.id), cur);
      }
    }
  }
  if (required.size > 0) {
    const { data: ings } = await sb
      .from("ingredients")
      .select("id, name, unit, stock, min_stock")
      .in("id", [...required.keys()]);
    const ingById = new Map<string, IngredientRow>(
      ((ings ?? []) as IngredientRow[]).map((i) => [String(i.id), i]),
    );
    for (const [ingId, need] of required) {
      const row = ingById.get(ingId);
      const available = row ? Number(row.stock || 0) : 0;
      if (available < need.amount) {
        return {
          ok: false,
          message: `Insufficient ingredient stock for ${need.productName}. Missing: ${row ? row.name : "Unknown Ingredient"}. Available: ${available}, Required: ${need.amount}.`,
        };
      }
    }
  }

  // 2. Transaction id (YYMMDD-XXXX, random suffix, via the advisory-locked SQL function).
  const { data: txnId, error: idErr } = await sb.rpc("next_transaction_id");
  if (idErr || !txnId) {
    return { ok: false, message: idErr?.message ?? "Could not generate transaction id." };
  }
  const timestamp = new Date().toISOString();
  const status = order.needsApproval ? "Awaiting Approval" : "Pending";

  const { error: insErr } = await sb.from("transactions").insert({
    id: txnId,
    timestamp,
    items_json: items,
    subtotal: order.subtotal ?? null,
    service_charge: order.serviceCharge ?? null,
    tax: order.tax ?? null,
    total_amount: Number(order.total),
    payment_method: order.paymentMethod || "Cash",
    order_type: order.orderType || "Take Away",
    table_number: order.tableNumber || "N/A",
    customer_id: order.customerId && order.customerId !== "Guest" ? order.customerId : null,
    status,
    employee_id: order.employeeId || "System",
    completed_at: null,
    cash_received: Number(order.cashReceived || 0),
    change: Number(order.change || 0),
    needs_approval: Boolean(order.needsApproval),
    notes: order.notes ?? null,
  });
  if (insErr) return { ok: false, message: insErr.message };

  // 3. Loyalty points + total_purchases (submitOrder, fixed column — §1).
  if (order.customerId && order.customerId !== "Guest") {
    const { data: cust } = await sb
      .from("customers")
      .select("id, points, total_purchases")
      .eq("id", order.customerId)
      .maybeSingle();
    if (cust) {
      const earned = loyaltyRate > 0 ? Math.floor(Number(order.total) / loyaltyRate) : 0;
      let spent = 0;
      for (const item of items) {
        if (item.isRedeemed) spent += Number(item.point_price || 0) * Number(item.qty || 0);
      }
      await sb.from("customers").update({
        points: Math.max(0, Number(cust.points || 0) + earned - spent),
        total_purchases: Number(cust.total_purchases || 0) + Number(order.total),
      }).eq("id", order.customerId);
    }
  }

  // 4. Stock deduction + low-stock alerts (submitOrder).
  const alerts: LowStockAlert[] = [];
  const alertedIngredients = new Set<string>();
  for (const item of items) {
    const p = byId.get(String(item.id));
    if (!p) continue;
    if (p.stock_source === "Ingredients" && Array.isArray(p.recipe_json)) {
      for (const ing of p.recipe_json) {
        const { data: row } = await sb.from("ingredients")
          .select("id, name, unit, stock, min_stock")
          .eq("id", String(ing.id)).maybeSingle();
        if (!row) continue;
        const newStock = Number(row.stock || 0) - Number(ing.amount || 0) * Number(item.qty || 0);
        await sb.from("ingredients").update({ stock: newStock }).eq("id", row.id);
        if (newStock <= Number(row.min_stock || 0) && !alertedIngredients.has(row.id)) {
          alertedIngredients.add(row.id);
          alerts.push({ kind: "ingredient", ingredientId: row.id, name: row.name, stock: newStock, threshold: Number(row.min_stock || 0) });
        }
      }
    } else if (p.stock !== null && p.stock !== undefined) {
      const newStock = Number(p.stock) - Number(item.qty || 0);
      await sb.from("products").update({ stock: newStock }).eq("id", p.id);
      // Original checks the PRE-deduction stock against the threshold for
      // the notification; the alert below uses the new stock, which is the
      // value the admin actually needs. See MIGRATION_NOTES.md §4.
      if (newStock <= threshold) {
        alerts.push({ kind: "product", productId: p.id, name: p.name, stock: newStock, threshold });
      }
    }
  }

  // 5. Low-stock WhatsApp alerts (best-effort, like the original — failures
  //    never fail the order). Email alerts (GmailApp) have no Supabase
  //    equivalent; the alerts[] in this response are the replacement hook
  //    for a future mail provider (Resend/SMTP). See README.md.
  if (adminPhone && settings["whatsapp_api_url"] && alerts.length > 0) {
    for (const a of alerts) {
      try {
        const template = a.kind === "product"
          ? (settings["whatsapp_low_stock_template"] || "*LOW STOCK: {product_name}*")
          : (settings["whatsapp_ingredient_low_stock_template"] || "*INGREDIENT LOW STOCK: {ingredient_name}*");
        const message = template
          .replace(/{restaurant_name}/g, settings["restaurant_name"] || "")
          .replace(/{product_name}/g, a.name)
          .replace(/{ingredient_name}/g, a.name)
          .replace(/{stock}/g, String(a.stock))
          .replace(/{threshold}/g, String(a.threshold))
          .replace(/{min_stock}/g, String(a.threshold));
        const url = settings["whatsapp_api_url"]
          .replace(/{phone}/g, encodeURIComponent(adminPhone))
          .replace(/{message}/g, encodeURIComponent(message));
        await fetch(url, { method: "GET" });
      } catch { /* alerts must never fail an order */ }
    }
  }

  return { ok: true, txnId, timestamp, alerts };
}
