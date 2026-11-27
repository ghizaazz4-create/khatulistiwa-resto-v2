// POST /functions/v1/display-transactions
// Public (anon key) — today's transactions for the Kitchen / Customer /
// Queue display views, replacing the getTransactions() calls in
// fetchAndRenderKitchen() and the queue/customer views. The original
// exposed the FULL transaction rows (including customer_id and
// employee_id) to anyone with the link; this function returns only the
// fields a display screen actually renders: id, timestamp, items,
// total_amount, paymentMethod, orderType, tableNumber, status.
// No customer or employee data is returned. Only today's orders are
// returned, like the original kitchen view (which filtered by today).
// Deploy: supabase functions deploy display-transactions
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleOptions, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return json({ ok: false, message: "POST only." }, 405);
  try {
    const sb = serviceClient();
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await sb
      .from("transactions")
      .select("id, timestamp, items_json, total_amount, payment_method, order_type, table_number, status")
      .neq("status", "Void")
      .gte("timestamp", `${today}T00:00:00.000Z`)
      .lt("timestamp", `${today}T23:59:59.999Z`)
      .order("timestamp", { ascending: true });
    if (error) return json({ ok: false, message: error.message }, 500);
    // Shape matches getTransactions(): items is a JSON STRING there.
    const rows = (data ?? []).map((t) => ({
      id: t.id,
      timestamp: t.timestamp,
      items: typeof t.items_json === "string" ? t.items_json : JSON.stringify(t.items_json ?? []),
      total_amount: t.total_amount,
      paymentMethod: t.payment_method,
      orderType: t.order_type,
      tableNumber: t.table_number,
      customer_id: "Guest",
      status: t.status,
      employee_id: "",
      completed_at: null,
      cash_received: 0,
      change: 0,
    }));
    return json({ ok: true, data: rows });
  } catch (e) {
    return json({ ok: false, message: String(e) }, 500);
  }
});
