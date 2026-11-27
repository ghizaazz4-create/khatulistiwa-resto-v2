// POST /functions/v1/track-order
// Public (anon key) — order tracking for the ?view=order&id=... link.
// Returns ONE transaction by its id (YYMMDD-XXX): status, items, total,
// order type, payment method, timestamp and the customer name only.
// The order id is the lookup key, exactly like Sekali Klik's invoice
// lookup — no login needed, and no other customer's order is returned.
// The tracking view re-fetches this every 15 seconds, so a status change
// made in Kitchen / POS / Transactions shows up on the link live.
// Deploy: supabase functions deploy track-order
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (set automatically).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { handleOptions, json, readJson } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return json({ ok: false, message: "POST only." }, 405);
  try {
    const body = await readJson(req);
    const txnId = String(body.txnId ?? body.id ?? "").trim().toUpperCase();
    if (!txnId) return json({ ok: false, message: "Order ID is required." }, 400);
    const sb = serviceClient();
    const { data: t, error } = await sb
      .from("transactions")
      .select("id, timestamp, items_json, total_amount, payment_method, order_type, table_number, customer_id, status, notes, completed_at")
      .eq("id", txnId)
      .maybeSingle();
    if (error) return json({ ok: false, message: error.message }, 500);
    if (!t) return json({ ok: false, message: "Order not found. Check the order ID." }, 404);
    let customerName = "";
    if (t.customer_id) {
      const { data: c } = await sb.from("customers").select("name").eq("id", t.customer_id).maybeSingle();
      customerName = String(c?.name ?? "");
    }
    return json({
      ok: true,
      data: {
        id: t.id,
        timestamp: t.timestamp,
        items: t.items_json ?? [],
        total_amount: t.total_amount,
        paymentMethod: t.payment_method,
        orderType: t.order_type,
        tableNumber: t.table_number,
        status: t.status,
        notes: t.notes ?? "",
        completed_at: t.completed_at,
        customerName,
      },
    });
  } catch (e) {
    return json({ ok: false, message: String(e) }, 500);
  }
});
