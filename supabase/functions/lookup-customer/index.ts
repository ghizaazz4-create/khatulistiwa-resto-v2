// POST /functions/v1/lookup-customer
// Public (anon key) — phone lookup for the online order form, replacing
// lookupCustomerByPhone() in Kode.js. Returns ONLY {id, name, phone,
// address}: no email, no points, no purchase history. The match is
// trailing-10-digits, like phonesMatch(). No record is created here.
// Deploy: supabase functions deploy lookup-customer
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, handleOptions, json, readJson } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { phoneLookupKey, phonesMatch } from "../_shared/phone.ts";

serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  if (req.method !== "POST") return json({ ok: false, message: "POST only." }, 405);
  try {
    const body = await readJson(req);
    const phone = String(body.phone ?? "").trim();
    const key = phoneLookupKey(phone);
    if (key.length < 7) return json({ ok: true, data: null });
    const sb = serviceClient();
    const { data, error } = await sb
      .from("customers")
      .select("id, name, phone, phone_digits, address")
      .ilike("phone_digits", `%${key}`)
      .limit(10);
    if (error) return json({ ok: false, message: error.message }, 500);
    const match = (data ?? []).find((c) => phonesMatch(c.phone_digits, phone));
    if (!match) return json({ ok: true, data: null });
    return json({
      ok: true,
      data: {
        id: match.id,
        name: match.name ?? "",
        phone: String(match.phone ?? "").replace(/^'/, ""),
        address: match.address ?? "",
      },
    });
  } catch (e) {
    return json({ ok: false, message: String(e) }, 500);
  }
});
