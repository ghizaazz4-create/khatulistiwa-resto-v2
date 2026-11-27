// POST /functions/v1/upsert-customer
// Public (anon key) — upsert a customer by phone, replacing
// upsertCustomerByPhone() in Kode.js. Existing customer: address +
// last_visit are updated. New phone: a customer is created
// (id CUST-<epoch>, email '', total_purchases 0, points 0).
// This exists so the adapted frontend can keep its original two-step
// flow (upsert, then submitOrder) unchanged. submit-online-order does the
// same upsert internally, so calling both is idempotent — the second
// upsert just re-saves the same address/last_visit.
// Deploy: supabase functions deploy upsert-customer
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleOptions, json, readJson } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { normalizePhoneDigits, phoneLookupKey, phonesMatch } from "../_shared/phone.ts";

serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return json({ ok: false, message: "POST only." }, 405);
  try {
    const body = await readJson(req);
    const phone = String(body.phone ?? "").trim();
    const name = String(body.name ?? "").trim();
    const address = String(body.address ?? "").trim();
    if (normalizePhoneDigits(phone).length < 7) {
      return json({ ok: false, message: "Please enter a phone number." }, 400);
    }
    const sb = serviceClient();
    const key = phoneLookupKey(phone);
    const email = String(body.email ?? "").trim();
    const googleId = String(body.googleId ?? "").trim();
    const latitude = body.latitude === null || body.latitude === undefined || body.latitude === "" ? null : Number(body.latitude);
    const longitude = body.longitude === null || body.longitude === undefined || body.longitude === "" ? null : Number(body.longitude);
    const mapsUrl = String(body.mapsUrl ?? "").trim();
    const { data, error } = await sb
      .from("customers")
      .select("id, phone_digits")
      .ilike("phone_digits", `%${key}`)
      .limit(10);
    if (error) return json({ ok: false, message: error.message }, 500);
    const match = (data ?? []).find((c) => phonesMatch(c.phone_digits, phone));
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { address, last_visit: now };
    if (email) patch.email = email;
    if (googleId) patch.google_id = googleId;
    if (latitude !== null && !Number.isNaN(latitude)) patch.latitude = latitude;
    if (longitude !== null && !Number.isNaN(longitude)) patch.longitude = longitude;
    if (mapsUrl) patch.maps_url = mapsUrl;
    if (match) {
      await sb.from("customers").update(patch).eq("id", match.id);
      return json({ ok: true, data: { id: match.id, isNew: false } });
    }
    const newId = `CUST-${Date.now()}`;
    const { error: insErr } = await sb.from("customers").insert({
      id: newId,
      name,
      phone: `'${phone}`,
      email,
      address,
      total_purchases: 0,
      last_visit: now,
      created_at: now,
      points: 0,
      google_id: googleId || null,
      latitude,
      longitude,
      maps_url: mapsUrl,
    });
    if (insErr) return json({ ok: false, message: insErr.message }, 500);
    return json({ ok: true, data: { id: newId, isNew: true } });
  } catch (e) {
    return json({ ok: false, message: String(e) }, 500);
  }
});
