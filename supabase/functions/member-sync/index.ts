// POST /functions/v1/member-sync
// Member profile sync for Supabase Auth (Google provider).
// verify_jwt = true in supabase/config.toml: Supabase verifies the Auth
// JWT before this function runs, and the user is read from that token —
// the browser can never claim to be another member.
// Body (all optional except the JWT): { phone, address, latitude,
// longitude, mapsUrl }. The function upserts ONE customers row per
// Google account: match by google_id first, then by the Google email,
// then creates a new row. It returns the synced customer record
// (id, name, email, phone, address, points, total_purchases, avatar_url,
// latitude, longitude, maps_url) so Profile / Rewards can render it.
// Guests never call this — guest checkout works without any login.
// Deploy: supabase functions deploy member-sync
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//          (set automatically by `supabase functions deploy`).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleOptions, json, readJson } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return json({ ok: false, message: "POST only." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!authHeader || !url || !anonKey) {
      return json({ ok: false, message: "Not signed in." }, 401);
    }
    // Read the user from the verified Auth JWT (never trust a client-sent id).
    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userErr } = await authClient.auth.getUser();
    if (userErr || !user) return json({ ok: false, message: "Not signed in." }, 401);

    const body = await readJson(req);
    const sb = serviceClient();
    const email = String(user.email ?? "");
    const name = String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? "");
    const avatar = String(user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? "");
    const phone = String(body.phone ?? "").trim();
    const address = String(body.address ?? "").trim();
    const latitude = body.latitude === null || body.latitude === undefined || body.latitude === "" ? null : Number(body.latitude);
    const longitude = body.longitude === null || body.longitude === undefined || body.longitude === "" ? null : Number(body.longitude);
    const mapsUrl = String(body.mapsUrl ?? "").trim();
    const now = new Date().toISOString();

    // Match: google_id, then email, then create.
    let existing = null;
    const byGoogle = await sb.from("customers").select("*").eq("google_id", user.id).maybeSingle();
    if (byGoogle.data) existing = byGoogle.data;
    if (!existing && email) {
      const byEmail = await sb.from("customers").select("*").eq("email", email).maybeSingle();
      if (byEmail.data) existing = byEmail.data;
    }

    const patch: Record<string, unknown> = { last_visit: now };
    if (name) patch.name = name;
    if (email) patch.email = email;
    if (avatar) patch.avatar_url = avatar;
    if (phone) patch.phone = `'${phone}`;
    if (address) patch.address = address;
    if (latitude !== null && !Number.isNaN(latitude)) patch.latitude = latitude;
    if (longitude !== null && !Number.isNaN(longitude)) patch.longitude = longitude;
    if (mapsUrl) patch.maps_url = mapsUrl;

    let row;
    if (existing) {
      patch.google_id = user.id; // link a pre-Google row (e.g. a Guest order) to this account
      const { data, error } = await sb.from("customers").update(patch).eq("id", existing.id).select().single();
      if (error) return json({ ok: false, message: error.message }, 500);
      row = data;
    } else {
      const { data, error } = await sb.from("customers").insert({
        id: `CUST-${Date.now()}`,
        google_id: user.id,
        name: name || email.split("@")[0] || "Member",
        phone: phone ? `'${phone}` : "",
        email,
        address,
        total_purchases: 0,
        last_visit: now,
        created_at: now,
        points: 0,
        avatar_url: avatar,
        latitude,
        longitude,
        maps_url: mapsUrl,
      }).select().single();
      if (error) return json({ ok: false, message: error.message }, 500);
      row = data;
    }
    return json({
      ok: true,
      data: {
        id: row.id,
        name: row.name ?? "",
        email: row.email ?? "",
        phone: String(row.phone ?? "").replace(/^'/, ""),
        address: row.address ?? "",
        points: Number(row.points || 0),
        total_purchases: Number(row.total_purchases || 0),
        avatar_url: row.avatar_url ?? "",
        latitude: row.latitude,
        longitude: row.longitude,
        maps_url: row.maps_url ?? "",
      },
    });
  } catch (e) {
    return json({ ok: false, message: String(e) }, 500);
  }
});
