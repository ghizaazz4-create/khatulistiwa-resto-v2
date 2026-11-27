// POST /functions/v1/submit-online-order
// Public (anon key) — the online-order endpoint. Replaces the frontend's
// two-step upsertCustomerByPhone() + submitOrder() chain, but does BOTH
// atomically in one call, in this order (exactly as the spec requires):
//   1. upsert the customer by phone (latest address + last_visit; a new
//      phone creates the customer),
//   2. record the order in Transactions with status Pending,
//   3. return the transaction id — the CLIENT then opens wa.me to the
//      admin number. This function never opens WhatsApp itself.
// Stock is validated like submitOrder() (ingredients never go negative).
// Auth: anon key only. Writes use the SERVICE_ROLE key inside this
// function; the browser can never write to customers/transactions directly
// (RLS denies anon on those tables — see 001_init.sql).
// Deploy: supabase functions deploy submit-online-order
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//          (set automatically by `supabase functions deploy`).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleOptions, json, readJson } from "../_shared/cors.ts";
import { serviceClient, getSettings } from "../_shared/supabase.ts";
import { normalizePhoneDigits, phoneLookupKey } from "../_shared/phone.ts";
import { createOrder, type OrderInput } from "../_shared/order.ts";

serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return json({ ok: false, message: "POST only." }, 405);

  try {
    const body = await readJson(req);
    const phone = String(body.phone ?? "").trim();
    const name = String(body.name ?? "").trim();
    const address = String(body.address ?? "").trim();
    const items = Array.isArray(body.items) ? body.items : [];

    if (normalizePhoneDigits(phone).length < 7) {
      return json({ ok: false, message: "Please enter a phone number." }, 400);
    }
    if (!name) return json({ ok: false, message: "Please enter a name." }, 400);
    if (items.length === 0) {
      return json({ ok: false, message: "Please add items to your cart before ordering online." }, 400);
    }
    const orderType = String(body.orderType ?? "Take Away");
    if (orderType === "Delivery" && !address) {
      return json({ ok: false, message: "Please enter a delivery address." }, 400);
    }

    const sb = serviceClient();
    const settings = await getSettings(sb);

    // 1. Upsert customer (upsertCustomerByPhone in Kode.js, extended for
    //    v2 members). Match order: explicit customerId (a signed-in
    //    member) -> google_id -> email -> phone trailing-10-digits.
    //    A Guest order with the same phone as a member links to that
    //    member's row instead of creating a duplicate. Location fields
    //    are only overwritten when the client actually sent them, so a
    //    saved delivery location is never wiped by a later order.
    const googleId = String(body.googleId ?? "").trim();
    const email = String(body.email ?? "").trim();
    const avatarUrl = String(body.avatarUrl ?? "").trim();
    const latitude = body.latitude === null || body.latitude === undefined || body.latitude === "" ? null : Number(body.latitude);
    const longitude = body.longitude === null || body.longitude === undefined || body.longitude === "" ? null : Number(body.longitude);
    const mapsUrl = String(body.mapsUrl ?? "").trim();
    const key = phoneLookupKey(phone);
    let customerId: string | null = null;
    const now = new Date().toISOString();
    const findBy = async (col: string, val: string) => {
      const { data } = await sb.from("customers").select("id, phone_digits").eq(col, val).limit(1);
      return (data ?? [])[0] ?? null;
    };
    let match = null;
    if (body.customerId) {
      const { data } = await sb.from("customers").select("id, phone_digits").eq("id", String(body.customerId)).limit(1);
      match = (data ?? [])[0] ?? null;
    }
    if (!match && googleId) match = await findBy("google_id", googleId);
    if (!match && email) match = await findBy("email", email);
    if (!match) {
      const { data: existing } = await sb
        .from("customers")
        .select("id, phone_digits")
        .ilike("phone_digits", `%${key}`)
        .limit(5);
      match = (existing ?? []).find(
        (c) => String(c.phone_digits ?? "").slice(-10) === key,
      ) ?? null;
    }
    const locationPatch: Record<string, unknown> = { address, last_visit: now };
    if (googleId) locationPatch.google_id = googleId;
    if (email) locationPatch.email = email;
    if (avatarUrl) locationPatch.avatar_url = avatarUrl;
    if (latitude !== null && !Number.isNaN(latitude)) locationPatch.latitude = latitude;
    if (longitude !== null && !Number.isNaN(longitude)) locationPatch.longitude = longitude;
    if (mapsUrl) locationPatch.maps_url = mapsUrl;
    if (match) {
      customerId = String(match.id);
      await sb.from("customers").update(locationPatch).eq("id", customerId);
    } else {
      customerId = `CUST-${Date.now()}`;
      const { error } = await sb.from("customers").insert({
        id: customerId,
        name,
        phone: `'${phone}`,
        email,
        address,
        total_purchases: 0,
        last_visit: now,
        created_at: now,
        points: 0,
        google_id: googleId || null,
        avatar_url: avatarUrl,
        latitude,
        longitude,
        maps_url: mapsUrl,
      });
      if (error) return json({ ok: false, message: error.message }, 500);
    }

    // 2. Record the order first (status Pending — no needsApproval here,
    //    exactly like submitOnlineOrder() in Index.html).
    const order: OrderInput = {
      items,
      subtotal: Number(body.subtotal ?? 0),
      serviceCharge: Number(body.serviceCharge ?? 0),
      tax: Number(body.tax ?? 0),
      total: Number(body.total ?? 0),
      paymentMethod: String(body.paymentMethod ?? "Cash"),
      orderType,
      tableNumber: "N/A",
      customerId,
      employeeId: "System",
      cashReceived: 0,
      change: 0,
      needsApproval: false,
      notes: String(body.notes ?? ""),
    };
    const res = await createOrder(sb, order);
    if (!res.ok) return json({ ok: false, message: res.message ?? "Order could not be saved." }, 400);

    // 3. Return the id; the client builds the WhatsApp text and opens
    //    https://wa.me/<whatsapp_admin_phone>?text=... — only after success.
    return json({
      ok: true,
      data: {
        txnId: res.txnId,
        timestamp: res.timestamp,
        customerId,
        alerts: res.alerts ?? [],
        egpToIdrRate: Number(String(settings["egp_to_idr_rate"] || "327.7").replace(/^'/, "")) || 327.7,
      },
    });
  } catch (e) {
    return json({ ok: false, message: String(e) }, 500);
  }
});
